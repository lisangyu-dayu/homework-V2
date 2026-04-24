import fs from 'node:fs/promises';
import path from 'node:path';
import { preprocess as sharpPreprocess } from '@/mcp/imageCrop';
import { loadConfig } from '@/lib/config';
import type { AssignmentCtx } from '../index';

export async function run(_deps: unknown, ctx: AssignmentCtx): Promise<{ processedPath: string }> {
  const cfg = loadConfig();
  const originalPath = path.isAbsolute(ctx.originalImagePath)
    ? ctx.originalImagePath
    : path.join(cfg.uploadDir, ctx.originalImagePath);
  const raw = await fs.readFile(originalPath);
  const outPath = `${originalPath}.processed.jpg`;
  const processed = await sharpPreprocess(raw).catch(() => raw);
  await fs.writeFile(outPath, processed);
  return { processedPath: outPath };
}
