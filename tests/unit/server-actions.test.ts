import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';

const cookiesMock = vi.mocked(cookies);
const revalidatePathMock = vi.mocked(revalidatePath);

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-server-actions-'));
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

  cookiesMock.mockReset();
  revalidatePathMock.mockReset();
});

afterAll(async () => {
  const { closeDb } = await import('@/db/client');
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

function mockParentCookie(parentToken: string) {
  cookiesMock.mockResolvedValue({
    get(name: string) {
      return name === 'hw_parent' ? { value: parentToken } : undefined;
    },
  } as Awaited<ReturnType<typeof cookies>>);
}

function createFormData(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

describe('result page actions', () => {
  it('adds a mistake snapshot and records grading feedback inside the cookie child scope', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();

    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1);
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_a', 'short-a', 'ch_a', 'math', 'incoming/a.jpg', 'done', 1);
    db.prepare(
      'INSERT INTO major_questions (id, assignment_id, number, order_index) VALUES (?, ?, ?, ?)',
    ).run('mq_a', 'as_a', '一', 0);

    const cropPath = path.join(uploadDir, 'crops', 'as_a', 'sq_a.jpg');
    mkdirSync(path.dirname(cropPath), { recursive: true });
    writeFileSync(cropPath, 'crop-a');

    db.prepare(
      `INSERT INTO sub_questions (
         id, major_id, number, order_index, crop_path, parsed_stem_json, solution_steps_json,
         final_answer, confidence, verdict, student_answer, error_type, explanation_md
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );

    mockParentCookie('pt_a');

    const { addMistakeFromResultAction, reportAssignmentFeedbackAction } = await import(
      '@app/r/[shortId]/actions'
    );

    await addMistakeFromResultAction(
      createFormData({
        shortId: 'short-a',
        subQuestionId: 'sq_a',
      }),
    );

    const mistakeRow = db
      .prepare('SELECT child_id, source_sub_question_id, source, snapshot_final_answer FROM mistakes LIMIT 1')
      .get() as
      | { child_id: string; source_sub_question_id: string; source: string; snapshot_final_answer: string }
      | undefined;
    expect(mistakeRow).toMatchObject({
      child_id: 'ch_a',
      source_sub_question_id: 'sq_a',
      source: 'manual',
      snapshot_final_answer: '42',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/r/short-a');
    expect(revalidatePathMock).toHaveBeenCalledWith('/mistakes');

    revalidatePathMock.mockClear();

    await reportAssignmentFeedbackAction(
      createFormData({
        shortId: 'short-a',
        subQuestionId: 'sq_a',
      }),
    );

    const feedbackRow = db
      .prepare('SELECT sub_question_id, feedback_type, payload_json FROM feedback LIMIT 1')
      .get() as { sub_question_id: string; feedback_type: string; payload_json: string } | undefined;
    expect(feedbackRow?.sub_question_id).toBe('sq_a');
    expect(feedbackRow?.feedback_type).toBe('grading_wrong');
    expect(JSON.parse(feedbackRow?.payload_json ?? '{}')).toMatchObject({
      source: 'result-page',
      currentVerdict: 'wrong',
      currentStudentAnswer: '24',
      currentFinalAnswer: '42',
      currentErrorType: '计算错误',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/r/short-a');
  });

  it('rejects result page actions when the sub question is outside the cookie child scope', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();

    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_a', 'openid-a', 'pt_a', 1, 'ch_b', 'openid-b', 'pt_b', 2);
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_b', 'short-b', 'ch_b', 'math', 'incoming/b.jpg', 'done', 1);
    db.prepare(
      'INSERT INTO major_questions (id, assignment_id, number, order_index) VALUES (?, ?, ?, ?)',
    ).run('mq_b', 'as_b', '一', 0);
    db.prepare(
      `INSERT INTO sub_questions (
         id, major_id, number, order_index, crop_path, parsed_stem_json, solution_steps_json,
         final_answer, confidence, verdict, student_answer, error_type, explanation_md
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sq_b', 'mq_b', '(1)', 0, 'crops/as_b/sq_b.jpg', '{}', '[]', '1', 0.9, 'wrong', '0', null, 'exp');

    mockParentCookie('pt_a');

    const { addMistakeFromResultAction } = await import('@app/r/[shortId]/actions');
    await expect(
      addMistakeFromResultAction(
        createFormData({
          shortId: 'short-b',
          subQuestionId: 'sq_b',
        }),
      ),
    ).rejects.toThrow('sub question not found');
  });
});

describe('mistakes page actions', () => {
  it('updates resolved state and deletes mistakes inside the cookie child scope', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();

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
      'mk_a',
      'ch_a',
      null,
      null,
      'mistakes/ch_a/mk_a.jpg',
      'math',
      '{}',
      '[]',
      '42',
      null,
      null,
      'exp',
      '[]',
      Date.now(),
      'manual',
      0,
    );
    const snapshotPath = path.join(uploadDir, 'mistakes', 'ch_a', 'mk_a.jpg');
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, 'snapshot');

    mockParentCookie('pt_a');

    const { deleteMistakeAction, setMistakeResolvedAction } = await import('@app/mistakes/actions');

    await setMistakeResolvedAction(
      createFormData({
        mistakeId: 'mk_a',
        resolved: '1',
        returnTo: '/mistakes?resolved=0',
      }),
    );

    const updatedRow = db
      .prepare('SELECT resolved, resolved_at FROM mistakes WHERE id = ?')
      .get('mk_a') as { resolved: number; resolved_at: number | null } | undefined;
    expect(updatedRow).toMatchObject({ resolved: 1 });
    expect(updatedRow?.resolved_at).toEqual(expect.any(Number));
    expect(revalidatePathMock).toHaveBeenCalledWith('/mistakes?resolved=0');
    expect(revalidatePathMock).toHaveBeenCalledWith('/mistakes');

    revalidatePathMock.mockClear();

    await deleteMistakeAction(
      createFormData({
        mistakeId: 'mk_a',
        returnTo: '/mistakes?resolved=0',
      }),
    );

    expect(db.prepare('SELECT COUNT(*) AS count FROM mistakes WHERE id = ?').get('mk_a')).toMatchObject({
      count: 0,
    });
    expect(existsSync(snapshotPath)).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith('/mistakes?resolved=0');
    expect(revalidatePathMock).toHaveBeenCalledWith('/mistakes');
  });

  it('rejects mistakes page actions when the mistake is outside the cookie child scope', async () => {
    const { getDb } = await import('@/db/client');
    const db = getDb();

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
      'mk_b',
      'ch_b',
      null,
      null,
      'mistakes/ch_b/mk_b.jpg',
      'math',
      '{}',
      '[]',
      '1',
      null,
      null,
      'exp',
      '[]',
      Date.now(),
      'manual',
      0,
    );

    mockParentCookie('pt_a');

    const { setMistakeResolvedAction } = await import('@app/mistakes/actions');
    await expect(
      setMistakeResolvedAction(
        createFormData({
          mistakeId: 'mk_b',
          resolved: '1',
          returnTo: '/mistakes',
        }),
      ),
    ).rejects.toThrow('mistake not found');
  });
});
