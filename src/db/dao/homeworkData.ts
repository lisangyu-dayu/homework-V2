import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDb } from '../client';
import { loadConfig } from '@/lib/config';
import type { KnowledgeTag, Subject, Verdict } from '@/lib/types';

export interface AssignmentQuestionView {
  id: string;
  number: string;
  orderIndex: number;
  cropUrl: string;
  parsedStem: unknown;
  solutionSteps: unknown;
  finalAnswer: string;
  confidence: number;
  verdict: Verdict;
  studentAnswer: string | null;
  errorType: string | null;
  explanationMd: string;
  knowledgeTags: KnowledgeTag[];
}

export interface AssignmentMajorView {
  id: string;
  number: string;
  orderIndex: number;
  stem: string | null;
  subQuestions: AssignmentQuestionView[];
}

export interface AssignmentDetailView {
  id: string;
  shortId: string;
  childId: string;
  subject: Subject;
  status: 'processing' | 'done' | 'failed';
  createdAt: number;
  completedAt: number | null;
  originalImagePath: string;
  stats: {
    total: number;
    correct: number;
    wrong: number;
    unmarked: number;
  };
  majorQuestions: AssignmentMajorView[];
}

export interface MistakeItemView {
  mistakeId: string;
  sourceSubQuestionId: string | null;
  sourceAssignmentId: string | null;
  addedAt: number;
  resolved: 0 | 1;
  source: 'auto' | 'manual';
  subject: Subject;
  cropUrl: string;
  finalAnswer: string;
  studentAnswer: string | null;
  errorType: string | null;
  explanationMd: string;
  knowledgeTags: KnowledgeTag[];
}

export interface MistakeListResult {
  items: MistakeItemView[];
  nextCursor: string | null;
  summary: {
    total: number;
    byTag: Array<{ tagId: string; name: string; count: number }>;
  };
}

interface AssignmentDbRow {
  id: string;
  short_id: string;
  child_id: string;
  subject: Subject;
  status: 'processing' | 'done' | 'failed';
  created_at: number;
  completed_at: number | null;
  original_image_path: string;
  total_count: number | null;
  correct_count: number | null;
  wrong_count: number | null;
  unmarked_count: number | null;
}

interface MajorDbRow {
  id: string;
  number: string;
  order_index: number;
  stem: string | null;
}

interface SubQuestionDbRow {
  id: string;
  major_id: string;
  number: string;
  order_index: number;
  crop_path: string;
  parsed_stem_json: string;
  solution_steps_json: string;
  final_answer: string;
  confidence: number;
  verdict: Verdict;
  student_answer: string | null;
  error_type: string | null;
  explanation_md: string;
}

interface TagDbRow {
  sub_question_id: string;
  tag_id: string;
  name: string;
  confidence: number;
}

interface MistakeDbRow {
  id: string;
  source_sub_question_id: string | null;
  source_assignment_id: string | null;
  snapshot_crop_path: string;
  snapshot_subject: Subject;
  snapshot_final_answer: string;
  snapshot_student_answer: string | null;
  snapshot_error_type: string | null;
  snapshot_explanation_md: string;
  snapshot_knowledge_tags_json: string;
  added_at: number;
  source: 'auto' | 'manual';
  resolved: number;
}

export interface MistakeFilterInput {
  childId: string;
  tagIds?: string[];
  from?: number;
  to?: number;
  resolved?: boolean;
  limit: number;
  cursor?: string;
}

export interface SubQuestionSnapshotForMistake {
  id: string;
  assignmentId: string;
  subject: Subject;
  cropPath: string;
  parsedStemJson: string;
  solutionStepsJson: string;
  finalAnswer: string;
  studentAnswer: string | null;
  errorType: string | null;
  explanationMd: string;
  verdict: Verdict;
  knowledgeTags: KnowledgeTag[];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toPublicUploadUrl(storedPath: string): string {
  const normalized = storedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('uploads/')) return `/${normalized}`;
  return `/uploads/${normalized}`;
}

function buildAssignmentDetail(row: AssignmentDbRow): AssignmentDetailView {
  return {
    id: row.id,
    shortId: row.short_id,
    childId: row.child_id,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    originalImagePath: row.original_image_path,
    stats: {
      total: row.total_count ?? 0,
      correct: row.correct_count ?? 0,
      wrong: row.wrong_count ?? 0,
      unmarked: row.unmarked_count ?? 0,
    },
    majorQuestions: [],
  };
}

function fillAssignmentQuestions(assignment: AssignmentDetailView): AssignmentDetailView {
  const db = getDb();
  const majors = db
    .prepare(
      `SELECT id, number, order_index, stem
       FROM major_questions
       WHERE assignment_id = ?
       ORDER BY order_index ASC`,
    )
    .all(assignment.id) as MajorDbRow[];

  const subRows = db
    .prepare(
      `SELECT sq.id, sq.major_id, sq.number, sq.order_index, sq.crop_path,
              sq.parsed_stem_json, sq.solution_steps_json, sq.final_answer,
              sq.confidence, sq.verdict, sq.student_answer, sq.error_type, sq.explanation_md
       FROM sub_questions sq
       JOIN major_questions mq ON mq.id = sq.major_id
       WHERE mq.assignment_id = ?
       ORDER BY mq.order_index ASC, sq.order_index ASC`,
    )
    .all(assignment.id) as SubQuestionDbRow[];

  const subIds = subRows.map((row) => row.id);
  const tagsBySubId = new Map<string, KnowledgeTag[]>();
  if (subIds.length > 0) {
    const placeholders = subIds.map(() => '?').join(', ');
    const tagRows = db
      .prepare(
        `SELECT sqt.sub_question_id, sqt.tag_id, kt.name, sqt.confidence
         FROM sub_question_tags sqt
         JOIN knowledge_tags kt ON kt.id = sqt.tag_id
         WHERE sqt.sub_question_id IN (${placeholders})
         ORDER BY sqt.sub_question_id ASC, sqt.confidence DESC`,
      )
      .all(...subIds) as TagDbRow[];
    for (const row of tagRows) {
      const existing = tagsBySubId.get(row.sub_question_id) ?? [];
      existing.push({ id: row.tag_id, name: row.name, confidence: row.confidence });
      tagsBySubId.set(row.sub_question_id, existing);
    }
  }

  assignment.majorQuestions = majors.map((major) => ({
    id: major.id,
    number: major.number,
    orderIndex: major.order_index,
    stem: major.stem,
    subQuestions: subRows
      .filter((row) => row.major_id === major.id)
      .map((row) => ({
        id: row.id,
        number: row.number,
        orderIndex: row.order_index,
        cropUrl: toPublicUploadUrl(row.crop_path),
        parsedStem: parseJson(row.parsed_stem_json, null),
        solutionSteps: parseJson(row.solution_steps_json, []),
        finalAnswer: row.final_answer,
        confidence: row.confidence,
        verdict: row.verdict,
        studentAnswer: row.student_answer,
        errorType: row.error_type,
        explanationMd: row.explanation_md,
        knowledgeTags: tagsBySubId.get(row.id) ?? [],
      })),
  }));

  return assignment;
}

function getAssignmentByClause(
  clause: 'id = ?' | 'short_id = ?',
  value: string,
  childId?: string,
): AssignmentDetailView | null {
  const db = getDb();
  const whereClause = childId ? `${clause} AND child_id = ?` : clause;
  const params = childId ? [value, childId] : [value];
  const row = db
    .prepare(
      `SELECT id, short_id, child_id, subject, status, created_at, completed_at,
               original_image_path, total_count, correct_count, wrong_count, unmarked_count
        FROM assignments
        WHERE ${whereClause}
        LIMIT 1`,
     )
    .get(...params) as AssignmentDbRow | undefined;
  if (!row) return null;
  return fillAssignmentQuestions(buildAssignmentDetail(row));
}

export function getAssignmentDetailById(id: string): AssignmentDetailView | null {
  return getAssignmentByClause('id = ?', id);
}

export function getAssignmentDetailByShortId(shortId: string): AssignmentDetailView | null {
  return getAssignmentByClause('short_id = ?', shortId);
}

export function getAssignmentDetailByIdForChild(id: string, childId: string): AssignmentDetailView | null {
  return getAssignmentByClause('id = ?', id, childId);
}

export function getAssignmentDetailByShortIdForChild(shortId: string, childId: string): AssignmentDetailView | null {
  return getAssignmentByClause('short_id = ?', shortId, childId);
}

export function getAssignmentShortIdMap(assignmentIds: string[]): Record<string, string> {
  if (assignmentIds.length === 0) return {};
  const placeholders = assignmentIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT id, short_id FROM assignments WHERE id IN (${placeholders})`)
    .all(...assignmentIds) as Array<{ id: string; short_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.short_id]));
}

function resolveStoredPath(storedPath: string): string {
  const cfg = loadConfig();
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.join(cfg.uploadDir, storedPath);
}

export async function deleteAssignmentCascade(assignmentId: string): Promise<void> {
  const db = getDb();
  const row = db
    .prepare('SELECT original_image_path FROM assignments WHERE id = ?')
    .get(assignmentId) as { original_image_path: string } | undefined;
  if (!row) return;

  const cfg = loadConfig();
  await fs.rm(resolveStoredPath(row.original_image_path), { force: true });
  await fs.rm(path.join(cfg.uploadDir, assignmentId), { recursive: true, force: true });
  await fs.rm(path.join(cfg.uploadDir, 'crops', assignmentId), { recursive: true, force: true });
  db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);
}

function mapMistakeRow(row: MistakeDbRow): MistakeItemView {
  return {
    mistakeId: row.id,
    sourceSubQuestionId: row.source_sub_question_id,
    sourceAssignmentId: row.source_assignment_id,
    addedAt: row.added_at,
    resolved: row.resolved ? 1 : 0,
    source: row.source,
    subject: row.snapshot_subject,
    cropUrl: toPublicUploadUrl(row.snapshot_crop_path),
    finalAnswer: row.snapshot_final_answer,
    studentAnswer: row.snapshot_student_answer,
    errorType: row.snapshot_error_type,
    explanationMd: row.snapshot_explanation_md,
    knowledgeTags: parseJson<KnowledgeTag[]>(row.snapshot_knowledge_tags_json, []),
  };
}

function matchesAllTags(item: MistakeItemView, tagIds?: string[]): boolean {
  if (!tagIds || tagIds.length === 0) return true;
  const ownIds = new Set(item.knowledgeTags.map((tag) => tag.id));
  return tagIds.every((tagId) => ownIds.has(tagId));
}

function decodeMistakeCursor(cursor?: string): { addedAt: number; id?: string } | null {
  if (!cursor) return null;
  const [addedAtRaw = '', id] = cursor.split(':', 2);
  const addedAt = Number.parseInt(addedAtRaw, 10);
  if (!Number.isFinite(addedAt)) return null;
  return { addedAt, id: id || undefined };
}

function encodeMistakeCursor(item: Pick<MistakeItemView, 'mistakeId' | 'addedAt'>): string {
  return `${item.addedAt}:${item.mistakeId}`;
}

export function listMistakesForChild(filter: MistakeFilterInput): MistakeListResult {
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

  const rows = db
    .prepare(
      `SELECT id, source_sub_question_id, source_assignment_id,
              snapshot_crop_path, snapshot_subject, snapshot_final_answer,
              snapshot_student_answer, snapshot_error_type, snapshot_explanation_md,
              snapshot_knowledge_tags_json, added_at, source, resolved
       FROM mistakes
       WHERE ${clauses.join(' AND ')}
       ORDER BY added_at DESC, id DESC`,
    )
    .all(...params) as MistakeDbRow[];

  const filtered = rows.map(mapMistakeRow).filter((item) => matchesAllTags(item, filter.tagIds));
  const items = filtered.slice(0, filter.limit);
  const lastItem = items.at(-1);
  const nextCursor = filtered.length > filter.limit && lastItem ? encodeMistakeCursor(lastItem) : null;

  const tagSummary = new Map<string, { tagId: string; name: string; count: number }>();
  for (const item of filtered) {
    for (const tag of item.knowledgeTags) {
      const existing = tagSummary.get(tag.id) ?? { tagId: tag.id, name: tag.name, count: 0 };
      existing.count += 1;
      tagSummary.set(tag.id, existing);
    }
  }

  return {
    items,
    nextCursor,
    summary: {
      total: filtered.length,
      byTag: Array.from(tagSummary.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
  };
}

export function getSubQuestionSnapshotForChild(
  subQuestionId: string,
  childId: string,
): SubQuestionSnapshotForMistake | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT sq.id, sq.crop_path, sq.parsed_stem_json, sq.solution_steps_json,
              sq.final_answer, sq.student_answer, sq.error_type, sq.explanation_md, sq.verdict,
              a.id AS assignment_id, a.child_id, a.subject
       FROM sub_questions sq
       JOIN major_questions mq ON mq.id = sq.major_id
       JOIN assignments a ON a.id = mq.assignment_id
       WHERE sq.id = ?
       LIMIT 1`,
    )
    .get(subQuestionId) as
      | (SubQuestionDbRow & {
          assignment_id: string;
          child_id: string;
          subject: Subject;
        })
      | undefined;

  if (!row || row.child_id !== childId) return null;

  const tags = db
    .prepare(
      `SELECT sqt.tag_id, kt.name, sqt.confidence
       FROM sub_question_tags sqt
       JOIN knowledge_tags kt ON kt.id = sqt.tag_id
       WHERE sqt.sub_question_id = ?
       ORDER BY sqt.confidence DESC`,
    )
    .all(subQuestionId) as Array<{ tag_id: string; name: string; confidence: number }>;

  return {
    id: row.id,
    assignmentId: row.assignment_id,
    subject: row.subject,
    cropPath: row.crop_path,
    parsedStemJson: row.parsed_stem_json,
    solutionStepsJson: row.solution_steps_json,
    finalAnswer: row.final_answer,
    studentAnswer: row.student_answer,
    errorType: row.error_type,
    explanationMd: row.explanation_md,
    verdict: row.verdict,
    knowledgeTags: tags.map((tag) => ({ id: tag.tag_id, name: tag.name, confidence: tag.confidence })),
  };
}
