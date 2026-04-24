import { insertTrace } from '@/db/dao/traces';
import { logger } from '@/lib/logger';

export interface NodeHandler<TIn, TOut, TCtx> {
  (input: TIn, ctx: TCtx): Promise<TOut>;
}

export const SKIP_NODE = Symbol('dag.skip-node');

export class SkipNodeError extends Error {
  constructor(message = 'node skipped') {
    super(message);
    this.name = 'SkipNodeError';
  }
}

export interface NodeSpec<TCtx> {
  name: string;
  deps?: string[];
  retries?: number;
  retryDelayMs?: number;
  fallback?: (err: unknown, ctx: TCtx) => Promise<unknown> | unknown;
  handler: NodeHandler<unknown, unknown, TCtx>;
}

export interface DagContext {
  assignmentId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSkipSignal(value: unknown): boolean {
  return value === SKIP_NODE || value instanceof SkipNodeError;
}

function createConcurrencyLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = async () => {
    if (active < max) {
      active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export class Dag<TCtx extends DagContext> {
  private readonly nodes = new Map<string, NodeSpec<TCtx>>();

  register(spec: NodeSpec<TCtx>): this {
    this.nodes.set(spec.name, spec);
    return this;
  }

  async run(ctx: TCtx, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.validateGraph(input);

    const results: Record<string, unknown> = { ...input };
    const concurrency = Math.max(1, Number(process.env.WORKFLOW_CONCURRENCY ?? '4'));
    const limit = createConcurrencyLimiter(concurrency);
    const executions = new Map<string, Promise<void>>();

    const executeNode = (name: string): Promise<void> => {
      const cached = executions.get(name);
      if (cached) {
        return cached;
      }

      const spec = this.nodes.get(name);
      if (!spec) {
        return Promise.reject(new Error(`node "${name}" is not registered`));
      }

      const execution = Promise.all(
        (spec.deps ?? []).map(async (depName) => {
          if (this.nodes.has(depName)) {
            await executeNode(depName);
            return;
          }

          if (!(depName in results)) {
            throw new Error(`node "${name}" depends on missing input "${depName}"`);
          }
        }),
      ).then(() => limit(async () => {
        await this.executeSpec(spec, results, ctx);
      }));

      executions.set(name, execution);
      return execution;
    };

    await Promise.all([...this.nodes.keys()].map((name) => executeNode(name)));
    return results;
  }

  private validateGraph(input: Record<string, unknown>): void {
    for (const [name, spec] of this.nodes) {
      for (const depName of spec.deps ?? []) {
        if (!this.nodes.has(depName) && !(depName in input)) {
          throw new Error(`node "${name}" depends on unknown node "${depName}"`);
        }
      }
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const dfs = (name: string) => {
      if (visited.has(name)) {
        return;
      }

      if (visiting.has(name)) {
        throw new Error(`cycle detected at node "${name}"`);
      }

      visiting.add(name);
      const spec = this.nodes.get(name);
      for (const depName of spec?.deps ?? []) {
        if (this.nodes.has(depName)) {
          dfs(depName);
        }
      }
      visiting.delete(name);
      visited.add(name);
    };

    for (const name of this.nodes.keys()) {
      dfs(name);
    }
  }

  private async executeSpec(
    spec: NodeSpec<TCtx>,
    results: Record<string, unknown>,
    ctx: TCtx,
  ): Promise<void> {
    const startedAt = Date.now();
    const traceInput = this.buildTraceInput(spec, results);
    const retries = Math.max(0, spec.retries ?? 0);
    const retryDelayMs = Math.max(50, spec.retryDelayMs ?? 200);

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= retries) {
      try {
        const output = await spec.handler(results, ctx);
        results[spec.name] = output;
        insertTrace({
          assignmentId: ctx.assignmentId,
          nodeName: spec.name,
          status: 'success',
          durationMs: Date.now() - startedAt,
          input: traceInput,
          output,
        });
        return;
      } catch (error) {
        if (isSkipSignal(error)) {
          results[spec.name] = undefined;
          insertTrace({
            assignmentId: ctx.assignmentId,
            nodeName: spec.name,
            status: 'skipped',
            durationMs: Date.now() - startedAt,
            input: traceInput,
            errorMsg: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        lastError = error;
        if (attempt < retries) {
          await sleep(retryDelayMs * 2 ** attempt);
          attempt += 1;
          continue;
        }
        break;
      }
    }

    if (spec.fallback) {
      try {
        const fallbackOutput = await spec.fallback(lastError, ctx);
        if (isSkipSignal(fallbackOutput)) {
          results[spec.name] = undefined;
          insertTrace({
            assignmentId: ctx.assignmentId,
            nodeName: spec.name,
            status: 'skipped',
            durationMs: Date.now() - startedAt,
            input: traceInput,
            errorMsg: lastError instanceof Error ? lastError.message : String(lastError),
          });
          return;
        }

        results[spec.name] = fallbackOutput;
        insertTrace({
          assignmentId: ctx.assignmentId,
          nodeName: spec.name,
          status: 'success',
          durationMs: Date.now() - startedAt,
          input: traceInput,
          output: fallbackOutput,
          errorMsg: lastError instanceof Error ? lastError.message : String(lastError),
        });
        return;
      } catch (fallbackError) {
        if (isSkipSignal(fallbackError)) {
          results[spec.name] = undefined;
          insertTrace({
            assignmentId: ctx.assignmentId,
            nodeName: spec.name,
            status: 'skipped',
            durationMs: Date.now() - startedAt,
            input: traceInput,
            errorMsg: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          return;
        }

        lastError = fallbackError;
      }
    }

    logger.error(
      {
        assignmentId: ctx.assignmentId,
        node: spec.name,
        err: lastError instanceof Error ? lastError.message : String(lastError),
      },
      'dag node failed',
    );
    insertTrace({
      assignmentId: ctx.assignmentId,
      nodeName: spec.name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      input: traceInput,
      errorMsg: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private buildTraceInput(spec: NodeSpec<TCtx>, results: Record<string, unknown>): Record<string, unknown> {
    const depNames = spec.deps ?? [];
    if (depNames.length === 0) {
      return {};
    }

    const traceInput: Record<string, unknown> = {};
    for (const depName of depNames) {
      traceInput[depName] = results[depName];
    }
    return traceInput;
  }
}
