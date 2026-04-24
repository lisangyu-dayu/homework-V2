import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-upload-route-'));
  sqlitePath = path.join(tempRoot, 'test.db');
  uploadDir = path.join(tempRoot, 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  process.env.OPENCLAW_WEBHOOK_SECRET = 'test-openclaw-secret';
  process.env.OPENCLAW_PUSHBACK_URL = 'https://example.com/pushback';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3100';
  process.env.PARENT_LINK_SIGNING_SECRET = '1234567890abcdef1234567890abcdef';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'pass';
  process.env.SQLITE_PATH = sqlitePath;
  process.env.UPLOAD_DIR = uploadDir;
  process.env.PARENT_COOKIE_NAME = 'hw_parent';
  process.env.ENABLED_SUBJECTS = 'math';

  const sql = readFileSync(path.join(process.cwd(), 'src/db/migrations/001_init.sql'), 'utf8');
  const db = new Database(sqlitePath);
  db.exec(sql);
  db.close();
});

beforeEach(async () => {
  const { closeDb, getDb } = await import('@/db/client');
  closeDb();
  const db = getDb();
  db.exec(`
    DELETE FROM sub_question_tags;
    DELETE FROM feedback;
    DELETE FROM sub_questions;
    DELETE FROM major_questions;
    DELETE FROM mistakes;
    DELETE FROM workflow_traces;
    DELETE FROM assignments;
    DELETE FROM children;
    DELETE FROM knowledge_tags;
  `);
  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(uploadDir, { recursive: true });
});

afterAll(async () => {
  const { closeDb } = await import('@/db/client');
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('uploads route', () => {
  it('serves crop images only to the owning child', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_1', 'short-1', 'ch_a', 'math', 'incoming/a.jpg', 'done', 1);

    const cropPath = path.join(uploadDir, 'crops', 'as_1', 'sq_1.png');
    mkdirSync(path.dirname(cropPath), { recursive: true });
    writeFileSync(cropPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const { GET } = await import('@app/uploads/[...segments]/route');
    const okRes = await GET(
      new NextRequest('http://localhost/uploads/crops/as_1/sq_1.png', {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
      { params: Promise.resolve({ segments: ['crops', 'as_1', 'sq_1.png'] }) },
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('content-type')).toBe('image/png');

    const badRes = await GET(
      new NextRequest('http://localhost/uploads/crops/as_1/sq_1.png', {
        headers: { cookie: 'hw_parent=pt_b' },
      }),
      { params: Promise.resolve({ segments: ['crops', 'as_1', 'sq_1.png'] }) },
    );
    expect(badRes.status).toBe(404);
  });

  it('serves mistake snapshots only to the matching child directory', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);

    const mistakePath = path.join(uploadDir, 'mistakes', 'ch_a', 'mk_1.jpg');
    mkdirSync(path.dirname(mistakePath), { recursive: true });
    writeFileSync(mistakePath, Buffer.from([0xff, 0xd8, 0xff]));

    const { GET } = await import('@app/uploads/[...segments]/route');
    const okRes = await GET(
      new NextRequest('http://localhost/uploads/mistakes/ch_a/mk_1.jpg', {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
      { params: Promise.resolve({ segments: ['mistakes', 'ch_a', 'mk_1.jpg'] }) },
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('content-type')).toBe('image/jpeg');

    const badRes = await GET(
      new NextRequest('http://localhost/uploads/mistakes/ch_a/mk_1.jpg', {
        headers: { cookie: 'hw_parent=pt_b' },
      }),
      { params: Promise.resolve({ segments: ['mistakes', 'ch_a', 'mk_1.jpg'] }) },
    );
    expect(badRes.status).toBe(404);
  });
});
