import { z } from 'zod';
import { logger } from '@/lib/logger';
import { pickFallback, pickProvider } from '@/providers/router';
import type { LLMProvider } from '@/providers/types';
import type { AssignmentCtx } from '../index';
import type { GradeResult } from './grade';
import { extractJsonBlock } from './layoutSplit';
import type { ParseQuestionResult } from './parseQuestion';
import type { SelfSolveResult } from './selfSolve';

export interface ExplanationResult {
  items: Array<{ subQuestionId: string; explanationMd: string; errorType?: string }>;
}

const ExplanationResponseSchema = z.object({
  explanationMd: z.string().trim().min(1),
  errorType: z.string().trim().min(1).optional(),
});

interface ExplanationDeps {
  grade?: GradeResult;
  parseQuestion?: ParseQuestionResult;
  selfSolve?: SelfSolveResult;
}

interface ExplanationInput {
  parsed?: ParseQuestionResult['items'][number]['parsed'];
  solution?: SelfSolveResult['items'][number]['solution'];
  grading: GradeResult['items'][number]['grading'];
}

function buildSystemPrompt(): string {
  return [
    'You write concise math feedback for a parent and student.',
    'Return strict JSON with explanationMd and optional errorType.',
    'explanationMd must be Markdown and may include LaTeX math.',
    'Do not mention model uncertainty or internal workflow details.',
  ].join('\n');
}

function buildUserPrompt(input: ExplanationInput): string {
  return [
    'Generate a clear explanation for this graded math question.',
    'Question:',
    JSON.stringify(input.parsed ?? null),
    'Reference solution:',
    JSON.stringify(input.solution ?? null),
    'Grading:',
    JSON.stringify(input.grading),
    'Output JSON:',
    '{"explanationMd":"Markdown explanation with LaTeX where helpful","errorType":"optional concise error type"}',
  ].join('\n');
}

function parseExplanationResponse(text: string): { explanationMd: string; errorType?: string } {
  const raw = JSON.parse(extractJsonBlock(text)) as unknown;
  return ExplanationResponseSchema.parse(raw);
}

async function callExplanationProvider(
  provider: LLMProvider,
  input: ExplanationInput,
): Promise<{ explanationMd: string; errorType?: string }> {
  const response = await provider.chat({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    temperature: 0.2,
  });

  return parseExplanationResponse(response.text);
}

function buildFallbackExplanation(input: ExplanationInput): { explanationMd: string; errorType?: string } {
  const steps = input.solution?.steps.map((step, index) => {
    const formula = step.formula ? `：$${step.formula}$` : '';
    return `${index + 1}. ${step.text}${formula}`;
  }) ?? [];

  const heading = input.grading.verdict === 'correct'
    ? '这题答案正确。'
    : input.grading.verdict === 'wrong'
      ? '这题需要回看关键步骤。'
      : '这题暂不自动判定。';

  return {
    explanationMd: [heading, ...steps, `参考答案：${input.solution?.finalAnswer ?? '暂缺'}`].join('\n\n'),
    errorType: input.grading.errorType,
  };
}

async function explainOne(
  item: GradeResult['items'][number],
  deps: ExplanationDeps,
  ctx: AssignmentCtx,
): Promise<ExplanationResult['items'][number]> {
  const parsed = deps.parseQuestion?.items.find((candidate) => candidate.subQuestionId === item.subQuestionId)?.parsed;
  const solution = deps.selfSolve?.items.find((candidate) => candidate.subQuestionId === item.subQuestionId)?.solution;
  const input = { parsed, solution, grading: item.grading };
  const primary = pickProvider({ task: 'generateExplanation' });

  try {
    return {
      subQuestionId: item.subQuestionId,
      ...(await callExplanationProvider(primary, input)),
    };
  } catch (primaryError) {
    const fallback = pickFallback('generateExplanation', primary.name);
    if (fallback) {
      try {
        return {
          subQuestionId: item.subQuestionId,
          ...(await callExplanationProvider(fallback, input)),
        };
      } catch (fallbackError) {
        logger.warn(
          {
            assignmentId: ctx.assignmentId,
            subQuestionId: item.subQuestionId,
            provider: primary.name,
            fallbackProvider: fallback.name,
            err: primaryError instanceof Error ? primaryError.message : String(primaryError),
            fallbackErr: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
          'generateExplanation provider failed; using deterministic explanation',
        );
      }
    } else {
      logger.warn(
        {
          assignmentId: ctx.assignmentId,
          subQuestionId: item.subQuestionId,
          provider: primary.name,
          err: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
        'generateExplanation provider failed; using deterministic explanation',
      );
    }

    return {
      subQuestionId: item.subQuestionId,
      ...buildFallbackExplanation(input),
    };
  }
}

export async function run(deps: ExplanationDeps | unknown, ctx: AssignmentCtx): Promise<ExplanationResult> {
  const typedDeps = deps as ExplanationDeps;
  const gradeResult = typedDeps.grade;
  return {
    items: await Promise.all((gradeResult?.items ?? []).map((item) => explainOne(item, typedDeps, ctx))),
  };
}
