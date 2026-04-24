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
  cursor?: string;
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

function mapMistakeRow(row: {
  id: string;
  child_id: string;
  source_sub_question_id: string | null;
  source_assignment_id: string | null;
  snapshot_crop_path: string;
  snapshot_subject: Subject;
  snapshot_parsed_stem_json: string;
  snapshot_solution_steps_json: string;
  snapshot_final_answer: string;
  snapshot_student_answer: string | null;
  snapshot_error_type: string | null;
  snapshot_explanation_md: string;
  snapshot_knowledge_tags_json: string;
  added_at: number;
  source: 'auto' | 'manual';
  resolved: number;
  resolved_at: number | null;
}): MistakeRow {
  return {
    id: row.id,
    childId: row.child_id,
    sourceSubQuestionId: row.source_sub_question_id,
    sourceAssignmentId: row.source_assignment_id,
    snapshot: {
      cropPath: row.snapshot_crop_path,
      subject: row.snapshot_subject,
      parsedStem: JSON.parse(row.snapshot_parsed_stem_json),
      solutionSteps: JSON.parse(row.snapshot_solution_steps_json),
      finalAnswer: row.snapshot_final_answer,
      studentAnswer: row.snapshot_student_answer,
      errorType: row.snapshot_error_type,
      explanationMd: row.snapshot_explanation_md,
      knowledgeTags: JSON.parse(row.snapshot_knowledge_tags_json) as KnowledgeTag[],
    },
    addedAt: row.added_at,
    source: row.source,
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at,
  };
}

function matchesAllTags(item: MistakeRow, tagIds?: string[]): boolean {
  if (!tagIds || tagIds.length === 0) return true;
  const ownIds = new Set(item.snapshot.knowledgeTags.map((tag) => tag.id));
  return tagIds.every((tagId) => ownIds.has(tagId));
}

function decodeMistakeCursor(cursor?: string): { addedAt: number; id?: string } | null {
  if (!cursor) return null;
  const [addedAtRaw = '', id] = cursor.split(':', 2);
  const addedAt = Number.parseInt(addedAtRaw, 10);
  if (!Number.isFinite(addedAt)) return null;
  return { addedAt, id: id || undefined };
}

export function list(filter: MistakeFilter): MistakeRow[] {
  const db = getDb();
  const clauses = ['child_id = ?'];
  const params: Array<string | number> = [filter.childId];

  if (typeof filter.from === 'number') {
    clauses.push('added_at >= ?');
    params.push(filter.from);
  }
  if (typeof filter.to === 'number') {
    clauses.push('added_at <= ?');
    params.push(filter.to);
  }
  if (typeof filter.resolved === 'boolean') {
    clauses.push('resolved = ?');
    params.push(filter.resolved ? 1 : 0);
  }
  const cursor = decodeMistakeCursor(filter.cursor);
  if (cursor && cursor.id) {
    clauses.push('(added_at < ? OR (added_at = ? AND id < ?))');
    params.push(cursor.addedAt, cursor.addedAt, cursor.id);
  } else if (cursor) {
    clauses.push('added_at < ?');
    params.push(cursor.addedAt);
  }

  const rows = db.prepare(
    `SELECT *
     FROM mistakes
     WHERE ${clauses.join(' AND ')}
     ORDER BY added_at DESC, id DESC`,
  ).all(...params) as Array<{
    id: string;
    child_id: string;
    source_sub_question_id: string | null;
    source_assignment_id: string | null;
    snapshot_crop_path: string;
    snapshot_subject: Subject;
    snapshot_parsed_stem_json: string;
    snapshot_solution_steps_json: string;
    snapshot_final_answer: string;
    snapshot_student_answer: string | null;
    snapshot_error_type: string | null;
    snapshot_explanation_md: string;
    snapshot_knowledge_tags_json: string;
    added_at: number;
    source: 'auto' | 'manual';
    resolved: number;
    resolved_at: number | null;
  }>;

  const filtered = rows.map(mapMistakeRow).filter((item) => matchesAllTags(item, filter.tagIds));
  return filtered.slice(0, filter.limit ?? 50);
}

export function setResolved(mistakeId: string, resolved: boolean): boolean {
  const db = getDb();
  const result = db.prepare(
    'UPDATE mistakes SET resolved = ?, resolved_at = ? WHERE id = ?',
  ).run(resolved ? 1 : 0, resolved ? Date.now() : null, mistakeId);
  return result.changes > 0;
}

export function setResolvedForChild(
  mistakeId: string,
  childId: string,
  resolved: boolean,
): boolean {
  const db = getDb();
  const result = db.prepare(
    'UPDATE mistakes SET resolved = ?, resolved_at = ? WHERE id = ? AND child_id = ?',
  ).run(resolved ? 1 : 0, resolved ? Date.now() : null, mistakeId, childId);
  return result.changes > 0;
}

export function weakPoints(
  childId: string,
  opts: { days: number; limit: number },
): {
  totalMistakes: number;
  items: Array<{
    tagId: string;
    tagName: string;
    mistakeCount: number; // 该标签窗口内出现的错题数
    share: number;        // mistakeCount / totalMistakes（非"错误率"，见 docs/03 §3.5）
  }>;
} {
  const from = Date.now() - opts.days * 24 * 60 * 60 * 1000;
  const rows = list({ childId, from, limit: Number.MAX_SAFE_INTEGER });
  const counts = new Map<string, { tagId: string; tagName: string; mistakeCount: number }>();

  for (const item of rows) {
    for (const tag of item.snapshot.knowledgeTags) {
      const bucket = counts.get(tag.id) ?? {
        tagId: tag.id,
        tagName: tag.name,
        mistakeCount: 0,
      };
      bucket.mistakeCount += 1;
      counts.set(tag.id, bucket);
    }
  }

  const totalMistakes = rows.length;
  return {
    totalMistakes,
    items: Array.from(counts.values())
      .sort((a, b) => b.mistakeCount - a.mistakeCount || a.tagName.localeCompare(b.tagName))
      .slice(0, opts.limit)
      .map((item) => ({
        ...item,
        share: totalMistakes === 0 ? 0 : item.mistakeCount / totalMistakes,
      })),
  };
}

/**
 * 将错题移出错题本（物理删除行 + 删除快照图）。
 * 作业侧不受影响。
 */
export async function removeMistake(mistakeId: string, childId: string): Promise<boolean> {
  const db = getDb();
  const row = db.prepare(
    'SELECT snapshot_crop_path FROM mistakes WHERE id = ? AND child_id = ?',
  ).get(mistakeId, childId) as { snapshot_crop_path: string } | undefined;
  if (!row) return false;

  const cfg = loadConfig();
  const abs = join(cfg.uploadDir, row.snapshot_crop_path);
  await fs.rm(abs, { force: true });
  db.prepare('DELETE FROM mistakes WHERE id = ? AND child_id = ?').run(mistakeId, childId);
  return true;
}
