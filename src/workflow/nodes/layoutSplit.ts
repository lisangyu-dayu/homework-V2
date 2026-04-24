import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { resizeForVision, type BBox } from '@/mcp/imageCrop';
import { pickFallback, pickProvider } from '@/providers/router';
import type { LLMProvider, VisionImage } from '@/providers/types';
import type { AssignmentCtx } from '../index';

const RawBBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
});

const RawSubQuestionSchema = z.object({
  number: z.string().trim().min(1),
  bbox: RawBBoxSchema,
});

const RawMajorQuestionSchema = z.object({
  number: z.string().trim().min(1),
  bbox: RawBBoxSchema,
  subQuestions: z.array(RawSubQuestionSchema).min(1),
});

export const LayoutSplitSchema = z.object({
  majorQuestions: z.array(RawMajorQuestionSchema).min(1),
});

export interface LayoutSplitResult {
  majorQuestions: Array<{
    number: string;
    bbox: BBox;
    subQuestions: Array<{ number: string; bbox: BBox }>;
  }>;
}

interface LayoutSplitDeps {
  preprocess?: {
    processedPath: string;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundFinite(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function normalizeAndScaleBBox(
  rawBox: z.infer<typeof RawBBoxSchema>,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): BBox {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const safeTargetWidth = Math.max(1, targetWidth);
  const safeTargetHeight = Math.max(1, targetHeight);
  const scaleX = safeTargetWidth / safeSourceWidth;
  const scaleY = safeTargetHeight / safeSourceHeight;

  const x = clamp(roundFinite(rawBox.x * scaleX), 0, safeTargetWidth - 1);
  const y = clamp(roundFinite(rawBox.y * scaleY), 0, safeTargetHeight - 1);
  const maxWidth = Math.max(1, safeTargetWidth - x);
  const maxHeight = Math.max(1, safeTargetHeight - y);
  const w = clamp(roundFinite(rawBox.w * scaleX), 1, maxWidth);
  const h = clamp(roundFinite(rawBox.h * scaleY), 1, maxHeight);

  return { x, y, w, h };
}

function sortByTopLeft<T extends { bbox: BBox }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
    if (a.bbox.x !== b.bbox.x) return a.bbox.x - b.bbox.x;
    return 0;
  });
}

export function buildFallbackLayoutSplit(width: number, height: number): LayoutSplitResult {
  const fullPageBox: BBox = {
    x: 0,
    y: 0,
    w: Math.max(1, width),
    h: Math.max(1, height),
  };

  return {
    majorQuestions: [
      {
        number: '一',
        bbox: fullPageBox,
        subQuestions: [{ number: '(1)', bbox: fullPageBox }],
      },
    ],
  };
}

export function extractJsonBlock(text: string): string {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('layoutSplit response is empty');
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function parseLayoutSplitResponse(
  text: string,
  analysisWidth: number,
  analysisHeight: number,
  originalWidth: number,
  originalHeight: number,
): LayoutSplitResult {
  const raw = JSON.parse(extractJsonBlock(text)) as unknown;
  const parsed = LayoutSplitSchema.parse(raw);

  return {
    majorQuestions: sortByTopLeft(
      parsed.majorQuestions.map((major) => ({
        number: major.number,
        bbox: normalizeAndScaleBBox(major.bbox, analysisWidth, analysisHeight, originalWidth, originalHeight),
        subQuestions: sortByTopLeft(
          major.subQuestions.map((sub) => ({
            number: sub.number,
            bbox: normalizeAndScaleBBox(sub.bbox, analysisWidth, analysisHeight, originalWidth, originalHeight),
          })),
        ),
      })),
    ),
  };
}

function toMediaType(format?: string | null): VisionImage['mediaType'] {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function buildSystemPrompt(): string {
  return [
    '你是数学作业版面拆题助手。',
    '任务是把整页作业图拆成“大题 -> 小题”的层级，并返回严格 JSON。',
    '必须识别题号，例如：一、二、三；1、2、3；(1)(2)(3)；①②③。',
    'bbox 使用像素坐标，字段为 x/y/w/h，且必须对应当前提供图片的像素尺寸。',
    '如果一张图里只能确认一个大题或一个小题，也必须返回至少 1 个 majorQuestions 和 1 个 subQuestions。',
    '不要输出任何解释、注释或 Markdown，只输出 JSON。',
  ].join('\n');
}

function buildUserPrompt(analysisWidth: number, analysisHeight: number): string {
  return [
    `当前图片尺寸：${analysisWidth}x${analysisHeight} 像素。`,
    '请输出如下 JSON：',
    '{',
    '  "majorQuestions": [',
    '    {',
    '      "number": "一",',
    '      "bbox": { "x": 0, "y": 0, "w": 100, "h": 100 },',
    '      "subQuestions": [',
    '        { "number": "(1)", "bbox": { "x": 0, "y": 0, "w": 100, "h": 40 } }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '要求：',
    '1. majorQuestions、subQuestions 必须按页面阅读顺序排序。',
    '2. bbox 要尽量包住对应题面，不要超出图片边界。',
    '3. 题号无法完全确认时，保留你最有把握的编号文本，但不要留空。',
  ].join('\n');
}

async function callLayoutSplitProvider(
  provider: LLMProvider,
  image: VisionImage,
  analysisWidth: number,
  analysisHeight: number,
  originalWidth: number,
  originalHeight: number,
): Promise<LayoutSplitResult> {
  if (!provider.supportsVision) {
    throw new Error(`provider ${provider.name} does not support vision`);
  }

  const response = await provider.vision({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(analysisWidth, analysisHeight) }],
    images: [image],
    temperature: 0.1,
  });

  return parseLayoutSplitResponse(
    response.text,
    analysisWidth,
    analysisHeight,
    originalWidth,
    originalHeight,
  );
}

export async function run(
  deps: LayoutSplitDeps | unknown,
  ctx: AssignmentCtx,
): Promise<LayoutSplitResult> {
  const preprocessResult = (deps as LayoutSplitDeps).preprocess;
  const cfg = loadConfig();
  const processedPath = preprocessResult?.processedPath
    ? (path.isAbsolute(preprocessResult.processedPath)
      ? preprocessResult.processedPath
      : path.join(cfg.uploadDir, preprocessResult.processedPath))
    : (path.isAbsolute(ctx.originalImagePath)
      ? ctx.originalImagePath
      : path.join(cfg.uploadDir, ctx.originalImagePath));

  const imageBuffer = await fs.readFile(processedPath);
  const originalMeta = await sharp(imageBuffer).metadata();
  const originalWidth = Math.max(1, originalMeta.width ?? 1);
  const originalHeight = Math.max(1, originalMeta.height ?? 1);

  const analysisBuffer = await resizeForVision(imageBuffer);
  const analysisMeta = await sharp(analysisBuffer).metadata();
  const analysisWidth = Math.max(1, analysisMeta.width ?? originalWidth);
  const analysisHeight = Math.max(1, analysisMeta.height ?? originalHeight);
  const analysisImage: VisionImage = {
    data: analysisBuffer,
    mediaType: toMediaType(analysisMeta.format),
  };

  const primary = pickProvider({ task: 'layoutSplit' });

  try {
    return await callLayoutSplitProvider(
      primary,
      analysisImage,
      analysisWidth,
      analysisHeight,
      originalWidth,
      originalHeight,
    );
  } catch (primaryError) {
    const fallback = pickFallback('layoutSplit', primary.name);
    if (fallback) {
      try {
        return await callLayoutSplitProvider(
          fallback,
          analysisImage,
          analysisWidth,
          analysisHeight,
          originalWidth,
          originalHeight,
        );
      } catch (fallbackError) {
        logger.warn(
          {
            assignmentId: ctx.assignmentId,
            processedPath,
            provider: primary.name,
            fallbackProvider: fallback.name,
            err: primaryError instanceof Error ? primaryError.message : String(primaryError),
            fallbackErr: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
          'layoutSplit provider failed; using full-page fallback',
        );
        return buildFallbackLayoutSplit(originalWidth, originalHeight);
      }
    }

    logger.warn(
      {
        assignmentId: ctx.assignmentId,
        processedPath,
        provider: primary.name,
        err: primaryError instanceof Error ? primaryError.message : String(primaryError),
      },
      'layoutSplit provider failed; using full-page fallback',
    );
    return buildFallbackLayoutSplit(originalWidth, originalHeight);
  }
}
