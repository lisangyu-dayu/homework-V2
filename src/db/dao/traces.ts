// workflow_traces DAO（M4 完成实现）
import { nanoid } from 'nanoid';
import { getDb } from '../client';

export interface TraceInput {
  assignmentId: string;
  nodeName: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  input?: unknown;
  output?: unknown;
  errorMsg?: string;
  modelUsed?: string;
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
}

export function insertTrace(input: TraceInput): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO workflow_traces
      (id, assignment_id, node_name, status, duration_ms, input_json, output_json,
       error_msg, model_used, tokens_in, tokens_out, cost_cents, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `tr_${nanoid(10)}`,
    input.assignmentId,
    input.nodeName,
    input.status,
    input.durationMs,
    input.input ? JSON.stringify(input.input) : null,
    input.output ? JSON.stringify(input.output) : null,
    input.errorMsg ?? null,
    input.modelUsed ?? null,
    input.tokensIn ?? null,
    input.tokensOut ?? null,
    input.costCents ?? null,
    Date.now(),
  );
}

export function listByAssignment(_assignmentId: string): unknown[] {
  // TODO[M4]: SELECT 并映射
  return [];
}
