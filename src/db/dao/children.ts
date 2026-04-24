// children DAO（M1 完成实现）
//
// 一个 openId = 一个 child（V1）。
// parent_token 用于签名短链与 cookie 鉴权：
//   - 首次创建时生成，永不变动（除非显式 rotate）
//   - 短链参数 `t=` 与 cookie `hw_parent=` 都承载它
//   - 不得落入日志 / 不得返回给微信侧消息体
import { nanoid } from 'nanoid';
import { getDb } from '../client';

export interface ChildRow {
  id: string;
  openid: string;
  parentToken: string;
  nickname: string | null;
  grade: number | null;
  createdAt: number;
}

interface ChildDbRow {
  id: string;
  openid: string;
  parent_token: string;
  nickname: string | null;
  grade: number | null;
  created_at: number;
}

function mapRow(r: ChildDbRow): ChildRow {
  return {
    id: r.id,
    openid: r.openid,
    parentToken: r.parent_token,
    nickname: r.nickname,
    grade: r.grade,
    createdAt: r.created_at,
  };
}

function selectByOpenId(openid: string): ChildDbRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM children WHERE openid = ?').get(openid) as ChildDbRow | undefined;
}

export function findByOpenId(openid: string): ChildRow | null {
  const row = selectByOpenId(openid);
  return row ? mapRow(row) : null;
}

export function findByParentToken(token: string): ChildRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM children WHERE parent_token = ?').get(token) as ChildDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function findById(id: string): ChildRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM children WHERE id = ?').get(id) as ChildDbRow | undefined;
  return row ? mapRow(row) : null;
}

export function findOrCreateByOpenId(openid: string, grade?: number): ChildRow {
  const db = getDb();
  const id = `ch_${nanoid(10)}`;
  const parentToken = `pt_${nanoid(24)}`;
  const now = Date.now();
  db.prepare(
    'INSERT OR IGNORE INTO children (id, openid, parent_token, grade, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, openid, parentToken, grade ?? null, now);

  const row = selectByOpenId(openid);
  if (!row) {
    throw new Error(`failed to create or load child for openid: ${openid}`);
  }

  return mapRow(row);
}
