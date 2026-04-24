import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
  pickProvider: vi.fn(),
  pickFallback: vi.fn(),
}));

vi.mock('@/providers/router', () => ({
  pickProvider: routerMocks.pickProvider,
  pickFallback: routerMocks.pickFallback,
}));

describe('selfSolve', () => {
  beforeEach(() => {
    routerMocks.pickProvider.mockReset();
    routerMocks.pickFallback.mockReset();
  });

  it('parses fenced JSON into structured solution output', async () => {
    const { parseSelfSolveResponse } = await import('@/workflow/nodes/selfSolve');

    const solution = parseSelfSolveResponse(
      [
        '```json',
        JSON.stringify({
          steps: [
            { text: '移项', formula: 'x = 5 - 3' },
            { text: '化简', formula: 'x = 2' },
          ],
          finalAnswer: 'x = 2',
          confidence: 0.92,
        }),
        '```',
      ].join('\n'),
      'codex',
    );

    expect(solution).toMatchObject({
      solverModel: 'codex',
      finalAnswer: 'x = 2',
      confidence: 0.92,
    });
    expect(solution.steps).toHaveLength(2);
  });

  it('uses primary provider output when solving parsed questions', async () => {
    const { run } = await import('@/workflow/nodes/selfSolve');
    const chat = vi.fn(async (request: { messages: Array<{ content: string }> }) => {
      const prompt = request.messages[0]?.content ?? '';
      if (prompt.includes('计算 1 + 1')) {
        return {
          text: JSON.stringify({
            steps: [{ text: '直接计算', formula: '1 + 1 = 2' }],
            finalAnswer: '2',
            confidence: 0.95,
          }),
          model: 'gpt-5.4',
          usage: { durationMs: 8 },
        };
      }

      return {
        text: JSON.stringify({
          steps: [
            { text: '移项', formula: 'x = 5 - 3' },
            { text: '化简', formula: 'x = 2' },
          ],
          finalAnswer: 'x = 2',
          confidence: 0.9,
        }),
        model: 'gpt-5.4',
        usage: { durationMs: 10 },
      };
    });

    routerMocks.pickProvider.mockReturnValue({
      name: 'codex',
      supportsPromptCache: false,
      supportsVision: false,
      healthCheck: vi.fn(),
      chat,
      vision: vi.fn(),
    });
    routerMocks.pickFallback.mockReturnValue(null);

    const result = await run(
      {
        parseQuestion: {
          items: [
            {
              subQuestionId: 'sq_1',
              cropPath: 'crops/asg/sq_1.jpg',
              parsed: {
                subject: 'math',
                questionType: 'computation',
                stemText: '计算 1 + 1',
                knownConditions: [],
                goal: '求结果',
              },
            },
            {
              subQuestionId: 'sq_2',
              cropPath: 'crops/asg/sq_2.jpg',
              parsed: {
                subject: 'math',
                questionType: 'solve-equation',
                stemText: '解方程 x + 3 = 5',
                knownConditions: [],
                goal: '求 x',
              },
            },
          ],
        },
      },
      {
        assignmentId: 'asg_selfsolve_1',
        originalImagePath: 'incoming/a.jpg',
        childId: 'child_1',
        subject: 'math',
      },
    );

    expect(result.isPlaceholder).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        subQuestionId: 'sq_1',
        solution: expect.objectContaining({
          finalAnswer: '2',
          solverModel: 'codex',
        }),
      }),
      expect.objectContaining({
        subQuestionId: 'sq_2',
        solution: expect.objectContaining({
          finalAnswer: 'x = 2',
          solverModel: 'codex',
        }),
      }),
    ]);
  });

  it('falls back to secondary provider and then placeholder when needed', async () => {
    const { run } = await import('@/workflow/nodes/selfSolve');

    const primaryChat = vi.fn().mockRejectedValue(new Error('codex failed'));
    const fallbackChat = vi.fn(async (request: { messages: Array<{ content: string }> }) => {
      const prompt = request.messages[0]?.content ?? '';
      if (prompt.includes('计算 3 + 4')) {
        return {
          text: JSON.stringify({
            steps: [{ text: '直接计算', formula: '3 + 4 = 7' }],
            finalAnswer: '7',
            confidence: 0.82,
          }),
          model: 'sonnet',
          usage: { durationMs: 12 },
        };
      }

      throw new Error('claude failed');
    });

    routerMocks.pickProvider.mockReturnValue({
      name: 'codex',
      supportsPromptCache: false,
      supportsVision: false,
      healthCheck: vi.fn(),
      chat: primaryChat,
      vision: vi.fn(),
    });
    routerMocks.pickFallback.mockReturnValue({
      name: 'claude',
      supportsPromptCache: true,
      supportsVision: true,
      healthCheck: vi.fn(),
      chat: fallbackChat,
      vision: vi.fn(),
    });

    const result = await run(
      {
        parseQuestion: {
          items: [
            {
              subQuestionId: 'sq_ok',
              cropPath: 'crops/asg/sq_ok.jpg',
              parsed: {
                subject: 'math',
                questionType: 'computation',
                stemText: '计算 3 + 4',
                knownConditions: [],
                goal: '求结果',
              },
            },
            {
              subQuestionId: 'sq_placeholder',
              cropPath: 'crops/asg/sq_placeholder.jpg',
              parsed: {
                subject: 'math',
                questionType: 'function-analysis',
                stemText: '已知函数 y=x^2，说明图像特征',
                knownConditions: ['函数 y=x^2'],
                goal: '说明图像特征',
              },
            },
          ],
        },
      },
      {
        assignmentId: 'asg_selfsolve_2',
        originalImagePath: 'incoming/a.jpg',
        childId: 'child_1',
        subject: 'math',
      },
    );

    expect(primaryChat).toHaveBeenCalledTimes(2);
    expect(fallbackChat).toHaveBeenCalledTimes(2);
    expect(result.isPlaceholder).toBe(true);
    expect(result.items[0]).toMatchObject({
      subQuestionId: 'sq_ok',
      solution: {
        finalAnswer: '7',
        solverModel: 'claude',
      },
    });
    expect(result.items[1]?.solution).toMatchObject({
      finalAnswer: '待识别',
      solverModel: 'codex',
      confidence: 0.1,
    });
  });
});
