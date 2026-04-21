// 判定：纯代码规则，不走 LLM（M5）
// 规则：
//   AI 自解 + SymPy 一致  & 学生答案可识别 & 匹配   → correct
//   AI 自解 + SymPy 一致  & 学生答案可识别 & 不匹配 → wrong
//   其他                                          → unmarked
import type { GradingResult } from '@/lib/types';

export interface GradeResult {
  items: Array<{ subQuestionId: string; grading: GradingResult }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<GradeResult> {
  // TODO[M5]: 聚合 verify + extractStudentAnswer + sympy.equivalent(aiAnswer, studentAnswer)
  return { items: [] };
}
