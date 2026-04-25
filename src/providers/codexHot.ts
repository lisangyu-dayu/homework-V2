import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { createOneShotRunner, type CliExecutionRequest, type CliExecutionResult, type CliRunner } from './cli';

export interface SpawnedCodexProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export type CodexSpawner = (command: string, args: string[]) => SpawnedCodexProcess;

export interface CodexMcpRunnerOptions {
  poolSize: number;
  command?: string;
  prewarmCount?: number;
  fallback?: CliRunner;
  spawner?: CodexSpawner;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingRpc {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingRun {
  request: CliExecutionRequest;
  resolve: (result: CliExecutionResult) => void;
  reject: (error: Error) => void;
}

interface ActiveRun extends PendingRun {
  startedAt: number;
}

function defaultSpawner(command: string, args: string[]): SpawnedCodexProcess {
  return spawn(command, args, {
    stdio: 'pipe',
    shell: process.platform === 'win32',
    windowsHide: true,
    env: process.env,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseModel(args: string[]): string | undefined {
  const modelIndex = args.findIndex((arg) => arg === '--model' || arg === '-m');
  if (modelIndex < 0) return undefined;
  return args[modelIndex + 1];
}

function shouldUseMcp(request: CliExecutionRequest): boolean {
  return request.args[0] === 'exec' && !request.args.includes('--image') && !request.args.includes('-i');
}

function extractToolContent(result: unknown): string {
  if (!isRecord(result)) return '';
  const structuredContent = result.structuredContent;
  if (isRecord(structuredContent) && typeof structuredContent.content === 'string') {
    return structuredContent.content;
  }

  const content = result.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractThreadId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const structuredContent = result.structuredContent;
  if (isRecord(structuredContent) && typeof structuredContent.threadId === 'string') {
    return structuredContent.threadId;
  }
  return typeof result.threadId === 'string' ? result.threadId : undefined;
}

function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

class CodexMcpWorker {
  private readonly child: SpawnedCodexProcess;

  private readonly pending = new Map<number, PendingRpc>();

  private nextId = 1;

  private buffer = '';

  private active: ActiveRun | null = null;

  private initialized = false;

  private closed = false;

  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly command: string,
    private readonly spawner: CodexSpawner,
    private readonly onClosed: (worker: CodexMcpWorker) => void,
  ) {
    this.child = this.spawner(command, ['mcp-server']);
    this.child.stdout.setEncoding?.('utf8');
    this.child.stderr.setEncoding?.('utf8');
    this.child.stdout.on('data', (chunk: Buffer | string) => this.handleStdout(String(chunk)));
    this.child.stderr.on('data', () => {
      // MCP stderr is diagnostic-only; request failures come back through JSON-RPC.
    });
    this.child.on('error', (error) => this.closeWithError(error));
    this.child.on('close', () => this.closeWithError(new Error('codex mcp worker closed')));
  }

  get isAlive(): boolean {
    return !this.closed;
  }

  async run(request: CliExecutionRequest): Promise<CliExecutionResult> {
    if (this.active) throw new Error('codex mcp worker is busy');
    if (this.closed) throw new Error('codex mcp worker is closed');

    this.active = {
      request,
      resolve: () => {},
      reject: () => {},
      startedAt: Date.now(),
    };

    try {
      await this.ensureInitialized(request.timeoutMs);
      const result = await this.callTool(request);
      const active = this.active;
      return {
        stdout: JSON.stringify({
          text: extractToolContent(result),
          threadId: extractThreadId(result),
        }),
        stderr: '',
        durationMs: active ? Date.now() - active.startedAt : 0,
        exitCode: 0,
      };
    } finally {
      this.active = null;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closeWithError(new Error('codex mcp worker closed'));
    this.child.kill('SIGTERM');
  }

  private ensureInitialized(timeoutMs: number): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const init = await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'homework-v2', version: '0.1.0' },
      }, timeoutMs);
      if (init.error) {
        throw new Error(init.error.message);
      }
      this.notify('notifications/initialized', {});
      this.initialized = true;
    })();
    return this.initPromise;
  }

  private callTool(request: CliExecutionRequest): Promise<unknown> {
    const model = parseModel(request.args);
    const argumentsPayload: Record<string, unknown> = {
      prompt: request.stdin ?? '',
      cwd: process.cwd(),
      sandbox: 'danger-full-access',
      'approval-policy': 'never',
    };
    if (model) {
      argumentsPayload.model = model;
    }

    return this.request('tools/call', {
      name: 'codex',
      arguments: argumentsPayload,
    }, request.timeoutMs).then((response) => {
      if (response.error) {
        throw new Error(response.error.message);
      }
      const result = response.result;
      if (!isRecord(result)) {
        return {};
      }
      return result;
    });
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResponse> {
    if (this.closed) return Promise.reject(new Error('codex mcp worker is closed'));
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out after ${timeoutMs}ms`));
        this.child.kill('SIGKILL');
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(encodeLine({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private notify(method: string, params: unknown): void {
    this.child.stdin.write(encodeLine({ jsonrpc: '2.0', method, params }));
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }

    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private closeWithError(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.onClosed(this);
  }
}

class CodexMcpWorkerPool {
  private readonly idle: CodexMcpWorker[] = [];

  private readonly active = new Set<CodexMcpWorker>();

  private readonly waiting: PendingRun[] = [];

  private totalWorkers = 0;

  private closed = false;

  constructor(
    private readonly command: string,
    private readonly poolSize: number,
    private readonly spawner: CodexSpawner,
    prewarmCount: number,
  ) {
    const count = Math.min(poolSize, Math.max(0, prewarmCount));
    for (let index = 0; index < count; index += 1) {
      const worker = this.acquireWorker();
      if (worker) this.releaseWorker(worker);
    }
  }

  run(request: CliExecutionRequest): Promise<CliExecutionResult> {
    if (this.closed) {
      return Promise.reject(new Error('codex mcp worker pool closed'));
    }

    return new Promise((resolve, reject) => {
      this.waiting.push({ request, resolve, reject });
      this.drain();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const closeError = new Error('codex mcp worker pool closed');
    for (const pending of this.waiting.splice(0)) {
      pending.reject(closeError);
    }

    for (const worker of [...this.idle]) worker.close();
    for (const worker of [...this.active]) worker.close();
    this.idle.length = 0;
    this.active.clear();
    this.totalWorkers = 0;
  }

  private drain(): void {
    if (this.closed) return;
    while (this.waiting.length > 0) {
      const worker = this.acquireWorker();
      if (!worker) return;
      const pending = this.waiting.shift();
      if (!pending) {
        this.releaseWorker(worker);
        return;
      }

      this.active.add(worker);
      worker.run(pending.request)
        .then(pending.resolve, pending.reject)
        .finally(() => {
          this.active.delete(worker);
          if (worker.isAlive) this.releaseWorker(worker);
          this.drain();
        });
    }
  }

  private acquireWorker(): CodexMcpWorker | null {
    const worker = this.idle.pop();
    if (worker) return worker;
    if (this.totalWorkers >= this.poolSize) return null;
    this.totalWorkers += 1;
    return new CodexMcpWorker(this.command, this.spawner, (closedWorker) => {
      this.removeWorker(closedWorker);
    });
  }

  private releaseWorker(worker: CodexMcpWorker): void {
    if (this.closed) {
      worker.close();
      return;
    }
    this.idle.push(worker);
  }

  private removeWorker(worker: CodexMcpWorker): void {
    const index = this.idle.indexOf(worker);
    if (index >= 0) this.idle.splice(index, 1);
    this.active.delete(worker);
    this.totalWorkers = Math.max(0, this.totalWorkers - 1);
  }
}

export function createCodexMcpRunner(options: CodexMcpRunnerOptions): CliRunner {
  const fallback = options.fallback ?? createOneShotRunner({ poolSize: options.poolSize });
  const spawner = options.spawner ?? defaultSpawner;
  const pools = new Map<string, CodexMcpWorkerPool>();
  if (options.command) {
    pools.set(options.command, new CodexMcpWorkerPool(
      options.command,
      options.poolSize,
      spawner,
      options.prewarmCount ?? 1,
    ));
  }

  return {
    run(request) {
      if (!shouldUseMcp(request)) {
        return fallback.run(request);
      }

      let pool = pools.get(request.command);
      if (!pool) {
        pool = new CodexMcpWorkerPool(request.command, options.poolSize, spawner, 0);
        pools.set(request.command, pool);
      }
      return pool.run(request);
    },
    close() {
      for (const pool of pools.values()) pool.close();
      pools.clear();
      fallback.close?.();
    },
  };
}

export const codexHotInternalsForTest = {
  parseModel,
  shouldUseMcp,
};
