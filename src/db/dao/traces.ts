// workflow_traces DAO（M4 完成实现）
//
// 订阅模式下不记录 token / cost：CLI 不暴露这些值，按次量化也无意义。
// trace 仅保留 duration、status、model、error 四项足以定位故障。
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
  modelUsed?: string;     // "claude:sonnet" | "codex:gpt-5.4" | "local"
}

export function insertTrace(input: TraceInput): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO workflow_traces
      (id, assignment_id, node_name, status, duration_ms, input_json, output_json,
       error_msg, model_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    Date.now(),
  );
}

export function listByAssignment(_assignmentId: string): unknown[] {
  // TODO[M4]: SELECT 并映射
  return [];
}
