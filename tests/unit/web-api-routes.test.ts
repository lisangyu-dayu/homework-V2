import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=';

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-tests-'));
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  const { closeDb } = await import('@/db/client');
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

async function getDb() {
  const mod = await import('@/db/client');
  return mod.getDb();
}

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

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
  stepMs = 25,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const value = read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  return read();
}

describe('wechat webhook route', () => {
  it('rejects requests without the shared secret', async () => {
    const { POST } = await import('@app/api/wechat/webhook/route');
    const req = jsonRequest('http://localhost/api/wechat/webhook', {
      method: 'POST',
      body: {
        openId: 'openid-1',
        messageType: 'image',
        imageBase64: MINIMAL_PNG_BASE64,
        timestamp: Date.now(),
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTH_REQUIRED' },
    });
  });

  it('runs the assignment workflow and pushes back a result link', async () => {
    vi.stubEnv('CODEX_CLI_PATH', '__missing_codex_for_test__');
    vi.stubEnv('CLAUDE_CLI_PATH', '__missing_claude_for_test__');
    const { resetConfigCacheForTest } = await import('@/lib/config');
    const { resetProviderSingletonsForTest } = await import('@/providers/router');
    resetConfigCacheForTest();
    resetProviderSingletonsForTest();

    const { POST } = await import('@app/api/wechat/webhook/route');
    const req = jsonRequest('http://localhost/api/wechat/webhook', {
      method: 'POST',
      headers: { 'X-OpenClaw-Secret': 'test-openclaw-secret' },
      body: {
        openId: 'openid-2',
        messageType: 'image',
        imageBase64: MINIMAL_PNG_BASE64,
        timestamp: Date.now(),
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, estimateSeconds: 35 });

    const db = await getDb();
    let assignmentRow = db.prepare('SELECT * FROM assignments WHERE id = ?').get(body.assignmentId) as
      | {
          child_id: string;
          short_id: string;
          status: string;
          total_count: number | null;
          unmarked_count: number | null;
        }
      | undefined;
    expect(assignmentRow?.status).toBe('processing');

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/pushback',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('作业已收到，正在批改中'),
      }),
    );

    const childRow = db.prepare('SELECT * FROM children WHERE openid = ?').get('openid-2') as
      | { id: string; parent_token: string }
      | undefined;
    assignmentRow = await waitFor(
      () =>
        db.prepare('SELECT * FROM assignments WHERE id = ?').get(body.assignmentId) as
          | {
              child_id: string;
              short_id: string;
              status: string;
              total_count: number | null;
              unmarked_count: number | null;
            }
          | undefined,
      (row) => row?.status === 'failed',
    );
    const questionCount = db.prepare('SELECT COUNT(*) AS count FROM sub_questions WHERE 1=1').get() as { count: number };

    expect(childRow).toBeTruthy();
    expect(assignmentRow).toBeTruthy();
    expect(assignmentRow?.child_id).toBe(childRow?.id);
    expect(assignmentRow?.status).toBe('failed');
    expect(assignmentRow?.total_count).toBeNull();
    expect(assignmentRow?.unmarked_count).toBeNull();
    expect(questionCount.count).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/pushback',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('作业已收到，但本次处理失败'),
      }),
    );
  });

  it('rejects non-image payloads before persistence', async () => {
    const { POST } = await import('@app/api/wechat/webhook/route');
    const req = jsonRequest('http://localhost/api/wechat/webhook', {
      method: 'POST',
      headers: { 'X-OpenClaw-Secret': 'test-openclaw-secret' },
      body: {
        openId: 'openid-3',
        messageType: 'image',
        imageBase64: Buffer.from('not-an-image').toString('base64'),
        timestamp: Date.now(),
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});

describe('short-link auth accept route', () => {
  it('sets the parent cookie from a valid signed link and keeps cross-child assignment access denied', async () => {
    const { POST: webhookPost } = await import('@app/api/wechat/webhook/route');
    const webhookReq = jsonRequest('http://localhost/api/wechat/webhook', {
      method: 'POST',
      headers: { 'X-OpenClaw-Secret': 'test-openclaw-secret' },
      body: {
        openId: 'openid-auth-a',
        messageType: 'image',
        imageBase64: MINIMAL_PNG_BASE64,
        timestamp: Date.now(),
      },
    });

    const webhookRes = await webhookPost(webhookReq);
    expect(webhookRes.status).toBe(202);
    const webhookBody = await webhookRes.json();

    const db = await getDb();
    const childA = db.prepare('SELECT id, parent_token FROM children WHERE openid = ?').get('openid-auth-a') as
      | { id: string; parent_token: string }
      | undefined;
    const assignmentA = db
      .prepare('SELECT id, short_id FROM assignments WHERE id = ?')
      .get(webhookBody.assignmentId) as
      | { id: string; short_id: string }
      | undefined;
    expect(childA).toBeTruthy();
    expect(assignmentA).toBeTruthy();

    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_cross_scope', 'openid-auth-b', 'pt_cross_scope', Date.now());
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'as_cross_scope',
      'short-cross',
      'ch_cross_scope',
      'math',
      'incoming/cross.jpg',
      'processing',
      Date.now(),
    );

    const { buildShortLinkUrl } = await import('@/lib/auth');
    const { GET: acceptGet } = await import('@app/auth/accept/[shortId]/route');
    const signedUrl = buildShortLinkUrl(assignmentA!.short_id, childA!.parent_token);
    const acceptRes = await acceptGet(new NextRequest(signedUrl), {
      params: Promise.resolve({ shortId: assignmentA!.short_id }),
    });

    expect(acceptRes.status).toBe(307);
    const location = acceptRes.headers.get('location');
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe(`/r/${assignmentA!.short_id}`);

    const setCookie = acceptRes.headers.get('set-cookie');
    expect(setCookie).toContain('hw_parent=');
    expect(setCookie).toContain(childA!.parent_token);
    expect(setCookie).toContain('HttpOnly');

    const { GET: assignmentGet } = await import('@app/api/assignment/[id]/route');
    const crossScopeRes = await assignmentGet(
      new NextRequest('http://localhost/api/assignment/as_cross_scope', {
        headers: { cookie: `hw_parent=${childA!.parent_token}` },
      }),
      { params: Promise.resolve({ id: 'as_cross_scope' }) },
    );
    expect(crossScopeRes.status).toBe(404);
    await expect(crossScopeRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('assignment detail route', () => {
  it('returns the assignment for the scoped child and hides others', async () => {
    const db = await getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at,
         total_count, correct_count, wrong_count, unmarked_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_1', 'short1', 'ch_a', 'math', 'incoming/file.jpg', 'done', 10, 3, 2, 1, 0);

    const { GET } = await import('@app/api/assignment/[id]/route');
    const okReq = new NextRequest('http://localhost/api/assignment/as_1', {
      headers: { cookie: 'hw_parent=pt_a' },
    });
    const okRes = await GET(okReq, { params: Promise.resolve({ id: 'as_1' }) });
    expect(okRes.status).toBe(200);
    await expect(okRes.json()).resolves.toMatchObject({
      ok: true,
      assignment: { id: 'as_1', childId: 'ch_a', stats: { total: 3, correct: 2, wrong: 1, unmarked: 0 } },
    });

    const badReq = new NextRequest('http://localhost/api/assignment/as_1', {
      headers: { cookie: 'hw_parent=pt_b' },
    });
    const badRes = await GET(badReq, { params: Promise.resolve({ id: 'as_1' }) });
    expect(badRes.status).toBe(404);
  });
});

describe('mistakes route', () => {
  it('adds and lists mistakes inside the cookie child scope', async () => {
    const db = await getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'as_a',
      'short-a',
      'ch_a',
      'math',
      'incoming/a.jpg',
      'done',
      1,
      'as_b',
      'short-b',
      'ch_b',
      'math',
      'incoming/b.jpg',
      'done',
      1,
    );
    db.prepare(
      'INSERT INTO major_questions (id, assignment_id, number, order_index) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('mq_a', 'as_a', '一', 0, 'mq_b', 'as_b', '一', 0);

    const cropPath = path.join(uploadDir, 'crops', 'as_a', 'sq_a.jpg');
    mkdirSync(path.dirname(cropPath), { recursive: true });
    writeFileSync(cropPath, 'crop-a');

    db.prepare(
      `INSERT INTO sub_questions (
         id, major_id, number, order_index, crop_path, parsed_stem_json, solution_steps_json,
         final_answer, confidence, verdict, student_answer, error_type, explanation_md
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sq_a',
      'mq_a',
      '(1)',
      0,
      path.join('crops', 'as_a', 'sq_a.jpg'),
      '{"stem":"a"}',
      '[]',
      '42',
      0.9,
      'wrong',
      '24',
      '计算错误',
      '重新检查运算顺序',
      'sq_b',
      'mq_b',
      '(1)',
      0,
      path.join('crops', 'as_b', 'sq_b.jpg'),
      '{"stem":"b"}',
      '[]',
      '1',
      0.9,
      'wrong',
      '0',
      '漏解',
      '补充条件',
    );
    db.prepare(
      'INSERT INTO knowledge_tags (id, subject, name) VALUES (?, ?, ?), (?, ?, ?)',
    ).run('kt_a', 'math', '一元一次方程', 'kt_b', 'math', '几何');
    db.prepare(
      'INSERT INTO sub_question_tags (sub_question_id, tag_id, confidence) VALUES (?, ?, ?), (?, ?, ?)',
    ).run('sq_a', 'kt_a', 0.95, 'sq_b', 'kt_b', 0.95);

    const { POST, GET } = await import('@app/api/mistakes/route');

    const addReq = jsonRequest('http://localhost/api/mistakes', {
      method: 'POST',
      headers: { cookie: 'hw_parent=pt_a' },
      body: { subQuestionId: 'sq_a', source: 'manual' },
    });
    const addRes = await POST(addReq);
    expect(addRes.status).toBe(200);
    const addBody = await addRes.json();
    expect(addBody).toMatchObject({ ok: true });

    const listReq = new NextRequest('http://localhost/api/mistakes?tags=kt_a', {
      headers: { cookie: 'hw_parent=pt_a' },
    });
    const listRes = await GET(listReq);
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      ok: true,
      items: [
        {
          sourceAssignmentId: 'as_a',
          finalAnswer: '42',
          knowledgeTags: [{ id: 'kt_a', name: '一元一次方程' }],
        },
      ],
      summary: {
        total: 1,
        byTag: [{ tagId: 'kt_a', name: '一元一次方程', count: 1 }],
      },
    });

    const crossReq = jsonRequest('http://localhost/api/mistakes', {
      method: 'POST',
      headers: { cookie: 'hw_parent=pt_a' },
      body: { subQuestionId: 'sq_b', source: 'manual' },
    });
    const crossRes = await POST(crossReq);
    expect(crossRes.status).toBe(404);
  });

  it('paginates with a compound cursor when timestamps collide', async () => {
    const db = await getDb();
    const addedAt = 1_710_000_000_000;
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1);
    db.prepare(
      `INSERT INTO mistakes (
         id, child_id, source_sub_question_id, source_assignment_id, snapshot_crop_path, snapshot_subject,
         snapshot_parsed_stem_json, snapshot_solution_steps_json, snapshot_final_answer, snapshot_student_answer,
         snapshot_error_type, snapshot_explanation_md, snapshot_knowledge_tags_json, added_at, source, resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mk_b',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_b.jpg',
      'math',
      '{}',
      '[]',
      'B',
      null,
      null,
      'B',
      '[]',
      addedAt,
      'manual',
      0,
      'mk_a',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_a.jpg',
      'math',
      '{}',
      '[]',
      'A',
      null,
      null,
      'A',
      '[]',
      addedAt,
      'manual',
      0,
    );

    const { GET } = await import('@app/api/mistakes/route');
    const firstRes = await GET(
      new NextRequest('http://localhost/api/mistakes?limit=1', {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
    );
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]?.mistakeId).toBe('mk_b');
    expect(firstBody.nextCursor).toBe(`${addedAt}:mk_b`);

    const secondRes = await GET(
      new NextRequest(`http://localhost/api/mistakes?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`, {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
    );
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]?.mistakeId).toBe('mk_a');
  });
});

describe('mistake detail routes', () => {
  it('patches mistake resolved state inside the cookie child scope', async () => {
    const db = await getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO mistakes (
         id, child_id, source_sub_question_id, source_assignment_id, snapshot_crop_path, snapshot_subject,
         snapshot_parsed_stem_json, snapshot_solution_steps_json, snapshot_final_answer, snapshot_student_answer,
         snapshot_error_type, snapshot_explanation_md, snapshot_knowledge_tags_json, added_at, source, resolved, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mk_patch',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_patch.jpg',
      'math',
      '{}',
      '[]',
      '42',
      '24',
      null,
      'explanation',
      '[]',
      Date.now(),
      'manual',
      0,
      null,
    );

    const { PATCH } = await import('@app/api/mistakes/[mistakeId]/route');

    const res = await PATCH(
      jsonRequest('http://localhost/api/mistakes/mk_patch', {
        method: 'PATCH',
        headers: { cookie: 'hw_parent=pt_a' },
        body: { resolved: true },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_patch' }) },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });

    const updatedRow = db
      .prepare('SELECT resolved, resolved_at FROM mistakes WHERE id = ?')
      .get('mk_patch') as { resolved: number; resolved_at: number | null } | undefined;
    expect(updatedRow).toMatchObject({ resolved: 1 });
    expect(updatedRow?.resolved_at).toEqual(expect.any(Number));

    const crossScopeRes = await PATCH(
      jsonRequest('http://localhost/api/mistakes/mk_patch', {
        method: 'PATCH',
        headers: { cookie: 'hw_parent=pt_b' },
        body: { resolved: false },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_patch' }) },
    );
    expect(crossScopeRes.status).toBe(404);
    await expect(crossScopeRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('deletes a mistake snapshot only for the scoped child', async () => {
    const db = await getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO mistakes (
         id, child_id, source_sub_question_id, source_assignment_id, snapshot_crop_path, snapshot_subject,
         snapshot_parsed_stem_json, snapshot_solution_steps_json, snapshot_final_answer, snapshot_student_answer,
         snapshot_error_type, snapshot_explanation_md, snapshot_knowledge_tags_json, added_at, source, resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mk_delete',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_delete.jpg',
      'math',
      '{}',
      '[]',
      '42',
      null,
      null,
      'explanation',
      '[]',
      Date.now(),
      'manual',
      0,
    );
    const snapshotPath = path.join(uploadDir, 'mistakes', 'ch_a', 'mk_delete.jpg');
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, 'snapshot');

    const { DELETE } = await import('@app/api/mistakes/[mistakeId]/route');

    const forbiddenRes = await DELETE(
      new NextRequest('http://localhost/api/mistakes/mk_delete', {
        method: 'DELETE',
        headers: { cookie: 'hw_parent=pt_b' },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_delete' }) },
    );
    expect(forbiddenRes.status).toBe(404);
    expect(existsSync(snapshotPath)).toBe(true);

    const okRes = await DELETE(
      new NextRequest('http://localhost/api/mistakes/mk_delete', {
        method: 'DELETE',
        headers: { cookie: 'hw_parent=pt_a' },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_delete' }) },
    );
    expect(okRes.status).toBe(200);
    await expect(okRes.json()).resolves.toMatchObject({ ok: true });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM mistakes WHERE id = ?').get('mk_delete'),
    ).toMatchObject({ count: 0 });
    expect(existsSync(snapshotPath)).toBe(false);
  });

  it('validates mistake patch payloads and authentication', async () => {
    const db = await getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1);
    db.prepare(
      `INSERT INTO mistakes (
         id, child_id, source_sub_question_id, source_assignment_id, snapshot_crop_path, snapshot_subject,
         snapshot_parsed_stem_json, snapshot_solution_steps_json, snapshot_final_answer, snapshot_student_answer,
         snapshot_error_type, snapshot_explanation_md, snapshot_knowledge_tags_json, added_at, source, resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mk_invalid',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_invalid.jpg',
      'math',
      '{}',
      '[]',
      '42',
      null,
      null,
      'explanation',
      '[]',
      Date.now(),
      'manual',
      0,
    );

    const { PATCH } = await import('@app/api/mistakes/[mistakeId]/route');

    const unauthenticatedRes = await PATCH(
      jsonRequest('http://localhost/api/mistakes/mk_invalid', {
        method: 'PATCH',
        body: { resolved: true },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_invalid' }) },
    );
    expect(unauthenticatedRes.status).toBe(401);
    await expect(unauthenticatedRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTH_REQUIRED' },
    });

    const badPayloadRes = await PATCH(
      jsonRequest('http://localhost/api/mistakes/mk_invalid', {
        method: 'PATCH',
        headers: { cookie: 'hw_parent=pt_a' },
        body: { resolved: 'yes' },
      }),
      { params: Promise.resolve({ mistakeId: 'mk_invalid' }) },
    );
    expect(badPayloadRes.status).toBe(400);
    await expect(badPayloadRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});

describe('mistakes weak-points route', () => {
  it('returns weak points for the scoped child only', async () => {
    const db = await getDb();
    const now = Date.now();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO mistakes (
         id, child_id, source_sub_question_id, source_assignment_id, snapshot_crop_path, snapshot_subject,
         snapshot_parsed_stem_json, snapshot_solution_steps_json, snapshot_final_answer, snapshot_student_answer,
         snapshot_error_type, snapshot_explanation_md, snapshot_knowledge_tags_json, added_at, source, resolved
       ) VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mk_1',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_1.jpg',
      'math',
      '{}',
      '[]',
      'A',
      null,
      null,
      'exp',
      JSON.stringify([
        { id: 'kt_alg', name: 'Algebra', confidence: 0.9 },
        { id: 'kt_geo', name: 'Geometry', confidence: 0.7 },
      ]),
      now - 2 * 24 * 60 * 60 * 1000,
      'manual',
      0,
      'mk_2',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_2.jpg',
      'math',
      '{}',
      '[]',
      'B',
      null,
      null,
      'exp',
      JSON.stringify([{ id: 'kt_alg', name: 'Algebra', confidence: 0.95 }]),
      now - 5 * 24 * 60 * 60 * 1000,
      'manual',
      0,
      'mk_old',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_old.jpg',
      'math',
      '{}',
      '[]',
      'C',
      null,
      null,
      'exp',
      JSON.stringify([{ id: 'kt_old', name: 'Old', confidence: 1 }]),
      now - 40 * 24 * 60 * 60 * 1000,
      'manual',
      0,
      'mk_other_child',
      'ch_b',
      null,
      null,
      'mistakes/ch_b/mk_other_child.jpg',
      'math',
      '{}',
      '[]',
      'D',
      null,
      null,
      'exp',
      JSON.stringify([{ id: 'kt_other', name: 'Other', confidence: 1 }]),
      now - 1 * 24 * 60 * 60 * 1000,
      'manual',
      0,
    );

    const { GET } = await import('@app/api/mistakes/weak-points/route');
    const res = await GET(
      new NextRequest('http://localhost/api/mistakes/weak-points?days=30&limit=2', {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      windowDays: 30,
      totalMistakes: 2,
      items: [
        { tagId: 'kt_alg', name: 'Algebra', mistakeCount: 2, share: 1 },
        { tagId: 'kt_geo', name: 'Geometry', mistakeCount: 1, share: 0.5 },
      ],
    });
  });

  it('validates weak-points query params and authentication', async () => {
    const db = await getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1);

    const { GET } = await import('@app/api/mistakes/weak-points/route');

    const unauthenticatedRes = await GET(
      new NextRequest('http://localhost/api/mistakes/weak-points'),
    );
    expect(unauthenticatedRes.status).toBe(401);
    await expect(unauthenticatedRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTH_REQUIRED' },
    });

    const badDaysRes = await GET(
      new NextRequest('http://localhost/api/mistakes/weak-points?days=abc', {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
    );
    expect(badDaysRes.status).toBe(400);
    await expect(badDaysRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });

    const badLimitRes = await GET(
      new NextRequest('http://localhost/api/mistakes/weak-points?limit=0', {
        headers: { cookie: 'hw_parent=pt_a' },
      }),
    );
    expect(badLimitRes.status).toBe(400);
    await expect(badLimitRes.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});
