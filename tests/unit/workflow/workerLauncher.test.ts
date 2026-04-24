import { describe, expect, it } from 'vitest';

describe('workerLauncher', () => {
  it('resolves the exported tsx CLI entrypoint instead of a Windows cmd shim', async () => {
    const { resolveTsxCliPathForWorker } = await import('@/workflow/workerLauncher');

    const cliPath = resolveTsxCliPathForWorker().replace(/\\/g, '/');

    expect(cliPath).toContain('/node_modules/tsx/dist/cli.mjs');
    expect(cliPath.endsWith('.cmd')).toBe(false);
  });
});
