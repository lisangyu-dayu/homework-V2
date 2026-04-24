import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { bulkInsert, type TagInsert } from '@/db/dao/tags';

const JSON_PATH = path.resolve('data/knowledge-points/math.json');

const SeedEntrySchema = z.object({
  path: z.string().min(1),
  gradeMin: z.number().int().min(1).max(9),
  gradeMax: z.number().int().min(1).max(9),
  brief: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

const SeedSchema = z.object({
  source: z.object({
    title: z.string().min(1),
    url: z.string().url(),
    version: z.string().min(1),
  }),
  subject: z.literal('math'),
  entries: z.array(SeedEntrySchema).min(1),
});

interface SeedNode {
  id: string;
  subject: string;
  name: string;
  parentId?: string;
  gradeMin?: number;
  gradeMax?: number;
  brief?: string;
  aliases?: string[];
}

function makeTagId(subject: string, pathSegments: string[]): string {
  if (pathSegments.length === 0) {
    return `kt_${subject}`;
  }

  const digest = crypto.createHash('sha1').update(`${subject}:${pathSegments.join('>')}`).digest('hex').slice(0, 12);
  return `kt_${subject}_${digest}`;
}

function upsertNode(
  nodes: Map<string, SeedNode>,
  subject: string,
  pathSegments: string[],
  payload: Omit<SeedNode, 'id' | 'subject' | 'name'> & { name: string },
): void {
  const key = pathSegments.join(' > ');
  const existing = nodes.get(key);
  if (existing) {
    existing.gradeMin =
      payload.gradeMin === undefined
        ? existing.gradeMin
        : existing.gradeMin === undefined
          ? payload.gradeMin
          : Math.min(existing.gradeMin, payload.gradeMin);
    existing.gradeMax =
      payload.gradeMax === undefined
        ? existing.gradeMax
        : existing.gradeMax === undefined
          ? payload.gradeMax
          : Math.max(existing.gradeMax, payload.gradeMax);
    if (payload.brief) {
      existing.brief = payload.brief;
    }
    if (payload.aliases && payload.aliases.length > 0) {
      existing.aliases = payload.aliases;
    }
    return;
  }

  nodes.set(key, {
    id: makeTagId(subject, pathSegments),
    subject,
    name: payload.name,
    parentId: payload.parentId,
    gradeMin: payload.gradeMin,
    gradeMax: payload.gradeMax,
    brief: payload.brief,
    aliases: payload.aliases,
  });
}

function toTagInserts(seed: z.infer<typeof SeedSchema>): TagInsert[] {
  const nodes = new Map<string, SeedNode>();
  upsertNode(nodes, seed.subject, [], {
    name: '数学',
    gradeMin: 7,
    gradeMax: 9,
    brief: `依据《${seed.source.title}》整理的 7-9 年级数学知识点树`,
  });

  for (const entry of seed.entries) {
    const segments = entry.path
      .split('>')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    for (let index = 0; index < segments.length; index += 1) {
      const currentSegments = segments.slice(0, index + 1);
      const parentSegments = currentSegments.slice(0, -1);
      const name = currentSegments[currentSegments.length - 1]!;
      const isLeaf = index === segments.length - 1;

      upsertNode(nodes, seed.subject, currentSegments, {
        name,
        parentId: makeTagId(seed.subject, parentSegments),
        gradeMin: entry.gradeMin,
        gradeMax: entry.gradeMax,
        brief: isLeaf ? entry.brief : undefined,
        aliases: isLeaf ? entry.aliases : undefined,
      });
    }
  }

  return Array.from(nodes.entries())
    .sort(([left], [right]) => {
      const leftDepth = left === '' ? 0 : left.split(' > ').length;
      const rightDepth = right === '' ? 0 : right.split(' > ').length;
      return leftDepth - rightDepth || left.localeCompare(right, 'zh-CN');
    })
    .map(([, node]) => ({
      id: node.id,
      subject: node.subject,
      gradeMin: node.gradeMin,
      gradeMax: node.gradeMax,
      name: node.name,
      parentId: node.parentId,
      brief: node.brief,
      aliases: node.aliases,
    }));
}

function main(): void {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`missing ${JSON_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  const parsed = SeedSchema.parse(JSON.parse(raw));
  const tags = toTagInserts(parsed);
  bulkInsert(tags);

  console.warn(
    `[seed-knowledge-points] imported ${tags.length} tags for ${parsed.subject} from ${path.relative(process.cwd(), JSON_PATH)}`,
  );
}

main();
