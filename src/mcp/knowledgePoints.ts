import { getById as getTagById, getTree, searchByKeyword } from '@/db/dao/tags';
import type { KnowledgeTag } from '@/lib/types';

export interface SearchFilters {
  subject: string;
  gradeMin?: number;
  gradeMax?: number;
  topK?: number;
}

function uniq<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

function buildSearchTerms(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const terms = [
    normalized,
    ...normalized.split(/[，。；、,.?？!！:：\s]+/u),
  ]
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  return uniq(terms, (item) => item).slice(0, 12);
}

export async function search(text: string, filters: SearchFilters): Promise<KnowledgeTag[]> {
  const topK = Math.max(1, filters.topK ?? 20);
  const candidates = buildSearchTerms(text).flatMap((term) => searchByKeyword(term, filters.subject, topK));
  return uniq(candidates, (item) => item.id).slice(0, topK);
}

export async function getById(id: string): Promise<KnowledgeTag | null> {
  const tag = getTagById(id);
  return tag ? { id: tag.id, name: tag.name } : null;
}

export async function tree(subject: string, grade?: number): Promise<unknown> {
  return getTree(subject, grade);
}
