// 知识点检索（V1 纯 TS + SQLite，无 embedding）
// M2 / M5 完成实现
import type { KnowledgeTag } from '@/lib/types';

export interface SearchFilters {
  subject: string;
  gradeMin?: number;
  gradeMax?: number;
  topK?: number;
}

export async function search(_text: string, _filters: SearchFilters): Promise<KnowledgeTag[]> {
  // TODO[M5]: 关键词/别名匹配召回 20 候选 → LLM 精排到 top-k
  return [];
}

export async function getById(_id: string): Promise<KnowledgeTag | null> {
  // TODO[M5]: DAO 查询
  return null;
}

export async function tree(_subject: string): Promise<unknown> {
  // TODO[M5]: 构建树结构返给 API
  return [];
}
