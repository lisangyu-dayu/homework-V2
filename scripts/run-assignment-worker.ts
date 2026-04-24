import { closeDb } from '../src/db/client';
import { executeAssignmentWorkerJob, type AssignmentWorkerPayload } from '../src/workflow/worker';
import { logger } from '../src/lib/logger';

function readPayloadArg(): AssignmentWorkerPayload {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error('missing assignment worker payload');
  }

  const raw = Buffer.from(encoded, 'base64url').toString('utf8');
  return JSON.parse(raw) as AssignmentWorkerPayload;
}

async function main(): Promise<void> {
  try {
    const payload = readPayloadArg();
    await executeAssignmentWorkerJob(payload);
  } finally {
    closeDb();
  }
}

void main().catch((error) => {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, 'assignment worker process failed');
  process.exitCode = 1;
});
