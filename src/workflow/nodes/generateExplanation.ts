// 讲解生成（M5）
// 注意：对每道题都生成（产品定位是"家教"，不是判分）
export interface ExplanationResult {
  items: Array<{ subQuestionId: string; explanationMd: string; errorType?: string }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<ExplanationResult> {
  // TODO[M5]: Claude 生成 Markdown + LaTeX 讲解
  // TODO: 错题额外生成 errorType（概念不清/计算失误/漏解/题意偏差）
  return { items: [] };
}
