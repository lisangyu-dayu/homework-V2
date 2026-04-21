// 学生答案机会性抽取（M5）
export interface ExtractResult {
  items: Array<{
    subQuestionId: string;
    studentAnswer: string | null;  // null = 无法识别
    confidence: number;
  }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<ExtractResult> {
  // TODO[M5]: Claude Vision，prompt 明确允许返回 "unclear"
  // TODO: confidence < 0.6 → 直接置 null
  return { items: [] };
}
