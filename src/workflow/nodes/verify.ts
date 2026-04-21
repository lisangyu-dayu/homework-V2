// SymPy 等价验证（M5/M6）
import * as sympy from '@/mcp/sympy';

export interface VerifyResult {
  items: Array<{
    subQuestionId: string;
    consistent: boolean;
    note?: string;
  }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<VerifyResult> {
  // TODO[M5/M6]: 对每道题 sympy.equivalent(aiAnswer, sympySolved)
  // TODO: 仅对"计算/方程/填空"类题触发；证明题跳过（返回 consistent=true + 'skipped'）
  void sympy;
  return { items: [] };
}
