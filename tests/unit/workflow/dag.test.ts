import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertTrace = vi.fn();
const loggerError = vi.fn();

vi.mock('@/db/dao/traces', () => ({
  insertTrace,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerError,
  },
}));

describe('Dag', () => {
  beforeEach(() => {
    insertTrace.mockReset();
    loggerError.mockReset();
    process.env.WORKFLOW_CONCURRENCY = '2';
  });

  it('retries failed nodes and resolves dependent nodes after deps complete', async () => {
    const { Dag } = await import('@/workflow/dag');
    const attempts: string[] = [];

    const dag = new Dag<{ assignmentId: string }>();
    dag
      .register({
        name: 'seed',
        retries: 1,
        retryDelayMs: 1,
        handler: async () => {
          attempts.push('seed');
          if (attempts.length === 1) {
            throw new Error('temporary');
          }
          return 'A';
        },
      })
      .register({
        name: 'decorate',
        deps: ['seed'],
        handler: async (results) => `${String((results as Record<string, unknown>).seed)}-B`,
      });

    const results = await dag.run({ assignmentId: 'asg_1' });

    expect(results.seed).toBe('A');
    expect(results.decorate).toBe('A-B');
    expect(attempts).toEqual(['seed', 'seed']);
    expect(insertTrace).toHaveBeenCalledTimes(2);
    expect(insertTrace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      nodeName: 'seed',
      status: 'success',
    }));
    expect(insertTrace).toHaveBeenNthCalledWith(2, expect.objectContaining({
      nodeName: 'decorate',
      status: 'success',
      input: { seed: 'A' },
      output: 'A-B',
    }));
  });

  it('uses fallback output and traces the recovered node as success', async () => {
    const { Dag } = await import('@/workflow/dag');

    const dag = new Dag<{ assignmentId: string }>();
    dag
      .register({
        name: 'solve',
        handler: async () => {
          throw new Error('primary failed');
        },
        fallback: () => 'fallback-answer',
      })
      .register({
        name: 'render',
        deps: ['solve'],
        handler: async (results) => `render:${String((results as Record<string, unknown>).solve)}`,
      });

    const results = await dag.run({ assignmentId: 'asg_2' });

    expect(results.solve).toBe('fallback-answer');
    expect(results.render).toBe('render:fallback-answer');
    expect(insertTrace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      nodeName: 'solve',
      status: 'success',
      output: 'fallback-answer',
      errorMsg: 'primary failed',
    }));
    expect(insertTrace).toHaveBeenNthCalledWith(2, expect.objectContaining({
      nodeName: 'render',
      status: 'success',
      input: { solve: 'fallback-answer' },
    }));
    expect(loggerError).not.toHaveBeenCalled();
  });
});
