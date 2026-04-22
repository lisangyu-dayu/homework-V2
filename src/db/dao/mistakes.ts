// mistakes DAO（M1 完成实现）
//
// 错题本采用「自包含快照」模式：
//   - 加入错题本时，从 sub_questions 复制所需字段到 mistakes 行
//   - 裁剪图复制到 uploads/mistakes/<childId>/<mistakeId>.jpg
//   - source_sub_question_id / source_assignment_id 仅作软引用，无外键约束
// 因此：作业删除不影响错题本；错题本清理也不影响作业。
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { nanoid } from 'nanoid';
import { getDb } from '../client';
import { loadConfig } from '@/lib/config';
import type { KnowledgeTag, Subject, Verdict } from '@/lib/types';

export interface MistakeFilter {
  childId: string;
  tagIds?: string[];
  from?: number;
  to?: number;
  resolved?: boolean;
  limit?: number;
  cursor?: number;
}

export interface MistakeRow {
  id: string;
  childId: string;
  sourceSubQuestionId: string | null;
  sourceAssignmentId: string | null;
  snapshot: {
    cropPath: string;
    subject: Subject;
    parsedStem: unknown;
    solutionSteps: unknown;
    finalAnswer: string;
    studentAnswer: string | null;
    errorType: string | null;
    explanationMd: string;
    knowledgeTags: KnowledgeTag[];
  };
  addedAt: number;
  source: 'auto' | 'manual';
  resolved: boolean;
  resolvedAt: number | null;
}

interface SubQuestionSnapshotSource {
  id: string;
  assignmentId: string;
  subject: Subject;
  cropPath: string;            // 作业侧原图（uploads/crops/<assignmentId>/<subId>.jpg）
  parsedStemJson: string;
  solutionStepsJson: string;
  finalAnswer: string;
  studentAnswer: string | null;
  errorType: string | null;
  explanationMd: string;
  verdict: Verdict;
  knowledgeTags: KnowledgeTag[];
}

async function copyCropToMistakeDir(
  srcPath: string,
  childId: string,
  mistakeId: string,
): Promise<string> {
  const cfg = loadConfig();
  const destRel = join('mistakes', childId, `${mistakeId}.jpg`);
  const destAbs = join(cfg.uploadDir, destRel);
  await fs.mkdir(dirname(destAbs), { recursive: true });
  // srcPath 落库时约定为相对 uploadDir 的相对路径；此处解析到绝对
  const srcAbs = srcPath.startsWith(cfg.uploadDir) ? srcPath : join(cfg.uploadDir, srcPath);
  await fs.copyFile(srcAbs, destAbs);
  return destRel;
}

export async function addMistake(input: {
  childId: string;
  subQuestion: SubQuestionSnapshotSource;
  source: 'auto' | 'manual';
}): Promise<{ mistakeId: string }> {
  const db = getDb();
  const mistakeId = `mk_${nanoid(12)}`;
  const destRel = await copyCropToMistakeDir(input.subQuestion.cropPath, input.childId, mistakeId);

  const now = Date.now();
  db.prepare(
    `INSERT INTO mistakes (
       id, child_id, source_sub_question_id, source_assignment_id,
       snapshot_crop_path, snapshot_subject,
       snapshot_parsed_stem_json, snapshot_solution_steps_json,
       snapshot_final_answer, snapshot_student_answer,
       snapshot_error_type, snapshot_explanation_md,
       snapshot_knowledge_tags_json,
       added_at, source, resolved
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    mistakeId,
    input.childId,
    input.subQuestion.id,
    input.subQuestion.assignmentId,
    destRel,
    input.subQuestion.subject,
    input.subQuestion.parsedStemJson,
    input.subQuestion.solutionStepsJson,
    input.subQuestion.finalAnswer,
    input.subQuestion.studentAnswer,
    input.subQuestion.errorType,
    input.subQuestion.explanationMd,
    JSON.stringify(input.subQuestion.knowledgeTags),
    now,
    input.source,
  );
  return { mistakeId };
}

export function list(_filter: MistakeFilter): MistakeRow[] {
  // TODO[M1]: 按 childId + tagIds(IN) + date range + resolved + cursor(added_at) 分页
  return [];
}

export function setResolved(mistakeId: string, resolved: boolean): void {
  const db = getDb();
  db.prepare(
    'UPDATE mistakes SET resolved = ?, resolved_at = ? WHERE id = ?',
  ).run(resolved ? 1 : 0, resolved ? Date.now() : null, mistakeId);
}

export function weakPoints(
  _childId: string,
  _opts: { days: number; limit: number },
): {
  totalMistakes: number;
  items: Array<{
    tagId: string;
    tagName: string;
    mistakeCount: number; // 该标签窗口内出现的错题数
    share: number;        // mistakeCount / totalMistakes（非"错误率"，见 docs/03 §3.5）
  }>;
} {
  // TODO[M1]: 近 N 天内 mistakes.snapshot_knowledge_tags_json 聚合：
  //   - totalMistakes: 窗口内该 child 的错题行数
  //   - items: 按 tag 计数 desc，取 top limit
  //   - share: mistakeCount / totalMistakes
  // 注意：一条错题可带多 tag，会在多个标签下同时计数；∑mistakeCount ≥ totalMistakes。
  // 不再返回 wrongRate —— 错题样本算不出真正的错误率（没有"总做题数"），只会误导家长。
  return { totalMistakes: 0, items: [] };
}

/**
 * 将错题移出错题本（物理删除行 + 删除快照图）。
 * 作业侧不受影响。
 */
export async function removeMistake(mistakeId: string, childId: string): Promise<void> {
  const db = getDb();
  const row = db.prepare(
    'SELECT snapshot_crop_path FROM mistakes WHERE id = ? AND child_id = ?',
  ).get(mistakeId, childId) as { snapshot_crop_path: string } | undefined;
  if (!row) return;

  const cfg = loadConfig();
  const abs = join(cfg.uploadDir, row.snapshot_crop_path);
  await fs.rm(abs, { force: true });
  db.prepare('DELETE FROM mistakes WHERE id = ? AND child_id = ?').run(mistakeId, childId);
}
