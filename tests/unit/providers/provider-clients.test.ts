import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCliProvider } from '@/providers/claude';
import { CodexCliProvider } from '@/providers/codex';

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
});
