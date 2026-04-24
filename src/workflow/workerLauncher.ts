import { spawn } from 'node:child_process';
import path from 'node:path';
import { logger, maskOpenId } from '@/lib/logger';
import { type AssignmentWorkerPayload, executeAssignmentWorkerJob } from './worker';

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

export function resolveTsxCliPathForWorker(): string {
  return path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

async function runInProcess(payload: AssignmentWorkerPayload): Promise<void> {
  try {
    await executeAssignmentWorkerJob(payload);
  } catch (error) {
    logger.error(
      {
        assignmentId: payload.assignmentId,
        childId: payload.childId,
        openId: maskOpenId(payload.openId),
        err: error instanceof Error ? error.message : String(error),
      },
      'background assignment workflow failed',
    );
  }
}

export function spawnDetachedAssignmentWorker(payload: AssignmentWorkerPayload): void {
  if (isTestRuntime()) {
    setTimeout(() => {
      void runInProcess(payload);
    }, 0);
    return;
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'run-assignment-worker.ts');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const child = spawn(process.execPath, [resolveTsxCliPathForWorker(), scriptPath, encodedPayload], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });

  child.unref();
}
