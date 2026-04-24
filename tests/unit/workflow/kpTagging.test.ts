import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
  pickProvider: vi.fn(),
  pickFallback: vi.fn(),
}));

const kpMocks = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock('@/providers/router', () => ({
  pickProvider: routerMocks.pickProvider,
  pickFallback: routerMocks.pickFallback,
}));

vi.mock('@/mcp/knowledgePoints', () => ({
  search: kpMocks.search,
}));

describe('kpTagging', () => {
  beforeEach(() => {
    routerMocks.pickProvider.mockReset();
    routerMocks.pickFallback.mockReset();
    kpMocks.search.mockReset();
  });

  it('reranks recalled knowledge tags through provider output', async () => {
    const { run } = await import('@/workflow/nodes/kpTagging');
    kpMocks.search.mockResolvedValue([
      { id: 'kt_linear', name: '一元一次方程' },
      { id: 'kt_compute', name: '有理数运算' },
    ]);
    const chat = vi.fn().mockResolvedValue({
      text: JSON.stringify({ tags: [{ id: 'kt_linear', confidence: 0.91 }] }),
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
        parseQuestion: {
          items: [{
            subQuestionId: 'sq_1',
            cropPath: 'crops/as_1/sq_1.jpg',
            parsed: {
              subject: 'math',
              questionType: 'solve-equation',
              stemText: '解方程 x + 3 = 5',
              knownConditions: [],
              goal: '求 x',
            },
          }],
        },
      },
      { assignmentId: 'as_1', originalImagePath: 'incoming/a.jpg', childId: 'ch_1', subject: 'math' },
    );

    expect(kpMocks.search).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toEqual({ subQuestionId: 'sq_1', tagIds: [{ id: 'kt_linear', confidence: 0.91 }] });
  });

  it('uses deterministic ranking when rerank provider fails', async () => {
    const { run } = await import('@/workflow/nodes/kpTagging');
    kpMocks.search.mockResolvedValue([{ id: 'kt_linear', name: '一元一次方程' }]);
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
        parseQuestion: {
          items: [{
            subQuestionId: 'sq_1',
            cropPath: 'crops/as_1/sq_1.jpg',
            parsed: {
              subject: 'math',
              questionType: 'solve-equation',
              stemText: '解方程 x + 3 = 5',
              knownConditions: [],
              goal: '求 x',
            },
          }],
        },
      },
      { assignmentId: 'as_1', originalImagePath: 'incoming/a.jpg', childId: 'ch_1', subject: 'math' },
    );

    expect(result.items[0]).toEqual({ subQuestionId: 'sq_1', tagIds: [{ id: 'kt_linear', confidence: 0.55 }] });
  });
});
