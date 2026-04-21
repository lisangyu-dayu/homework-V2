// 单小题结构化理解（含图表）（M5）
import type { ParsedMathQuestion } from '@/lib/types';

export interface ParseQuestionResult {
  items: Array<{ subQuestionId: string; parsed: ParsedMathQuestion; cropPath: string }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<ParseQuestionResult> {
  // TODO[M5]: 两步 prompt（先描述图，后提取结构化）
  // TODO[M5]: 对每个小题裁剪图 + Claude Vision 调用 + Zod 校验
  return { items: [] };
}
