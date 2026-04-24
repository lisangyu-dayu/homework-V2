import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { Solution } from '@/lib/types';
import { pickFallback, pickProvider } from '@/providers/router';
import type { LLMProvider } from '@/providers/types';
import type { AssignmentCtx } from '../index';
import { extractJsonBlock } from './layoutSplit';
import type { ParseQuestionResult } from './parseQuestion';

const SolutionStepSchema = z.object({
  text: z.string().trim().min(1),
  formula: z.string().trim().min(1).optional(),
});

export const SelfSolveResponseSchema = z.object({
  steps: z.array(SolutionStepSchema).min(1),
  finalAnswer: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

export interface SelfSolveResult {
  isPlaceholder?: boolean;
  items: Array<{ subQuestionId: string; solution: Solution }>;
}

interface SelfSolveDeps {
  parseQuestion?: ParseQuestionResult;
}

function buildSystemPrompt(): string {
  return [
    '你是初中数学解题助手。',
    '请基于给定的结构化题面求解，并只输出严格 JSON。',
    'steps 必须是简洁、可展示的解题步骤，不要输出与题目无关的思考过程。',
    'finalAnswer 只写最终答案或最终结论。',
    'confidence 取 0 到 1 之间的小数。',
    '不要输出 Markdown，不要解释 JSON 结构。',
  ].join('\n');
}

function buildUserPrompt(parsed: ParseQuestionResult['items'][number]['parsed']): string {
  return [
    '请解答下面这道数学题。',
    '这是“先描述、后求解”的第二步，现在只需要基于题面结构给出解题步骤和最终答案。',
    '题面 JSON：',
    JSON.stringify(parsed, null, 2),
    '输出格式：',
    '{',
    '  "steps": [',
    '    { "text": "步骤说明", "formula": "可选公式" }',
    '  ],',
    '  "finalAnswer": "最终答案",',
    '  "confidence": 0.85',
    '}',
    '要求：',
    '1. steps 至少 1 步，按解题顺序排列。',
    '2. 若题目无法完全求解，也要给出最有把握的中间推导与当前结论。',
    '3. 不要重复抄写完整题干，步骤只保留关键变形和结论。',
  ].join('\n');
}

function buildPlaceholderSolution(): Solution {
  return {
    steps: [{ text: '占位求解：题面已结构化，等待真实求解器输出步骤。' }],
    finalAnswer: '待识别',
    confidence: 0.1,
    solverModel: 'codex',
  };
}

export function parseSelfSolveResponse(
  text: string,
  solverModel: 'claude' | 'codex',
): Solution {
  const raw = JSON.parse(extractJsonBlock(text)) as unknown;
  const parsed = SelfSolveResponseSchema.parse(raw);
  return {
    steps: parsed.steps,
    finalAnswer: parsed.finalAnswer,
    confidence: parsed.confidence,
    solverModel,
  };
}

async function callSelfSolveProvider(
  provider: LLMProvider,
  parsed: ParseQuestionResult['items'][number]['parsed'],
): Promise<Solution> {
  const response = await provider.chat({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(parsed) }],
    temperature: 0.1,
  });

  return parseSelfSolveResponse(response.text, provider.name);
}

async function solveSingleQuestion(
  provider: LLMProvider,
  fallback: LLMProvider | null,
  item: ParseQuestionResult['items'][number],
  ctx: AssignmentCtx,
): Promise<{ subQuestionId: string; solution: Solution; usedPlaceholder: boolean }> {
  try {
    return {
      subQuestionId: item.subQuestionId,
      solution: await callSelfSolveProvider(provider, item.parsed),
      usedPlaceholder: false,
    };
  } catch (primaryError) {
    if (fallback) {
      try {
        return {
          subQuestionId: item.subQuestionId,
          solution: await callSelfSolveProvider(fallback, item.parsed),
          usedPlaceholder: false,
        };
      } catch (fallbackError) {
        logger.warn(
          {
            assignmentId: ctx.assignmentId,
            subQuestionId: item.subQuestionId,
            provider: provider.name,
            fallbackProvider: fallback.name,
            err: primaryError instanceof Error ? primaryError.message : String(primaryError),
            fallbackErr: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
          'selfSolve provider failed; using placeholder solution',
        );
      }
    } else {
      logger.warn(
        {
          assignmentId: ctx.assignmentId,
          subQuestionId: item.subQuestionId,
          provider: provider.name,
          err: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
        'selfSolve provider failed; using placeholder solution',
      );
    }

    return {
      subQuestionId: item.subQuestionId,
      solution: buildPlaceholderSolution(),
      usedPlaceholder: true,
    };
  }
}

export async function run(
  deps: SelfSolveDeps | unknown,
  ctx: AssignmentCtx,
): Promise<SelfSolveResult> {
  const parseResult = (deps as SelfSolveDeps).parseQuestion;
  const items = parseResult?.items ?? [];
  const primary = pickProvider({ task: 'selfSolve' });
  const fallback = pickFallback('selfSolve', primary.name);
  const results = await Promise.all(items.map((item) => solveSingleQuestion(primary, fallback, item, ctx)));

  return {
    isPlaceholder: results.some((result) => result.usedPlaceholder) ? true : undefined,
    items: results.map((result) => ({
      subQuestionId: result.subQuestionId,
      solution: result.solution,
    })),
  };
}
