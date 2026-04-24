import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
  pickProvider: vi.fn(),
  pickFallback: vi.fn(),
}));

vi.mock('@/providers/router', () => ({
  pickProvider: routerMocks.pickProvider,
  pickFallback: routerMocks.pickFallback,
}));

describe('generateExplanation', () => {
  beforeEach(() => {
    routerMocks.pickProvider.mockReset();
    routerMocks.pickFallback.mockReset();
  });

  it('uses provider JSON explanation output', async () => {
    const { run } = await import('@/workflow/nodes/generateExplanation');
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ explanationMd: '先移项：$x=2$', errorType: '计算失误' }),
      model: 'sonnet',
      usage: { durationMs: 5 },
    });
    routerMocks.pickProvider.mockReturnValue({
      name: 'claude',
      supportsPromptCache: true,
      supportsVision: true,
      healthCheck: vi.fn(),
      chat,
      vision: vi.fn(),
    });
    routerMocks.pickFallback.mockReturnValue(null);

    const result = await run(
      {
        grade: { items: [{ subQuestionId: 'sq_1', grading: { verdict: 'wrong', studentAnswer: '3', errorType: '计算失误', comment: 'differs' } }] },
        selfSolve: { items: [{ subQuestionId: 'sq_1', solution: { steps: [{ text: '移项', formula: 'x=2' }], finalAnswer: 'x=2', confidence: 0.9, solverModel: 'codex' } }] },
      },
      { assignmentId: 'as_1', originalImagePath: 'incoming/a.jpg', childId: 'ch_1', subject: 'math' },
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({ subQuestionId: 'sq_1', explanationMd: '先移项：$x=2$', errorType: '计算失误' });
  });

  it('falls back to deterministic Markdown when providers fail', async () => {
    const { run } = await import('@/workflow/nodes/generateExplanation');
    routerMocks.pickProvider.mockReturnValue({
      name: 'claude',
      supportsPromptCache: true,
      supportsVision: true,
      healthCheck: vi.fn(),
      chat: vi.fn().mockRejectedValue(new Error('offline')),
      vision: vi.fn(),
    });
    routerMocks.pickFallback.mockReturnValue(null);

    const result = await run(
      {
        grade: { items: [{ subQuestionId: 'sq_1', grading: { verdict: 'unmarked', studentAnswer: null, comment: 'unclear' } }] },
        selfSolve: { items: [{ subQuestionId: 'sq_1', solution: { steps: [{ text: '直接计算', formula: '1+1=2' }], finalAnswer: '2', confidence: 0.9, solverModel: 'codex' } }] },
      },
      { assignmentId: 'as_1', originalImagePath: 'incoming/a.jpg', childId: 'ch_1', subject: 'math' },
    );

    expect(result.items[0]?.explanationMd).toContain('参考答案：2');
  });
});
