// SymPy MCP（V1 用 Python 子进程，非真正 MCP 协议）
// M6 完成实现
import { MCPError } from '@/lib/errors';

export interface SympyEquivalenceResult {
  equivalent: boolean;
  canonicalA?: string;
  canonicalB?: string;
  note?: string;
}

export async function solve(_equation: string): Promise<string[]> {
  // TODO[M6]: spawn python scripts/sympy_runner.py → stdin JSON → stdout JSON
  throw new MCPError('sympy', 'not-implemented');
}

export async function equivalent(_a: string, _b: string): Promise<SympyEquivalenceResult> {
  // TODO[M6]: 核心接口；支持表达式等价 + 数值近似
  throw new MCPError('sympy', 'not-implemented');
}

export async function simplify(_expr: string): Promise<string> {
  throw new MCPError('sympy', 'not-implemented');
}
