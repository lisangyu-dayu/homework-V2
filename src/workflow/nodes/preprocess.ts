// 图像预处理（M5）
import fs from 'node:fs/promises';
import { preprocess as sharpPreprocess } from '@/mcp/imageCrop';
import type { AssignmentCtx } from '../index';

export async function run(_deps: unknown, ctx: AssignmentCtx): Promise<{ processedPath: string }> {
  const raw = await fs.readFile(ctx.originalImagePath);
  const processed = await sharpPreprocess(raw);
  const outPath = `${ctx.originalImagePath}.processed.jpg`;
  await fs.writeFile(outPath, processed);
  return { processedPath: outPath };
}
