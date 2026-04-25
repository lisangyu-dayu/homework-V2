import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ClaudeCliProvider } from '@/providers/claude';
import { CodexCliProvider } from '@/providers/codex';
import { createCodexMcpRunner, type SpawnedCodexProcess } from '@/providers/codexHot';
import type { CliRunner } from '@/providers/cli';

describe('ClaudeCliProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs healthCheck and chat through the CLI executor', async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: 'claude 1.0.0',
        stderr: '',
        durationMs: 5,
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: '{"text":"4"}',
        stderr: '',
        durationMs: 12,
        exitCode: 0,
      });

    const provider = new ClaudeCliProvider({
      cliPath: 'claude',
      defaultModel: 'sonnet',
      poolSize: 1,
      timeoutMs: 1000,
      executor,
    });

    await provider.healthCheck();
    const response = await provider.chat({
      system: 'You are a math assistant.',
      messages: [{ role: 'user', content: '2+2=?' }],
      model: 'sonnet-4',
    });

    expect(executor).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'claude',
      args: ['--version'],
      timeoutMs: 1000,
    }));
    expect(executor).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'claude',
      args: ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--model', 'sonnet-4'],
    }));
    expect(executor.mock.calls[1]?.[0].stdin).toContain('<system>');
    expect(executor.mock.calls[1]?.[0].stdin).toContain('<user>');
    expect(response).toMatchObject({
      text: '4',
      model: 'sonnet-4',
      usage: { durationMs: 12 },
    });
  });

  it('maps executor failures to UpstreamError', async () => {
    const provider = new ClaudeCliProvider({
      cliPath: 'claude',
      defaultModel: 'sonnet',
      poolSize: 1,
      timeoutMs: 1000,
      executor: vi.fn().mockRejectedValue(new Error('spawn failed')),
    });

    await expect(provider.chat({
      messages: [{ role: 'user', content: 'hello' }],
    })).rejects.toEqual(expect.objectContaining({
      code: 'UPSTREAM_LLM_FAIL',
      provider: 'claude',
      message: '[claude] spawn failed',
    }));
  });
});

describe('CodexCliProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs chat through codex exec JSON mode', async () => {
    const executor = vi.fn().mockResolvedValue({
      stdout: '{"text":"4"}',
      stderr: '',
      durationMs: 12,
      exitCode: 0,
    });
    const provider = new CodexCliProvider({
      cliPath: 'codex',
      defaultModel: 'gpt-5.4',
      poolSize: 1,
      timeoutMs: 1000,
      executor,
    });

    const response = await provider.chat({
      messages: [{ role: 'user', content: '2+2=?' }],
      model: 'gpt-5.4',
    });

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      command: 'codex',
      args: ['exec', '--json', '--model', 'gpt-5.4'],
    }));
    expect(response).toMatchObject({
      text: '4',
      model: 'gpt-5.4',
      usage: { durationMs: 12 },
    });
  });

  it('runs vision through codex exec image arguments', async () => {
    const executor = vi.fn().mockResolvedValue({
      stdout: '{"text":"seen"}',
      stderr: '',
      durationMs: 12,
      exitCode: 0,
    });
    const provider = new CodexCliProvider({
      cliPath: 'codex',
      defaultModel: 'gpt-5.4',
      poolSize: 1,
      timeoutMs: 1000,
      executor,
    });

    await provider.vision({
      messages: [{ role: 'user', content: 'describe' }],
      images: [{ data: Buffer.from('fake'), mediaType: 'image/png' }],
      model: 'gpt-5.4',
    });

    const args = executor.mock.calls[0]?.[0].args as string[];
    expect(args.slice(0, 4)).toEqual(['exec', '--json', '--model', 'gpt-5.4']);
    expect(args).toContain('--image');
    expect(provider.supportsVision).toBe(true);
  });

  it('can run text requests through a persistent codex mcp worker', async () => {
    const spawned: FakeCodexProcess[] = [];
    const runner = createCodexMcpRunner({
      poolSize: 1,
      spawner(command, args) {
        const child = new FakeCodexProcess(command, args);
        spawned.push(child);
        return child;
      },
    });
    const provider = new CodexCliProvider({
      cliPath: 'codex',
      defaultModel: 'gpt-5.4',
      poolSize: 1,
      timeoutMs: 1000,
      runner,
    });

    const first = await provider.chat({
      messages: [{ role: 'user', content: 'one' }],
      model: 'gpt-5.4',
    });
    const second = await provider.chat({
      messages: [{ role: 'user', content: 'two' }],
      model: 'gpt-5.4',
    });

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toBe('codex');
    expect(spawned[0]?.args).toEqual(['mcp-server']);
    expect(first.text).toContain('mcp:');
    expect(second.text).toContain('mcp:');
    expect(spawned[0]?.toolCalls).toHaveLength(2);
  });

  it('falls back to one-shot codex exec for vision image requests', async () => {
    const fallbackRun = vi.fn().mockResolvedValue({
      stdout: '{"text":"seen"}',
      stderr: '',
      durationMs: 9,
      exitCode: 0,
    });
    const fallback: CliRunner = { run: fallbackRun };
    const provider = new CodexCliProvider({
      cliPath: 'codex',
      defaultModel: 'gpt-5.4',
      poolSize: 1,
      timeoutMs: 1000,
      runner: createCodexMcpRunner({
        poolSize: 1,
        fallback,
        spawner() {
          throw new Error('mcp should not start for image requests');
        },
      }),
    });

    const response = await provider.vision({
      messages: [{ role: 'user', content: 'describe' }],
      images: [{ data: Buffer.from('fake'), mediaType: 'image/png' }],
      model: 'gpt-5.4',
    });

    expect(response.text).toBe('seen');
    expect(fallbackRun).toHaveBeenCalledTimes(1);
    expect(fallbackRun.mock.calls[0]?.[0].args).toContain('--image');
  });

  it('prewarms codex mcp workers when a command is provided', () => {
    const spawned: FakeCodexProcess[] = [];
    const runner = createCodexMcpRunner({
      command: 'codex',
      poolSize: 3,
      prewarmCount: 1,
      spawner(command, args) {
        const child = new FakeCodexProcess(command, args);
        spawned.push(child);
        return child;
      },
    });

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args).toEqual(['mcp-server']);
    runner.close?.();
  });

  it('rejects active and queued mcp requests when the runner closes', async () => {
    const spawned: FakeCodexProcess[] = [];
    const runner = createCodexMcpRunner({
      poolSize: 1,
      spawner(command, args) {
        const child = new FakeCodexProcess(command, args, { respondToToolCalls: false });
        spawned.push(child);
        return child;
      },
    });
    const request = {
      command: 'codex',
      args: ['exec', '--json', '--model', 'gpt-5.4'],
      stdin: 'hold',
      timeoutMs: 1000,
    };

    const active = runner.run(request);
    const queued = runner.run({ ...request, stdin: 'queued' });
    await waitFor(() => spawned[0]?.toolCalls.length === 1);
    runner.close?.();

    const results = await Promise.allSettled([active, queued]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('rejected');
    if (results[0]?.status !== 'rejected' || results[1]?.status !== 'rejected') {
      throw new Error('expected active and queued requests to reject');
    }
    expect(String(results[0].reason)).toContain('codex mcp worker closed');
    expect(String(results[1].reason)).toContain('codex mcp worker pool closed');
  });
});

class FakeCodexProcess extends EventEmitter implements SpawnedCodexProcess {
  readonly stdin = new PassThrough();

  readonly stdout = new PassThrough();

  readonly stderr = new PassThrough();

  readonly toolCalls: unknown[] = [];

  private buffer = '';

  constructor(
    readonly command: string,
    readonly args: string[],
    private readonly options: { respondToToolCalls?: boolean } = {},
  ) {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk) => this.handleInput(String(chunk)));
  }

  kill(): boolean {
    this.emit('close', 0, null);
    return true;
  }

  private handleInput(chunk: string): void {
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
    const message = JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: {
        name?: string;
        arguments?: {
          prompt?: string;
          model?: string;
        };
      };
    };
    if (message.method === 'initialize') {
      this.writeResponse(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'fake-codex-mcp', version: '0.0.0' },
      });
      return;
    }

    if (message.method === 'tools/call') {
      this.toolCalls.push(message.params);
      if (this.options.respondToToolCalls === false) return;
      const prompt = message.params?.arguments?.prompt ?? '';
      this.writeResponse(message.id, {
        structuredContent: {
          threadId: `thread-${this.toolCalls.length}`,
          content: `mcp:${prompt}`,
        },
      });
    }
  }

  private writeResponse(id: number | undefined, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}
