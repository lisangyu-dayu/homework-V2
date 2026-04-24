import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-feedback-route-'));
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
});

afterAll(async () => {
  const { closeDb } = await import('@/db/client');
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('feedback route', () => {
  it('stores feedback only for sub questions owned by the cookie child', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();

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
      'crops/as_a/sq_a.jpg',
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
      'crops/as_b/sq_b.jpg',
      '{"stem":"b"}',
      '[]',
      '1',
      0.9,
      'wrong',
      '0',
      '漏解',
      '补充条件',
    );

    const { POST } = await import('@app/api/feedback/route');
    const okRes = await POST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: {
          cookie: 'hw_parent=pt_a',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subQuestionId: 'sq_a',
          feedbackType: 'grading_wrong',
          payload: { correctVerdict: 'correct', note: '这题应判对' },
        }),
      }),
    );
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody).toMatchObject({ ok: true, feedbackId: expect.any(String) });

    const row = db.prepare(
      'SELECT sub_question_id, feedback_type, payload_json FROM feedback WHERE id = ?',
    ).get(okBody.feedbackId) as { sub_question_id: string; feedback_type: string; payload_json: string };
    expect(row.sub_question_id).toBe('sq_a');
    expect(row.feedback_type).toBe('grading_wrong');
    expect(JSON.parse(row.payload_json)).toMatchObject({ correctVerdict: 'correct', note: '这题应判对' });

    const badRes = await POST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: {
          cookie: 'hw_parent=pt_a',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subQuestionId: 'sq_b',
          feedbackType: 'manual_verdict',
          payload: { correctVerdict: 'wrong' },
        }),
      }),
    );
    expect(badRes.status).toBe(404);
  });
});
