import { beforeEach, describe, expect, it, vi } from 'vitest';

const sympyMocks = vi.hoisted(() => ({
  equivalent: vi.fn(),
}));

vi.mock('@/mcp/sympy', () => ({
  equivalent: sympyMocks.equivalent,
}));

describe('grade', () => {
  beforeEach(() => {
    sympyMocks.equivalent.mockReset();
  });

  it('marks equivalent student answers correct', async () => {
    const { run } = await import('@/workflow/nodes/grade');
    sympyMocks.equivalent.mockResolvedValue({ equivalent: true });

    const result = await run({
      extractStudentAnswer: { items: [{ subQuestionId: 'sq_1', studentAnswer: '2', confidence: 0.9 }] },
      selfSolve: {
        items: [{
          subQuestionId: 'sq_1',
          solution: { steps: [{ text: 'compute', formula: '1 + 1 = 2' }], finalAnswer: '1 + 1', confidence: 0.9, solverModel: 'codex' },
        }],
      },
      verify: { items: [{ subQuestionId: 'sq_1', consistent: true }] },
    });

    expect(sympyMocks.equivalent).toHaveBeenCalledWith('2', '1 + 1');
    expect(result.items[0]?.grading).toMatchObject({ verdict: 'correct', studentAnswer: '2' });
  });

  it('keeps unclear answers and unreliable references unmarked', async () => {
    const { run } = await import('@/workflow/nodes/grade');

    const result = await run({
      extractStudentAnswer: {
        items: [
          { subQuestionId: 'sq_unclear', studentAnswer: null, confidence: 0 },
          { subQuestionId: 'sq_conflict', studentAnswer: '3', confidence: 0.9 },
        ],
      },
      selfSolve: {
        items: [{
          subQuestionId: 'sq_conflict',
          solution: { steps: [{ text: 'compute' }], finalAnswer: '2', confidence: 0.9, solverModel: 'codex' },
        }],
      },
      verify: { items: [{ subQuestionId: 'sq_conflict', consistent: false, skipped: false }] },
    });

    expect(result.items.map((item) => item.grading.verdict)).toEqual(['unmarked', 'unmarked']);
  });

  it('does not mark wrong when reference verification is missing or skipped', async () => {
    const { run } = await import('@/workflow/nodes/grade');

    const result = await run({
      extractStudentAnswer: {
        items: [
          { subQuestionId: 'sq_missing_verify', studentAnswer: '3', confidence: 0.9 },
          { subQuestionId: 'sq_skipped_verify', studentAnswer: '3', confidence: 0.9 },
        ],
      },
      selfSolve: {
        items: [
          {
            subQuestionId: 'sq_missing_verify',
            solution: { steps: [{ text: 'compute' }], finalAnswer: '2', confidence: 0.9, solverModel: 'codex' },
          },
          {
            subQuestionId: 'sq_skipped_verify',
            solution: { steps: [{ text: 'compute' }], finalAnswer: '2', confidence: 0.9, solverModel: 'codex' },
          },
        ],
      },
      verify: { items: [{ subQuestionId: 'sq_skipped_verify', consistent: false, skipped: true }] },
    });

    expect(sympyMocks.equivalent).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.grading.verdict)).toEqual(['unmarked', 'unmarked']);
  });

  it('keeps answers unmarked when student comparison cannot be evaluated', async () => {
    const { run } = await import('@/workflow/nodes/grade');
    sympyMocks.equivalent.mockRejectedValue(new Error('parse failed'));

    const result = await run({
      extractStudentAnswer: { items: [{ subQuestionId: 'sq_1', studentAnswer: 'x≈2', confidence: 0.9 }] },
      selfSolve: {
        items: [{
          subQuestionId: 'sq_1',
          solution: { steps: [{ text: 'compute' }], finalAnswer: 'x = 2', confidence: 0.9, solverModel: 'codex' },
        }],
      },
      verify: { items: [{ subQuestionId: 'sq_1', consistent: true }] },
    });

    expect(result.items[0]?.grading.verdict).toBe('unmarked');
  });
});
