import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChatRequest, ChatResponse, VisionImage } from './types';

export interface CliExecutionRequest {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
}

export interface CliExecutionResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
}

export type CliExecutor = (request: CliExecutionRequest) => Promise<CliExecutionResult>;

class Semaphore {
  private active = 0;

  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    next?.();
  }
}

export function createExecutor(): CliExecutor {
  return async (request) => new Promise<CliExecutionResult>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(request.command, request.args, {
      stdio: 'pipe',
      shell: process.platform === 'win32',
      windowsHide: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      handler();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      finish(() => {
        if (timedOut) {
          reject(new Error(`timed out after ${request.timeoutMs}ms`));
          return;
        }

        resolve({
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          exitCode: code,
        });
      });
    });

    child.stdin.on('error', () => {
      // ignore broken pipe; close handler will surface the command failure.
    });
    child.stdin.end(request.stdin ?? '');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function dedupeText(parts: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const part of parts) {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function extractTextFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFromValue(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const directKeys = [
    'text',
    'output_text',
    'result',
    'response',
    'completion',
    'content',
    'message',
    'delta',
  ];

  for (const key of directKeys) {
    if (key in value) {
      const extracted = extractTextFromValue(value[key]);
      if (extracted.length > 0) {
        return extracted;
      }
    }
  }

  if ('choices' in value && Array.isArray(value.choices)) {
    const extracted = extractTextFromValue(value.choices);
    if (extracted.length > 0) {
      return extracted;
    }
  }

  return [];
}

export function extractAssistantText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return '';
  }

  const candidates: string[] = [];

  try {
    candidates.push(...extractTextFromValue(JSON.parse(trimmed)));
  } catch {
    // not a single JSON payload
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const normalized = line.trim();
    if (!normalized.startsWith('{') && !normalized.startsWith('[')) {
      continue;
    }

    try {
      candidates.push(...extractTextFromValue(JSON.parse(normalized)));
    } catch {
      // ignore non-JSON lines
    }
  }

  const deduped = dedupeText(candidates);
  if (deduped.length > 0) {
    return deduped.join('\n\n');
  }

  return trimmed;
}

export function buildPrompt(request: ChatRequest, imagePaths: string[] = []): string {
  const parts: string[] = [];

  if (request.system?.trim()) {
    parts.push(`<system>\n${request.system.trim()}\n</system>`);
  }

  for (const message of request.messages) {
    parts.push(`<${message.role}>\n${message.content.trim()}\n</${message.role}>`);
  }

  if (imagePaths.length > 0) {
    parts.push(
      [
        '<images>',
        ...imagePaths.map((imagePath, index) => `image_${index + 1}: @${imagePath}`),
        '</images>',
      ].join('\n'),
    );
  }

  return parts.join('\n\n').trim();
}

export async function withTempImages<T>(
  images: VisionImage[],
  task: (paths: string[]) => Promise<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homework-v2-vision-'));
  const paths = images.map((image, index) => {
    const extension = image.mediaType === 'image/png'
      ? 'png'
      : image.mediaType === 'image/webp'
        ? 'webp'
        : 'jpg';
    const filePath = path.join(dir, `image-${index + 1}.${extension}`);
    fs.writeFileSync(filePath, image.data);
    return filePath;
  });

  try {
    return await task(paths);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface CliProviderCoreOptions {
  cliPath: string;
  defaultModel: string;
  poolSize: number;
  timeoutMs: number;
  executor?: CliExecutor;
}

export abstract class CliProviderBase {
  protected readonly executor: CliExecutor;

  private readonly semaphore: Semaphore;

  protected constructor(protected readonly options: CliProviderCoreOptions) {
    this.executor = options.executor ?? createExecutor();
    this.semaphore = new Semaphore(options.poolSize);
  }

  protected runCommand(request: {
    args: string[];
    stdin: string;
  }): Promise<ChatResponse> {
    return this.semaphore.run(async () => {
      const result = await this.executor({
        command: this.options.cliPath,
        args: request.args,
        stdin: request.stdin,
        timeoutMs: this.options.timeoutMs,
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`);
      }

      return {
        text: extractAssistantText(result.stdout),
        model: this.options.defaultModel,
        usage: { durationMs: result.durationMs },
        raw: result.stdout.trim() ? result.stdout : undefined,
      };
    });
  }

  protected async runHealthCheck(args: string[]): Promise<void> {
    const result = await this.executor({
      command: this.options.cliPath,
      args,
      timeoutMs: this.options.timeoutMs,
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`);
    }
  }
}
