import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCliProvider } from '@/providers/claude';

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
