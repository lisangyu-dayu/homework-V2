import { z } from 'zod';
import { logger } from '@/lib/logger';
import * as kp from '@/mcp/knowledgePoints';
import { pickFallback, pickProvider } from '@/providers/router';
import type { LLMProvider } from '@/providers/types';
import type { AssignmentCtx } from '../index';
import { extractJsonBlock } from './layoutSplit';
import type { ParseQuestionResult } from './parseQuestion';

export interface KpTaggingResult {
  items: Array<{ subQuestionId: string; tagIds: Array<{ id: string; confidence: number }> }>;
}

const RerankResponseSchema = z.object({
  tags: z.array(z.object({
    id: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
  })).max(5),
});

interface KpTaggingDeps {
  parseQuestion?: ParseQuestionResult;
}

function buildRecallText(item: ParseQuestionResult['items'][number]): string {
  const parsed = item.parsed;
  return [
    parsed.questionType,
    parsed.stemText,
    parsed.goal,
    ...parsed.knownConditions,
    ...(parsed.choices ?? []).flatMap((choice) => [choice.label, choice.text]),
    ...(parsed.diagrams ?? []).flatMap((diagram) => [
      diagram.type,
      diagram.description,
      ...(diagram.markedConditions ?? []),
      ...(diagram.extractedObjects ?? []).flatMap((object) => [object.name, ...object.properties]),
    ]),
  ].join('\n');
}

function normalizeCandidates(
  candidates: Array<{ id: string; name: string; confidence?: number }>,
): Array<{ id: string; name: string; confidence: number }> {
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string; confidence: number }> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    result.push({ id: candidate.id, name: candidate.name, confidence: candidate.confidence ?? 0.55 });
  }
  return result;
}

function deterministicRank(candidates: Array<{ id: string; name: string; confidence: number }>): Array<{ id: string; confidence: number }> {
  return candidates.slice(0, 5).map((candidate, index) => ({
    id: candidate.id,
    confidence: Math.max(0.35, candidate.confidence - index * 0.05),
  }));
}

function buildSystemPrompt(): string {
  return [
    'You select the most relevant math knowledge tags for a question.',
    'Use only candidate IDs provided by the user.',
    'Return strict JSON: {"tags":[{"id":"...","confidence":0.0}]}',
  ].join('\n');
}

function buildUserPrompt(input: {
  question: ParseQuestionResult['items'][number]['parsed'];
  candidates: Array<{ id: string; name: string; confidence: number }>;
}): string {
  return [
    'Question:',
    JSON.stringify(input.question),
    'Candidate tags:',
    JSON.stringify(input.candidates),
    'Pick at most 5 tags. Use confidence between 0 and 1.',
  ].join('\n');
}

async function rerankWithProvider(
  provider: LLMProvider,
  input: {
    question: ParseQuestionResult['items'][number]['parsed'];
    candidates: Array<{ id: string; name: string; confidence: number }>;
  },
): Promise<Array<{ id: string; confidence: number }>> {
  const response = await provider.chat({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    temperature: 0,
  });
  const parsed = RerankResponseSchema.parse(JSON.parse(extractJsonBlock(response.text)) as unknown);
  const candidateIds = new Set(input.candidates.map((candidate) => candidate.id));
  return parsed.tags.filter((tag) => candidateIds.has(tag.id));
}

async function tagOne(
  item: ParseQuestionResult['items'][number],
  ctx: AssignmentCtx,
): Promise<KpTaggingResult['items'][number]> {
  const candidates = normalizeCandidates(await kp.search(buildRecallText(item), {
    subject: item.parsed.subject,
    topK: 20,
  }));

  if (candidates.length === 0) {
    return { subQuestionId: item.subQuestionId, tagIds: [] };
  }

  const primary = pickProvider({ task: 'kpTagging' });
  try {
    return {
      subQuestionId: item.subQuestionId,
      tagIds: await rerankWithProvider(primary, { question: item.parsed, candidates }),
    };
  } catch (primaryError) {
    const fallback = pickFallback('kpTagging', primary.name);
    if (fallback) {
      try {
        return {
          subQuestionId: item.subQuestionId,
          tagIds: await rerankWithProvider(fallback, { question: item.parsed, candidates }),
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
          'kpTagging provider failed; using deterministic ranking',
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
        'kpTagging provider failed; using deterministic ranking',
      );
    }

    return {
      subQuestionId: item.subQuestionId,
      tagIds: deterministicRank(candidates),
    };
  }
}

export async function run(deps: KpTaggingDeps | unknown, ctx: AssignmentCtx): Promise<KpTaggingResult> {
  const parseResult = (deps as KpTaggingDeps).parseQuestion;
  return {
    items: await Promise.all((parseResult?.items ?? []).map((item) => tagOne(item, ctx))),
  };
}
