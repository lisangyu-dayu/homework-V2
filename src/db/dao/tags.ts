// knowledge_tags DAO（M2 完成实现）
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

export function bulkInsert(_tags: TagInsert[]): void {
  // TODO[M2]: 事务批插
}

export function searchByKeyword(_query: string, _subject: string, _limit = 20): KnowledgeTag[] {
  // TODO[M2]: LIKE + aliases_json 匹配
  return [];
}

export function getTree(_subject: string): unknown {
  // TODO[M2]
  return [];
}

export function getById(_id: string): KnowledgeTag | null {
  return null;
}
