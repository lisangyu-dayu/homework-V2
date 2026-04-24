import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-db-'));
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

describe('db dao basics', () => {
  it('findOrCreateByOpenId is idempotent for the same openid', async () => {
    const { getDb } = await import('@/db/client');
    const { findOrCreateByOpenId } = await import('@/db/dao/children');

    const first = findOrCreateByOpenId('openid-dup', 7);
    const second = findOrCreateByOpenId('openid-dup', 8);
    const count = getDb().prepare('SELECT COUNT(*) AS count FROM children WHERE openid = ?').get('openid-dup') as {
      count: number;
    };

    expect(second.id).toBe(first.id);
    expect(second.parentToken).toBe(first.parentToken);
    expect(count.count).toBe(1);
  });

  it('creates, lists and completes assignments', async () => {
    const { getDb } = await import('@/db/client');
    const { createAssignment, completeAssignment, getById, getByShortId, listByChild } = await import('@/db/dao/assignments');

    getDb().prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_1', 'openid-1', 'pt_1', Date.now());

    const created = createAssignment({
      childId: 'ch_1',
      subject: 'math',
      originalImagePath: 'incoming/a.jpg',
    });
    completeAssignment(created.id, { total: 2, correct: 1, wrong: 1, unmarked: 0 });

    expect(getById(created.id)).toMatchObject({
      id: created.id,
      shortId: created.shortId,
      childId: 'ch_1',
      status: 'done',
      totalCount: 2,
    });
    expect(getByShortId(created.shortId)?.id).toBe(created.id);
    expect(listByChild('ch_1', { limit: 10 })).toHaveLength(1);
  });

  it('stores question hierarchy and lists mistakes with weak points', async () => {
    const { getDb } = await import('@/db/client');
    const { insertMajorQuestion, bulkInsertSubQuestions, getByAssignment } = await import('@/db/dao/questions');
    const { addMistake, list, weakPoints } = await import('@/db/dao/mistakes');

    const db = getDb();
    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_1', 'openid-1', 'pt_1', Date.now());
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_1', 'short-1', 'ch_1', 'math', 'incoming/a.jpg', 'processing', Date.now());
    db.prepare(
      'INSERT INTO knowledge_tags (id, subject, name) VALUES (?, ?, ?), (?, ?, ?)',
    ).run('kt_1', 'math', '一元一次方程', 'kt_2', 'math', '二元一次方程');

    insertMajorQuestion({ id: 'mq_1', assignmentId: 'as_1', number: '一', orderIndex: 0 });
    mkdirSync(path.join(uploadDir, 'crops', 'as_1'), { recursive: true });
    writeFileSync(path.join(uploadDir, 'crops', 'as_1', 'sq_1.jpg'), 'crop');

    bulkInsertSubQuestions([{
      id: 'sq_1',
      majorId: 'mq_1',
      number: '(1)',
      orderIndex: 0,
      cropPath: path.join('crops', 'as_1', 'sq_1.jpg'),
      parsedStem: {
        subject: 'math',
        questionType: 'solve-equation',
        stemText: 'x + 1 = 2',
        knownConditions: [],
        goal: '求 x',
      },
      solutionSteps: [{ text: '两边同时减 1', formula: 'x = 1' }],
      finalAnswer: 'x=1',
      confidence: 0.9,
      verdict: 'wrong',
      studentAnswer: 'x=2',
      errorType: '计算失误',
      explanationMd: '重新移项',
      knowledgeTagIds: [{ id: 'kt_1', confidence: 0.98 }],
    }]);

    const tree = getByAssignment('as_1');
    expect(tree.majorQuestions).toHaveLength(1);
    expect(tree.majorQuestions[0]?.subQuestions[0]?.knowledgeTags[0]?.id).toBe('kt_1');

    const { mistakeId } = await addMistake({
      childId: 'ch_1',
      source: 'manual',
      subQuestion: {
        id: 'sq_1',
        assignmentId: 'as_1',
        subject: 'math',
        cropPath: path.join('crops', 'as_1', 'sq_1.jpg'),
        parsedStemJson: JSON.stringify(tree.majorQuestions[0]?.subQuestions[0]?.parsedStem),
        solutionStepsJson: JSON.stringify(tree.majorQuestions[0]?.subQuestions[0]?.solutionSteps),
        finalAnswer: 'x=1',
        studentAnswer: 'x=2',
        errorType: '计算失误',
        explanationMd: '重新移项',
        verdict: 'wrong',
        knowledgeTags: [{ id: 'kt_1', name: '一元一次方程', confidence: 0.98 }],
      },
    });

    const mistakes = list({ childId: 'ch_1', limit: 10, tagIds: ['kt_1'] });
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]?.id).toBe(mistakeId);

    const weak = weakPoints('ch_1', { days: 30, limit: 5 });
    expect(weak.totalMistakes).toBe(1);
    expect(weak.items[0]).toMatchObject({ tagId: 'kt_1', mistakeCount: 1, share: 1 });
  });

  it('scopes assignment detail queries by child in DAO', async () => {
    const { getDb } = await import('@/db/client');
    const {
      getAssignmentDetailByIdForChild,
      getAssignmentDetailByShortIdForChild,
    } = await import('@/db/dao/homeworkData');
    const db = getDb();

    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    ).run('ch_1', 'openid-1', 'pt_1', Date.now(), 'ch_2', 'openid-2', 'pt_2', Date.now());
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_1', 'short-1', 'ch_1', 'math', 'incoming/a.jpg', 'processing', Date.now());

    expect(getAssignmentDetailByIdForChild('as_1', 'ch_1')?.id).toBe('as_1');
    expect(getAssignmentDetailByIdForChild('as_1', 'ch_2')).toBeNull();
    expect(getAssignmentDetailByShortIdForChild('short-1', 'ch_1')?.id).toBe('as_1');
    expect(getAssignmentDetailByShortIdForChild('short-1', 'ch_2')).toBeNull();
  });

  it('reads workflow traces in order', async () => {
    const { getDb } = await import('@/db/client');
    const { insertTrace, listByAssignment } = await import('@/db/dao/traces');
    const db = getDb();

    db.prepare(
      'INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)',
    ).run('ch_1', 'openid-1', 'pt_1', Date.now());
    db.prepare(
      `INSERT INTO assignments (
         id, short_id, child_id, subject, original_image_path, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('as_1', 'short-1', 'ch_1', 'math', 'incoming/a.jpg', 'processing', Date.now());

    insertTrace({ assignmentId: 'as_1', nodeName: 'preprocess', status: 'success', durationMs: 12, input: { a: 1 } });
    insertTrace({ assignmentId: 'as_1', nodeName: 'layoutSplit', status: 'failed', durationMs: 24, errorMsg: 'boom' });

    const traces = listByAssignment('as_1');
    expect(traces).toHaveLength(2);
    expect(traces[0]?.nodeName).toBe('preprocess');
    expect(traces[1]?.errorMsg).toBe('boom');
  });
});
