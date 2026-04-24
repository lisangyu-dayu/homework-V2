import { beforeEach, describe, expect, it, vi } from 'vitest';

const sympyMocks = vi.hoisted(() => ({
  equivalent: vi.fn(),
}));

vi.mock('@/mcp/sympy', () => ({
  equivalent: sympyMocks.equivalent,
}));

describe('verify', () => {
  beforeEach(() => {
    sympyMocks.equivalent.mockReset();
  });

  it('builds expression-vs-numeric attempts from final answer and last formula', async () => {
    const { buildVerificationAttempts } = await import('@/workflow/nodes/verify');

    const attempts = buildVerificationAttempts({
      finalAnswer: '2',
      confidence: 0.9,
      solverModel: 'codex',
      steps: [
        { text: '计算', formula: '1 + 1 = 2' },
      ],
    });

    expect(attempts).toEqual([
      {
        actual: '2',
        expected: '1 + 1 = 2',
        label: 'final-answer-vs-last-formula',
      },
      {
        actual: '2',
        expected: '2',
        label: 'final-answer-vs-last-formula-rhs',
      },
    ]);
  });

  it('accepts numeric equivalence after retrying a rhs comparison', async () => {
    const { run } = await import('@/workflow/nodes/verify');
    sympyMocks.equivalent
      .mockRejectedValueOnce(new Error('parse error'))
      .mockResolvedValueOnce({
        equivalent: true,
        canonicalA: '2',
        canonicalB: '2',
        note: 'numeric-match',
      });

    const result = await run({
      selfSolve: {
        items: [
          {
            subQuestionId: 'sq_1',
            solution: {
              steps: [{ text: '计算', formula: '1 + 1 = 2' }],
              finalAnswer: '2',
              confidence: 0.95,
              solverModel: 'codex',
            },
          },
        ],
      },
    });

    expect(sympyMocks.equivalent).toHaveBeenNthCalledWith(1, '2', '1 + 1 = 2');
    expect(sympyMocks.equivalent).toHaveBeenNthCalledWith(2, '2', '2');
    expect(result.items[0]).toMatchObject({
      subQuestionId: 'sq_1',
      consistent: true,
      comparedAnswer: '2',
      comparedAgainst: '2',
      canonicalAnswer: '2',
      canonicalAgainst: '2',
      note: 'final-answer-vs-last-formula-rhs:numeric-match',
    });
  });

  it('marks conflicts and preserves canonical forms when answers disagree', async () => {
    const { run } = await import('@/workflow/nodes/verify');
    sympyMocks.equivalent.mockResolvedValue({
      equivalent: false,
      canonicalA: '3',
      canonicalB: '2',
      note: 'not-equivalent',
    });

    const result = await run({
      selfSolve: {
        items: [
          {
            subQuestionId: 'sq_conflict',
            solution: {
              steps: [{ text: '化简', formula: 'x = 2' }],
              finalAnswer: 'x = 3',
              confidence: 0.8,
              solverModel: 'codex',
            },
          },
        ],
      },
    });

    expect(result.items[0]).toMatchObject({
      subQuestionId: 'sq_conflict',
      consistent: false,
      comparedAnswer: 'x = 3',
      comparedAgainst: 'x = 2',
      canonicalAnswer: '3',
      canonicalAgainst: '2',
      note: 'conflict:final-answer-vs-last-formula:not-equivalent',
    });
  });

  it('skips verification when there is no symbolic expression to compare', async () => {
    const { run } = await import('@/workflow/nodes/verify');

    const result = await run({
      selfSolve: {
        items: [
          {
            subQuestionId: 'sq_skip',
            solution: {
              steps: [{ text: '选项 B' }],
              finalAnswer: 'B',
              confidence: 0.7,
              solverModel: 'codex',
            },
          },
        ],
      },
    });

    expect(sympyMocks.equivalent).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      subQuestionId: 'sq_skip',
      consistent: false,
      skipped: true,
      note: 'verification-skipped:no-comparable-expression',
    });
  });
});
