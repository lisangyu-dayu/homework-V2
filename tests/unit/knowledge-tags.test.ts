import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';

let tempRoot = '';
let sqlitePath = '';
let uploadDir = '';

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-tags-'));
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
    DELETE FROM knowledge_tags;
  `);

  const { bulkInsert } = await import('@/db/dao/tags');
  bulkInsert([
    {
      id: 'kt_math',
      subject: 'math',
      name: '数学',
      gradeMin: 7,
      gradeMax: 9,
      brief: '义务教育阶段数学知识点根节点',
    },
    {
      id: 'kt_math_alg',
      subject: 'math',
      name: '数与代数',
      parentId: 'kt_math',
      gradeMin: 7,
      gradeMax: 9,
    },
    {
      id: 'kt_math_alg_linear',
      subject: 'math',
      name: '一元一次方程',
      parentId: 'kt_math_alg',
      gradeMin: 7,
      gradeMax: 7,
      aliases: ['线性方程'],
    },
    {
      id: 'kt_math_geo',
      subject: 'math',
      name: '图形与几何',
      parentId: 'kt_math',
      gradeMin: 9,
      gradeMax: 9,
    },
    {
      id: 'kt_math_geo_circle',
      subject: 'math',
      name: '圆',
      parentId: 'kt_math_geo',
      gradeMin: 9,
      gradeMax: 9,
      aliases: ['圆的性质'],
    },
  ]);
});

describe('knowledge tags dao and routes', () => {
  it('builds a tree filtered by grade and searches aliases', async () => {
    const { getTree, searchByKeyword, getById } = await import('@/db/dao/tags');

    const grade7Tree = getTree('math', 7);
    expect(grade7Tree).toHaveLength(1);
    expect(grade7Tree[0]?.children.map((item) => item.name)).toContain('数与代数');
    expect(grade7Tree[0]?.children.map((item) => item.name)).not.toContain('图形与几何');

    const grade9Tree = getTree('math', 9);
    expect(grade9Tree[0]?.children.map((item) => item.name)).toContain('图形与几何');

    expect(searchByKeyword('线性', 'math', 10)).toEqual([{ id: 'kt_math_alg_linear', name: '一元一次方程' }]);
    expect(getById('kt_math_geo_circle')).toMatchObject({
      id: 'kt_math_geo_circle',
      aliases: ['圆的性质'],
    });
  });

  it('serves the knowledge tag tree and detail routes', async () => {
    const { GET: getTreeRoute } = await import('@app/api/knowledge-tags/route');
    const { GET: getDetailRoute } = await import('@app/api/knowledge-tags/[id]/route');

    const treeRes = await getTreeRoute(new NextRequest('http://localhost/api/knowledge-tags?subject=math&grade=9'));
    expect(treeRes.status).toBe(200);
    const treeBody = await treeRes.json();
    expect(treeBody.ok).toBe(true);
    expect(treeBody.tree).toHaveLength(1);
    expect(treeBody.tree[0]?.id).toBe('kt_math');
    expect(treeBody.tree[0]?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'kt_math_alg' }),
        expect.objectContaining({ id: 'kt_math_geo' }),
      ]),
    );

    const detailRes = await getDetailRoute(new NextRequest('http://localhost/api/knowledge-tags/kt_math_geo_circle'), {
      params: Promise.resolve({ id: 'kt_math_geo_circle' }),
    });
    expect(detailRes.status).toBe(200);
    await expect(detailRes.json()).resolves.toMatchObject({
      ok: true,
      tag: {
        id: 'kt_math_geo_circle',
        name: '圆',
        aliases: ['圆的性质'],
      },
    });
  });
});
