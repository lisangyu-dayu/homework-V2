import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tempRoot = path.join(os.tmpdir(), `homework-v2-persist-${Date.now()}`);
const sqlitePath = path.join(tempRoot, 'test.db');
const uploadDir = path.join(tempRoot, 'uploads');

beforeAll(() => {
  mkdirSync(uploadDir, { recursive: true });
  process.env.OPENCLAW_WEBHOOK_SECRET = 'test-openclaw-secret';
  process.env.OPENCLAW_PUSHBACK_URL = 'https://example.com/pushback';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3100';
  process.env.PARENT_LINK_SIGNING_SECRET = '1234567890abcdef1234567890abcdef';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'pass';
  process.env.SQLITE_PATH = sqlitePath;
  process.env.UPLOAD_DIR = uploadDir;

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
    DELETE FROM sub_questions;
    DELETE FROM major_questions;
    DELETE FROM mistakes;
    DELETE FROM assignments;
    DELETE FROM children;
    DELETE FROM knowledge_tags;
  `);
  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(path.join(uploadDir, 'crops', 'as_1'), { recursive: true });
  writeFileSync(path.join(uploadDir, 'crops', 'as_1', 'sq_1.jpg'), 'crop');

  const { resetConfigCacheForTest } = await import('@/lib/config');
  resetConfigCacheForTest();
});

afterAll(async () => {
  const { closeDb } = await import('@/db/client');
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

function seedAssignment(): void {
  const db = new Database(sqlitePath);
  db.prepare('INSERT INTO children (id, openid, parent_token, created_at) VALUES (?, ?, ?, ?)').run(
    'ch_1',
    'openid-1',
    'pt_1',
    Date.now(),
  );
  db.prepare(
    `INSERT INTO assignments (
       id, short_id, child_id, subject, original_image_path, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('as_1', 'short-1', 'ch_1', 'math', 'incoming/a.jpg', 'processing', Date.now());
  db.prepare('INSERT INTO knowledge_tags (id, subject, name) VALUES (?, ?, ?)').run(
    'kt_1',
    'math',
    '一元一次方程',
  );
  db.close();
}

function buildDeps(tagId = 'kt_1') {
  return {
    parseQuestion: {
      items: [{
        subQuestionId: 'sq_1',
        cropPath: path.join('crops', 'as_1', 'sq_1.jpg'),
        parsed: {
          subject: 'math' as const,
          questionType: 'solve-equation' as const,
          stemText: '解方程 x + 1 = 2',
          knownConditions: [],
          goal: '求 x',
        },
      }],
    },
    selfSolve: {
      items: [{
        subQuestionId: 'sq_1',
        solution: {
          steps: [{ text: '移项', formula: 'x = 1' }],
          finalAnswer: 'x = 1',
          confidence: 0.9,
          solverModel: 'codex' as const,
        },
      }],
    },
    grade: {
      items: [{
        subQuestionId: 'sq_1',
        grading: {
          verdict: 'wrong' as const,
          studentAnswer: 'x = 2',
          errorType: '计算失误',
          comment: 'differs',
        },
      }],
    },
    generateExplanation: {
      items: [{ subQuestionId: 'sq_1', explanationMd: '重新移项。', errorType: '计算失误' }],
    },
    kpTagging: {
      items: [{ subQuestionId: 'sq_1', tagIds: [{ id: tagId, confidence: 0.95 }] }],
    },
  };
}

describe('persist workflow node', () => {
  it('persists questions and auto-adds wrong answers to the mistake book', async () => {
    seedAssignment();
    const { getDb } = await import('@/db/client');
    const { run } = await import('@/workflow/nodes/persist');

    await run(buildDeps(), {
      assignmentId: 'as_1',
      originalImagePath: 'incoming/a.jpg',
      childId: 'ch_1',
      subject: 'math',
    });

    const db = getDb();
    expect(db.prepare('SELECT status, wrong_count FROM assignments WHERE id = ?').get('as_1')).toMatchObject({
      status: 'done',
      wrong_count: 1,
    });
    const mistake = db.prepare('SELECT snapshot_crop_path, source FROM mistakes WHERE child_id = ?').get('ch_1') as {
      snapshot_crop_path: string;
      source: string;
    };
    expect(mistake.source).toBe('auto');
    expect(existsSync(path.join(uploadDir, mistake.snapshot_crop_path))).toBe(true);
  });

  it('rolls back assignment question writes when a related insert fails', async () => {
    seedAssignment();
    const { getDb } = await import('@/db/client');
    const { run } = await import('@/workflow/nodes/persist');

    await expect(run(buildDeps('missing_tag'), {
      assignmentId: 'as_1',
      originalImagePath: 'incoming/a.jpg',
      childId: 'ch_1',
      subject: 'math',
    })).rejects.toThrow();

    const db = getDb();
    expect(db.prepare('SELECT COUNT(*) AS count FROM major_questions WHERE assignment_id = ?').get('as_1')).toMatchObject({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM sub_questions').get()).toMatchObject({ count: 0 });
    expect(db.prepare('SELECT status FROM assignments WHERE id = ?').get('as_1')).toMatchObject({ status: 'processing' });
  });
});
