import { getDb } from '../client';
import type { KnowledgeTag } from '@/lib/types';

export interface TagInsert {
  id: string;
  subject: string;
  gradeMin?: number;
  gradeMax?: number;
  name: string;
  parentId?: string;
  brief?: string;
  aliases?: string[];
}

export interface KnowledgeTagRecord extends KnowledgeTag {
  subject: string;
  gradeMin: number | null;
  gradeMax: number | null;
  parentId: string | null;
  brief: string | null;
  aliases: string[];
}

export interface KnowledgeTagTreeNode extends KnowledgeTagRecord {
  children: KnowledgeTagTreeNode[];
}

interface KnowledgeTagDbRow {
  id: string;
  subject: string;
  grade_min: number | null;
  grade_max: number | null;
  name: string;
  parent_id: string | null;
  brief: string | null;
  aliases_json: string | null;
}

function parseAliases(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mapRow(row: KnowledgeTagDbRow): KnowledgeTagRecord {
  return {
    id: row.id,
    subject: row.subject,
    gradeMin: row.grade_min,
    gradeMax: row.grade_max,
    name: row.name,
    parentId: row.parent_id,
    brief: row.brief,
    aliases: parseAliases(row.aliases_json),
  };
}

function listBySubject(subject: string): KnowledgeTagRecord[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT
       id,
       subject,
       grade_min,
       grade_max,
       name,
       parent_id,
       brief,
       aliases_json
     FROM knowledge_tags
     WHERE subject = ?
     ORDER BY parent_id IS NOT NULL, grade_min, name`,
  ).all(subject) as KnowledgeTagDbRow[];

  return rows.map(mapRow);
}

export function bulkInsert(tags: TagInsert[]): void {
  if (tags.length === 0) {
    return;
  }

  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO knowledge_tags (
       id,
       subject,
       grade_min,
       grade_max,
       name,
       parent_id,
       brief,
       aliases_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       subject = excluded.subject,
       grade_min = excluded.grade_min,
       grade_max = excluded.grade_max,
       name = excluded.name,
       parent_id = excluded.parent_id,
       brief = excluded.brief,
       aliases_json = excluded.aliases_json`,
  );

  db.transaction((items: TagInsert[]) => {
    for (const tag of items) {
      stmt.run(
        tag.id,
        tag.subject,
        tag.gradeMin ?? null,
        tag.gradeMax ?? null,
        tag.name,
        tag.parentId ?? null,
        tag.brief ?? null,
        tag.aliases && tag.aliases.length > 0 ? JSON.stringify(tag.aliases) : null,
      );
    }
  })(tags);
}

export function searchByKeyword(query: string, subject: string, limit = 20): KnowledgeTag[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const db = getDb();
  const like = `%${trimmed}%`;
  const rows = db.prepare(
    `SELECT
       id,
       name
     FROM knowledge_tags
     WHERE subject = ?
       AND (
         name LIKE ?
         OR IFNULL(brief, '') LIKE ?
         OR IFNULL(aliases_json, '') LIKE ?
       )
     ORDER BY
       CASE WHEN name = ? THEN 0
            WHEN name LIKE ? THEN 1
            ELSE 2
       END,
       grade_min,
       name
     LIMIT ?`,
  ).all(subject, like, like, like, trimmed, `${trimmed}%`, limit) as Array<Pick<KnowledgeTagDbRow, 'id' | 'name'>>;

  return rows.map((row) => ({ id: row.id, name: row.name }));
}

function withinGradeRange(tag: KnowledgeTagRecord, grade?: number): boolean {
  if (grade === undefined) {
    return true;
  }

  const min = tag.gradeMin ?? Number.NEGATIVE_INFINITY;
  const max = tag.gradeMax ?? Number.POSITIVE_INFINITY;
  return min <= grade && grade <= max;
}

export function getTree(subject: string, grade?: number): KnowledgeTagTreeNode[] {
  const tags = listBySubject(subject);
  const childrenByParent = new Map<string | null, KnowledgeTagRecord[]>();

  for (const tag of tags) {
    const bucket = childrenByParent.get(tag.parentId) ?? [];
    bucket.push(tag);
    childrenByParent.set(tag.parentId, bucket);
  }

  function build(parentId: string | null): KnowledgeTagTreeNode[] {
    const items = childrenByParent.get(parentId) ?? [];
    const tree: KnowledgeTagTreeNode[] = [];

    for (const item of items) {
      const children = build(item.id);
      if (!withinGradeRange(item, grade) && children.length === 0) {
        continue;
      }

      tree.push({
        ...item,
        children,
      });
    }

    return tree;
  }

  return build(null);
}

export function getById(id: string): KnowledgeTagRecord | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
       id,
       subject,
       grade_min,
       grade_max,
       name,
       parent_id,
       brief,
       aliases_json
     FROM knowledge_tags
     WHERE id = ?
     LIMIT 1`,
  ).get(id) as KnowledgeTagDbRow | undefined;

  return row ? mapRow(row) : null;
}
