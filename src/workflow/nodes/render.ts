import { getById } from '@/db/dao/assignments';
import { loadConfig } from '@/lib/config';
import type { AssignmentCtx } from '../index';

export interface RenderResult {
  shortId: string;
  url: string;
}

export async function run(_deps: unknown, ctx: AssignmentCtx): Promise<RenderResult> {
  const cfg = loadConfig();
  const assignment = getById(ctx.assignmentId);
  if (!assignment) {
    throw new Error(`assignment not found: ${ctx.assignmentId}`);
  }
  const shortId = assignment.shortId;
  return { shortId, url: `${cfg.publicBaseUrl}/r/${shortId}` };
}
