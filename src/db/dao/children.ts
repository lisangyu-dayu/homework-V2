// children DAO（M1 完成实现）
import { nanoid } from 'nanoid';
import { getDb } from '../client';

export interface ChildRow {
  id: string;
  openid: string;
  nickname: string | null;
  grade: number | null;
  createdAt: number;
}

export function findOrCreateByOpenId(openid: string, grade?: number): ChildRow {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM children WHERE openid = ?').get(openid) as
    | { id: string; openid: string; nickname: string | null; grade: number | null; created_at: number }
    | undefined;
  if (existing) {
    return {
      id: existing.id,
      openid: existing.openid,
      nickname: existing.nickname,
      grade: existing.grade,
      createdAt: existing.created_at,
    };
  }
  const id = `ch_${nanoid(10)}`;
  const now = Date.now();
  db.prepare('INSERT INTO children (id, openid, grade, created_at) VALUES (?, ?, ?, ?)').run(
    id, openid, grade ?? null, now,
  );
  return { id, openid, nickname: null, grade: grade ?? null, createdAt: now };
}
