// 极简 DAG runner（M4 完成实现）
// 设计目标：
//  - 节点注册 + 依赖声明
//  - 并发调度
//  - 失败重试（指数退避）+ fallback
//  - 每节点自动写 trace
import { insertTrace } from '@/db/dao/traces';
import { logger } from '@/lib/logger';

export interface NodeHandler<TIn, TOut, TCtx> {
  (input: TIn, ctx: TCtx): Promise<TOut>;
}

export interface NodeSpec<TCtx> {
  name: string;
  deps?: string[];
  retries?: number;
  fallback?: (err: unknown, ctx: TCtx) => Promise<unknown> | unknown;
  handler: NodeHandler<unknown, unknown, TCtx>;
}

export interface DagContext {
  assignmentId: string;
}

export class Dag<TCtx extends DagContext> {
  private readonly nodes = new Map<string, NodeSpec<TCtx>>();

  register(spec: NodeSpec<TCtx>): this {
    this.nodes.set(spec.name, spec);
    return this;
  }

  async run(ctx: TCtx, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    // TODO[M4]: 拓扑排序 + 并发调度 + 重试 + trace 写入
    const results: Record<string, unknown> = { ...input };
    for (const [name, spec] of this.nodes) {
      const start = Date.now();
      try {
        const out = await spec.handler(results, ctx);
        results[name] = out;
        insertTrace({
          assignmentId: ctx.assignmentId,
          nodeName: name,
          status: 'success',
          durationMs: Date.now() - start,
        });
      } catch (err) {
        logger.error({ node: name, err: String(err) }, 'node failed');
        insertTrace({
          assignmentId: ctx.assignmentId,
          nodeName: name,
          status: 'failed',
          durationMs: Date.now() - start,
          errorMsg: String(err),
        });
        if (spec.fallback) {
          results[name] = await spec.fallback(err, ctx);
        } else {
          throw err;
        }
      }
    }
    return results;
  }
}
