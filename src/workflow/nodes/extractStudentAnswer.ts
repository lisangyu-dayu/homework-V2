import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { resizeForVision } from '@/mcp/imageCrop';
import { pickFallback, pickProvider } from '@/providers/router';
import type { LLMProvider, VisionImage } from '@/providers/types';
import type { AssignmentCtx } from '../index';
import { extractJsonBlock } from './layoutSplit';
import type { ParseQuestionResult } from './parseQuestion';

const ExtractStudentAnswerResponseSchema = z.object({
  answer: z.union([z.string().trim().min(1), z.literal('unclear')]),
  confidence: z.number().min(0).max(1),
});

export interface ExtractResult {
  items: Array<{
    subQuestionId: string;
    studentAnswer: string | null;
    confidence: number;
  }>;
}

interface ExtractDeps {
  parseQuestion?: ParseQuestionResult;
}

function toMediaType(format?: string | null): VisionImage['mediaType'] {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function buildSystemPrompt(): string {
  return [
    'You extract only the student-written answer from a cropped math question image.',
    'Return strict JSON with fields answer and confidence.',
    'If the handwriting or answer area is missing, set answer to "unclear".',
    'Do not solve the problem and do not infer an answer that is not written by the student.',
  ].join('\n');
}

function buildUserPrompt(item: ParseQuestionResult['items'][number]): string {
  return [
    'Extract the student answer for this math sub-question.',
    'Question metadata:',
    JSON.stringify(item.parsed),
    'Output format:',
    '{"answer":"student answer text or unclear","confidence":0.0}',
    'Use "unclear" whenever confidence is low or no student answer is visible.',
  ].join('\n');
}

export function parseStudentAnswerResponse(text: string): { studentAnswer: string | null; confidence: number } {
  const raw = JSON.parse(extractJsonBlock(text)) as unknown;
  const parsed = ExtractStudentAnswerResponseSchema.parse(raw);
  const answer = parsed.answer === 'unclear' || parsed.confidence < 0.45 ? null : parsed.answer;
  return { studentAnswer: answer, confidence: parsed.confidence };
}

async function callExtractProvider(
  provider: LLMProvider,
  item: ParseQuestionResult['items'][number],
  cropPath: string,
): Promise<{ studentAnswer: string | null; confidence: number }> {
  if (!provider.supportsVision) {
    throw new Error(`provider ${provider.name} does not support vision`);
  }

  const cropBuffer = await fs.readFile(cropPath);
  const analysisBuffer = await resizeForVision(cropBuffer);
  const analysisMeta = await sharp(analysisBuffer).metadata();
  const response = await provider.vision({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(item) }],
    images: [{ data: analysisBuffer, mediaType: toMediaType(analysisMeta.format) }],
    temperature: 0,
  });

  return parseStudentAnswerResponse(response.text);
}

async function extractOne(
  item: ParseQuestionResult['items'][number],
  ctx: AssignmentCtx,
): Promise<ExtractResult['items'][number]> {
  const cfg = loadConfig();
  const cropPath = path.isAbsolute(item.cropPath) ? item.cropPath : path.join(cfg.uploadDir, item.cropPath);
  const primary = pickProvider({ task: 'extractStudentAnswer' });

  try {
    return {
      subQuestionId: item.subQuestionId,
      ...(await callExtractProvider(primary, item, cropPath)),
    };
  } catch (primaryError) {
    const fallback = pickFallback('extractStudentAnswer', primary.name);
    if (fallback) {
      try {
        return {
          subQuestionId: item.subQuestionId,
          ...(await callExtractProvider(fallback, item, cropPath)),
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
          'extractStudentAnswer provider failed; marking answer unclear',
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
        'extractStudentAnswer provider failed; marking answer unclear',
      );
    }

    return {
      subQuestionId: item.subQuestionId,
      studentAnswer: null,
      confidence: 0,
    };
  }
}

export async function run(deps: ExtractDeps | unknown, ctx: AssignmentCtx): Promise<ExtractResult> {
  const parseResult = (deps as ExtractDeps).parseQuestion;
  return {
    items: await Promise.all((parseResult?.items ?? []).map((item) => extractOne(item, ctx))),
  };
}
