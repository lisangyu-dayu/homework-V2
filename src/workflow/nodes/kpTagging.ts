// 知识点打标签（M5）
import * as kp from '@/mcp/knowledgePoints';

export interface KpTaggingResult {
  items: Array<{ subQuestionId: string; tagIds: Array<{ id: string; confidence: number }> }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<KpTaggingResult> {
  // TODO[M5]: kp.search(stemText) 召回 20 → Claude 精排 top-3
  void kp;
  return { items: [] };
}
