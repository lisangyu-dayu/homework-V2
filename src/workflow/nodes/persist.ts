import { nanoid } from 'nanoid';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getById } from '@/db/dao/assignments';
import { getById as getKnowledgeTagById } from '@/db/dao/tags';
import {
  persistAssignmentQuestionResults,
  type AutoMistakeInput,
  type SubQuestionInput,
} from '@/db/dao/questions';
import { loadConfig } from '@/lib/config';
import type { AssignmentStats, KnowledgeTag, ParsedMathQuestion, SolutionStep, Subject, Verdict } from '@/lib/types';
import type { AssignmentCtx } from '../index';
import type { ExplanationResult } from './generateExplanation';
import type { GradeResult } from './grade';
import type { KpTaggingResult } from './kpTagging';
import type { ParseQuestionResult } from './parseQuestion';
import type { SelfSolveResult } from './selfSolve';

export interface PersistResult {
  assignmentId: string;
}

function assertWorkflowReady(deps: {
  parseQuestion?: ParseQuestionResult;
  selfSolve?: SelfSolveResult;
  grade?: GradeResult;
  generateExplanation?: ExplanationResult;
}): void {
  const placeholderNodes = [
    deps.parseQuestion?.isPlaceholder ? 'parseQuestion' : null,
    deps.selfSolve?.isPlaceholder ? 'selfSolve' : null,
  ].filter((value): value is string => Boolean(value));

  if (placeholderNodes.length > 0) {
    throw new Error(`workflow placeholder output cannot be persisted as done assignment: ${placeholderNodes.join(', ')}`);
  }
}

function computeStats(verdicts: Verdict[]): AssignmentStats {
  return verdicts.reduce<AssignmentStats>(
    (acc, verdict) => {
      acc.total += 1;
      if (verdict === 'correct') acc.correct += 1;
      if (verdict === 'wrong') acc.wrong += 1;
      if (verdict === 'unmarked') acc.unmarked += 1;
      return acc;
    },
    { total: 0, correct: 0, wrong: 0, unmarked: 0 },
  );
}

function resolveUploadPath(storedPath: string): string {
  const cfg = loadConfig();
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.join(cfg.uploadDir, storedPath);
}

function toSubject(value: string): Subject {
  return value === 'math' ? 'math' : 'math';
}

function resolveKnowledgeTags(tags: Array<{ id: string; confidence: number }>): KnowledgeTag[] {
  return tags.map((tag) => {
    const record = getKnowledgeTagById(tag.id);
    return {
      id: tag.id,
      name: record?.name ?? tag.id,
      confidence: tag.confidence,
    };
  });
}

async function copyAutoMistakeCrop(input: {
  cropPath: string;
  childId: string;
  mistakeId: string;
}): Promise<string> {
  const cfg = loadConfig();
  const destRel = path.join('mistakes', input.childId, `${input.mistakeId}.jpg`);
  const destAbs = path.join(cfg.uploadDir, destRel);
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.copyFile(resolveUploadPath(input.cropPath), destAbs);
  return destRel;
}

async function buildAutoMistakes(input: {
  assignmentId: string;
  childId: string;
  subject: Subject;
  items: SubQuestionInput[];
}): Promise<AutoMistakeInput[]> {
  const mistakes: AutoMistakeInput[] = [];
  for (const item of input.items) {
    if (item.verdict !== 'wrong') {
      continue;
    }

    const mistakeId = `mk_${nanoid(12)}`;
    const snapshotCropPath = await copyAutoMistakeCrop({
      cropPath: item.cropPath,
      childId: input.childId,
      mistakeId,
    });

    mistakes.push({
      id: mistakeId,
      childId: input.childId,
      sourceSubQuestionId: item.id,
      sourceAssignmentId: input.assignmentId,
      snapshotCropPath,
      snapshotSubject: input.subject,
      snapshotParsedStemJson: JSON.stringify(item.parsedStem),
      snapshotSolutionStepsJson: JSON.stringify(item.solutionSteps),
      snapshotFinalAnswer: item.finalAnswer,
      snapshotStudentAnswer: item.studentAnswer,
      snapshotErrorType: item.errorType ?? null,
      snapshotExplanationMd: item.explanationMd,
      snapshotKnowledgeTags: resolveKnowledgeTags(item.knowledgeTagIds),
    });
  }
  return mistakes;
}

export async function run(
  deps: {
    parseQuestion?: ParseQuestionResult;
    selfSolve?: SelfSolveResult;
    grade?: GradeResult;
    generateExplanation?: ExplanationResult;
    kpTagging?: KpTaggingResult;
  } | unknown,
  ctx: AssignmentCtx,
): Promise<PersistResult> {
  const assignment = getById(ctx.assignmentId);
  if (!assignment) {
    throw new Error(`assignment not found: ${ctx.assignmentId}`);
  }

  const parseResult = (deps as { parseQuestion?: ParseQuestionResult }).parseQuestion;
  const solveResult = (deps as { selfSolve?: SelfSolveResult }).selfSolve;
  const gradeResult = (deps as { grade?: GradeResult }).grade;
  const explanationResult = (deps as { generateExplanation?: ExplanationResult }).generateExplanation;
  const tagResult = (deps as { kpTagging?: KpTaggingResult }).kpTagging;

  assertWorkflowReady({
    parseQuestion: parseResult,
    selfSolve: solveResult,
    grade: gradeResult,
    generateExplanation: explanationResult,
  });

  const parsedItems = parseResult?.items ?? [];
  const solveMap = new Map((solveResult?.items ?? []).map((item) => [item.subQuestionId, item]));
  const gradeMap = new Map((gradeResult?.items ?? []).map((item) => [item.subQuestionId, item]));
  const explanationMap = new Map((explanationResult?.items ?? []).map((item) => [item.subQuestionId, item]));
  const tagMap = new Map((tagResult?.items ?? []).map((item) => [item.subQuestionId, item]));
  const majorId = `mq_${nanoid(12)}`;

  const subQuestions: SubQuestionInput[] = parsedItems.map((item, index) => {
      const solution = solveMap.get(item.subQuestionId)?.solution;
      const grading = gradeMap.get(item.subQuestionId)?.grading;
      const explanation = explanationMap.get(item.subQuestionId);
      const tags = tagMap.get(item.subQuestionId)?.tagIds ?? [];

      return {
        id: item.subQuestionId || `sq_${nanoid(12)}`,
        majorId,
        number: `(${index + 1})`,
        orderIndex: index,
        cropPath: item.cropPath,
        parsedStem: item.parsed as ParsedMathQuestion,
        solutionSteps: (solution?.steps ?? [{ text: '等待真实求解流程接入。' }]) as SolutionStep[],
        finalAnswer: solution?.finalAnswer ?? '待识别',
        confidence: solution?.confidence ?? 0.1,
        verdict: grading?.verdict ?? 'unmarked',
        studentAnswer: grading?.studentAnswer ?? null,
        errorType: grading?.errorType ?? explanation?.errorType ?? null,
        explanationMd: explanation?.explanationMd ?? '等待真实讲解生成流程接入。',
        knowledgeTagIds: tags,
      };
    });

  const stats = computeStats(
    parsedItems.map((item) => gradeMap.get(item.subQuestionId)?.grading.verdict ?? 'unmarked'),
  );
  const autoMistakes = await buildAutoMistakes({
    assignmentId: ctx.assignmentId,
    childId: ctx.childId,
    subject: toSubject(ctx.subject),
    items: subQuestions,
  });

  persistAssignmentQuestionResults({
    assignmentId: ctx.assignmentId,
    majorQuestion: {
      id: majorId,
      number: '一',
      orderIndex: 0,
      stem: '原始作业已接收，以下为当前结果。',
    },
    subQuestions,
    autoMistakes,
    stats,
  });

  return { assignmentId: ctx.assignmentId };
}
