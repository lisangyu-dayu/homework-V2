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

export function getByShortId(_shortId: string): AssignmentRow | null {
  // TODO[M1]: SELECT + 字段映射 snake→camel
  return null;
}

export function getById(_id: string): AssignmentRow | null {
  // TODO[M1]
  return null;
}

export function completeAssignment(_id: string, _stats: {
  correct: number; wrong: number; unmarked: number; total: number;
}): void {
  // TODO[M1]
}

export function listByChild(_childId: string, _opts: { limit: number; cursor?: number }): AssignmentRow[] {
  // TODO[M1]
  return [];
}
