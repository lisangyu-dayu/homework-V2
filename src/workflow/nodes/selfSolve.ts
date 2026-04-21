// AI 自解题：Codex 首选，Claude 兜底（M5）
import type { Solution } from '@/lib/types';

export interface SelfSolveResult {
  items: Array<{ subQuestionId: string; solution: Solution }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<SelfSolveResult> {
  // TODO[M5]: pickProvider({task:'selfSolve'}).chat(...)，失败切换 fallback
  // TODO[M5]: 强制 JSON 输出：{ steps: [...], finalAnswer: "...", confidence: 0..1 }
  return { items: [] };
}
