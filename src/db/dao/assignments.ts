// assignments DAO（M1 完成实现）
import { nanoid } from 'nanoid';
import { getDb } from '../client';

export interface AssignmentRow {
  id: string;
  shortId: string;
  childId: string;
  subject: string;
  originalImagePath: string;
  status: 'processing' | 'done' | 'failed';
  createdAt: number;
  completedAt: number | null;
  totalCount: number | null;
  correctCount: number | null;
  wrongCount: number | null;
  unmarkedCount: number | null;
}

interface AssignmentDbRow {
  id: string;
  short_id: string;
  child_id: string;
  subject: string;
  original_image_path: string;
  status: 'processing' | 'done' | 'failed';
  created_at: number;
  completed_at: number | null;
  total_count: number | null;
  correct_count: number | null;
  wrong_count: number | null;
  unmarked_count: number | null;
}

function mapRow(row: AssignmentDbRow): AssignmentRow {
  return {
    id: row.id,
    shortId: row.short_id,
    childId: row.child_id,
    subject: row.subject,
    originalImagePath: row.original_image_path,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    totalCount: row.total_count,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    unmarkedCount: row.unmarked_count,
  };
}

export function createAssignment(input: {
  childId: string;
  subject: string;
  originalImagePath: string;
}): { id: string; shortId: string } {
  const id = `as_${nanoid(12)}`;
  const shortId = nanoid(8);
  const db = getDb();
  db.prepare(`
    INSERT INTO assignments (id, short_id, child_id, subject, original_image_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'processing', ?)
  `).run(id, shortId, input.childId, input.subject, input.originalImagePath, Date.now());
  return { id, shortId };
}

export function getByShortId(shortId: string): AssignmentRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
       id,
       short_id,
       child_id,
       subject,
       original_image_path,
       status,
       created_at,
       completed_at,
       total_count,
       correct_count,
       wrong_count,
       unmarked_count
     FROM assignments
     WHERE short_id = ?
     LIMIT 1`,
  ).get(shortId) as AssignmentDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function getById(id: string): AssignmentRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
       id,
       short_id,
       child_id,
       subject,
       original_image_path,
       status,
       created_at,
       completed_at,
       total_count,
       correct_count,
       wrong_count,
       unmarked_count
     FROM assignments
     WHERE id = ?
     LIMIT 1`,
  ).get(id) as AssignmentDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function completeAssignment(id: string, stats: {
  correct: number; wrong: number; unmarked: number; total: number;
}): void {
  const db = getDb();
  db.prepare(
    `UPDATE assignments
     SET status = 'done',
         completed_at = ?,
         total_count = ?,
         correct_count = ?,
         wrong_count = ?,
         unmarked_count = ?
     WHERE id = ?`,
  ).run(Date.now(), stats.total, stats.correct, stats.wrong, stats.unmarked, id);
}

export function failAssignment(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE assignments
     SET status = 'failed',
         completed_at = ?
     WHERE id = ?`,
  ).run(Date.now(), id);
}

export function listByChild(childId: string, opts: { limit: number; cursor?: number }): AssignmentRow[] {
  const db = getDb();
  const rows = (typeof opts.cursor === 'number'
    ? db.prepare(
      `SELECT
         id,
         short_id,
         child_id,
         subject,
         original_image_path,
         status,
         created_at,
         completed_at,
         total_count,
         correct_count,
         wrong_count,
         unmarked_count
       FROM assignments
       WHERE child_id = ? AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(childId, opts.cursor, opts.limit)
    : db.prepare(
      `SELECT
         id,
         short_id,
         child_id,
         subject,
         original_image_path,
         status,
         created_at,
         completed_at,
         total_count,
         correct_count,
         wrong_count,
         unmarked_count
       FROM assignments
       WHERE child_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(childId, opts.limit)) as AssignmentDbRow[];

  return rows.map(mapRow);
}
