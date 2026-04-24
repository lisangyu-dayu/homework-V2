import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import type { ParsedMathQuestion } from '@/lib/types';
import { logger } from '@/lib/logger';
import { crop, resizeForVision } from '@/mcp/imageCrop';
import { pickFallback, pickProvider } from '@/providers/router';
import type { LLMProvider, VisionImage } from '@/providers/types';
import type { AssignmentCtx } from '../index';
import { extractJsonBlock, type LayoutSplitResult } from './layoutSplit';

const DiagramExtractSchema = z.object({
  type: z.enum(['geometry', 'coordinate', 'table', 'chart']),
  description: z.string().trim().min(1),
  extractedObjects: z.array(
    z.object({
      name: z.string().trim().min(1),
      properties: z.array(z.string().trim().min(1)).default([]),
    }),
  ).optional(),
  markedConditions: z.array(z.string().trim().min(1)).optional(),
});

const ChoiceSchema = z.object({
  label: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

export const ParsedMathQuestionSchema = z.object({
  subject: z.literal('math'),
  questionType: z.enum([
    'multiple-choice',
    'fill-blank',
    'computation',
    'solve-equation',
    'word-problem',
    'geometry-proof',
    'geometry-compute',
    'function-analysis',
  ]),
  stemText: z.string().trim().min(1),
  diagrams: z.array(DiagramExtractSchema).optional(),
  knownConditions: z.array(z.string().trim().min(1)),
  goal: z.string().trim().min(1),
  choices: z.array(ChoiceSchema).optional(),
});

export interface ParseQuestionResult {
  isPlaceholder?: boolean;
  items: Array<{ subQuestionId: string; parsed: ParsedMathQuestion; cropPath: string }>;
}

interface ParseQuestionDeps {
  preprocess?: {
    processedPath: string;
  };
  layoutSplit?: LayoutSplitResult;
}

interface SubQuestionTask {
  majorNumber: string;
  subNumber: string;
  subQuestionId: string;
  cropPath: string;
  cropBuffer: Buffer;
}

function toMediaType(format?: string | null): VisionImage['mediaType'] {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function buildPlaceholderParsed(majorNumber: string, subNumber: string): ParsedMathQuestion {
  return {
    subject: 'math',
    questionType: 'computation',
    stemText: `占位解析：已裁出题目 ${majorNumber}${subNumber}，等待接入真实题面结构化识别。`,
    knownConditions: [],
    goal: '等待识别',
  };
}

function buildSystemPrompt(): string {
  return [
    '你是初中数学题面结构化助手。',
    '你的职责只有“描述题目”，不要解题，不要推导，不要给最终答案。',
    '请把单道小题整理成 ParsedMathQuestion 结构化 JSON。',
    '如果是选择题，要把 choices 填完整；如果没有选项，不要输出 choices。',
    '如果图中有几何图、坐标系、表格或统计图，请在 diagrams 中提取。',
    '只输出 JSON，不要输出解释、Markdown 或代码块外文本。',
  ].join('\n');
}

function buildUserPrompt(majorNumber: string, subNumber: string): string {
  return [
    `当前图片对应题号：${majorNumber}${subNumber}。`,
    '这是“先描述、后求解”的第一步，你必须只做题面结构化，不得尝试计算答案。',
    '请输出如下 JSON：',
    '{',
    '  "subject": "math",',
    '  "questionType": "computation | solve-equation | ...",',
    '  "stemText": "完整题干，公式改写成便于后续求解的纯文本",',
    '  "diagrams": [{ "type": "geometry", "description": "...", "extractedObjects": [], "markedConditions": [] }],',
    '  "knownConditions": ["条件1", "条件2"],',
    '  "goal": "要求什么",',
    '  "choices": [{ "label": "A", "text": "..." }]',
    '}',
    '要求：',
    '1. stemText 要保留题面关键信息，不要只写摘要。',
    '2. knownConditions 只写题目中明确给出的已知条件。',
    '3. goal 只写题目的求解/证明目标。',
    '4. 图形信息不足时可以省略 diagrams，但不能编造条件。',
  ].join('\n');
}

export function parseQuestionResponse(text: string): ParsedMathQuestion {
  const raw = JSON.parse(extractJsonBlock(text)) as unknown;
  return ParsedMathQuestionSchema.parse(raw);
}

async function callParseQuestionProvider(
  provider: LLMProvider,
  task: SubQuestionTask,
): Promise<ParsedMathQuestion> {
  if (!provider.supportsVision) {
    throw new Error(`provider ${provider.name} does not support vision`);
  }

  const analysisBuffer = await resizeForVision(task.cropBuffer);
  const analysisMeta = await sharp(analysisBuffer).metadata();
  const image: VisionImage = {
    data: analysisBuffer,
    mediaType: toMediaType(analysisMeta.format),
  };

  const response = await provider.vision({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(task.majorNumber, task.subNumber) }],
    images: [image],
    temperature: 0.1,
  });

  return parseQuestionResponse(response.text);
}

async function resolveProcessedPath(ctx: AssignmentCtx, preprocessPath?: string): Promise<string> {
  const cfg = loadConfig();
  const candidate = preprocessPath ?? ctx.originalImagePath;
  return path.isAbsolute(candidate) ? candidate : path.join(cfg.uploadDir, candidate);
}

async function buildSubQuestionTasks(
  processedPath: string,
  layout: LayoutSplitResult | undefined,
  ctx: AssignmentCtx,
): Promise<SubQuestionTask[]> {
  const cfg = loadConfig();
  const pageBuffer = await fs.readFile(processedPath);
  const pageMeta = await sharp(pageBuffer).metadata();
  const pageWidth = Math.max(1, pageMeta.width ?? 1);
  const pageHeight = Math.max(1, pageMeta.height ?? 1);

  const entries = layout?.majorQuestions.flatMap((major, majorIndex) =>
    major.subQuestions.map((sub, subIndex) => ({
      majorNumber: major.number,
      subNumber: sub.number,
      bbox: sub.bbox,
      subQuestionId: `${ctx.assignmentId}_sq_${majorIndex + 1}_${subIndex + 1}`,
    })),
  ) ?? [{
    majorNumber: '一',
    subNumber: '(1)',
    bbox: { x: 0, y: 0, w: pageWidth, h: pageHeight },
    subQuestionId: `${ctx.assignmentId}_sq_1_1`,
  }];

  return Promise.all(entries.map(async (entry) => {
    const cropPath = path.join('crops', ctx.assignmentId, `${entry.subQuestionId}.jpg`);
    const absoluteCropPath = path.join(cfg.uploadDir, cropPath);
    await fs.mkdir(path.dirname(absoluteCropPath), { recursive: true });
    const cropped = await crop(pageBuffer, entry.bbox);
    const jpegBuffer = await sharp(cropped).jpeg({ quality: 92 }).toBuffer();
    await fs.writeFile(absoluteCropPath, jpegBuffer);

    return {
      majorNumber: entry.majorNumber,
      subNumber: entry.subNumber,
      subQuestionId: entry.subQuestionId,
      cropPath,
      cropBuffer: jpegBuffer,
    };
  }));
}

async function parseSingleSubQuestion(
  task: SubQuestionTask,
  ctx: AssignmentCtx,
): Promise<{ item: ParseQuestionResult['items'][number]; usedPlaceholder: boolean }> {
  const primary = pickProvider({ task: 'parseQuestion' });

  try {
    const parsed = await callParseQuestionProvider(primary, task);
    return {
      usedPlaceholder: false,
      item: {
        subQuestionId: task.subQuestionId,
        cropPath: task.cropPath,
        parsed,
      },
    };
  } catch (primaryError) {
    const fallback = pickFallback('parseQuestion', primary.name);
    if (fallback) {
      try {
        const parsed = await callParseQuestionProvider(fallback, task);
        return {
          usedPlaceholder: false,
          item: {
            subQuestionId: task.subQuestionId,
            cropPath: task.cropPath,
            parsed,
          },
        };
      } catch (fallbackError) {
        logger.warn(
          {
            assignmentId: ctx.assignmentId,
            subQuestionId: task.subQuestionId,
            provider: primary.name,
            fallbackProvider: fallback.name,
            err: primaryError instanceof Error ? primaryError.message : String(primaryError),
            fallbackErr: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
          'parseQuestion provider failed; using placeholder parse result',
        );
      }
    } else {
      logger.warn(
        {
          assignmentId: ctx.assignmentId,
          subQuestionId: task.subQuestionId,
          provider: primary.name,
          err: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
        'parseQuestion provider failed; using placeholder parse result',
      );
    }

    return {
      usedPlaceholder: true,
      item: {
        subQuestionId: task.subQuestionId,
        cropPath: task.cropPath,
        parsed: buildPlaceholderParsed(task.majorNumber, task.subNumber),
      },
    };
  }
}

export async function run(
  deps: ParseQuestionDeps | unknown,
  ctx: AssignmentCtx,
): Promise<ParseQuestionResult> {
  const typedDeps = deps as ParseQuestionDeps;
  const processedPath = await resolveProcessedPath(ctx, typedDeps.preprocess?.processedPath);
  const tasks = await buildSubQuestionTasks(processedPath, typedDeps.layoutSplit, ctx);
  const results = await Promise.all(tasks.map((task) => parseSingleSubQuestion(task, ctx)));

  return {
    isPlaceholder: results.some((result) => result.usedPlaceholder) ? true : undefined,
    items: results.map((result) => result.item),
  };
}
