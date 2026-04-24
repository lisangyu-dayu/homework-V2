import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

const navMock = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: navMock.notFound,
  redirect: navMock.redirect,
}));

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';

const cookiesMock = vi.mocked(cookies);
const notFoundMock = vi.mocked(notFound);

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-auth-regression-'));
  sqlitePath = path.join(tempRoot, 'test.db');
  uploadDir = path.join(tempRoot, 'uploads');

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
  cookiesMock.mockReset();
  navMock.notFound.mockClear();
  navMock.redirect.mockClear();
});

afterAll(async () => {
  const { closeDb } = await import('@/db/client');
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

function jsonRequest(url: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) {
  return new NextRequest(url, {
    method: init.method,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function seedTwoChildren() {
  const db = new Database(sqlitePath);
  db.prepare(
    'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
  ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
  db.close();
}

describe('M10 auth regression', () => {
  it('returns 404 when parent A requests parent B result shortId', async () => {
    seedTwoChildren();
    const db = new Database(sqlitePath);
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_b', 'short-b', 'ch_b', 'math', 'incoming/b.jpg', 'done', 10);
    db.close();

    cookiesMock.mockResolvedValue({
      get(name: string) {
        return name === 'hw_parent' ? { value: 'pt_a' } : undefined;
      },
    } as Awaited<ReturnType<typeof cookies>>);

    const { default: AssignmentResultPage } = await import('@app/r/[shortId]/page');

    await expect(
      AssignmentResultPage({
        params: Promise.resolve({ shortId: 'short-b' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 and leaves data unchanged when parent A requests parent B mistakeId', async () => {
    seedTwoChildren();
    const db = new Database(sqlitePath);
    db.prepare(
      `INSERT INTO mistakes (
         id, child_id, source_sub_question_id, source_assignment_id, snapshot_crop_path, snapshot_subject,
         snapshot_parsed_stem_json, snapshot_solution_steps_json, snapshot_final_answer, snapshot_student_answer,
         snapshot_error_type, snapshot_explanation_md, snapshot_knowledge_tags_json, added_at, source, resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mk_b',
      'ch_b',
      null,
      null,
      'mistakes/ch_b/mk_b.jpg',
      'math',
      '{}',
      '[]',
      '42',
      '24',
      null,
      'explanation',
      '[]',
      10,
      'manual',
      0,
    );
    db.close();

    const { PATCH, DELETE } = await import('@app/api/mistakes/[mistakeId]/route');

    const patchRes = await PATCH(
      jsonRequest('http://localhost/api/mistakes/mk_b', {
        method: 'PATCH',
        headers: { cookie: 'hw_parent=pt_a' },
        body: { resolved: true },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_b' }) },
    );
    expect(patchRes.status).toBe(404);
    await expect(patchRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    const deleteRes = await DELETE(
      new NextRequest('http://localhost/api/mistakes/mk_b', {
        method: 'DELETE',
        headers: { cookie: 'hw_parent=pt_a' },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_b' }) },
    );
    expect(deleteRes.status).toBe(404);
    await expect(deleteRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    const checkDb = new Database(sqlitePath);
    expect(
      checkDb.prepare('SELECT resolved, child_id FROM mistakes WHERE id = ?').get('mk_b'),
    ).toMatchObject({ resolved: 0, child_id: 'ch_b' });
    checkDb.close();
  });
});
