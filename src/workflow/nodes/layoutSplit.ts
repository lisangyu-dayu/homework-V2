// 版面切题：大题/小题 bbox 识别（M5）
import type { BBox } from '@/mcp/imageCrop';

export interface LayoutSplitResult {
  majorQuestions: Array<{
    number: string;
    bbox: BBox;
    subQuestions: Array<{ number: string; bbox: BBox }>;
  }>;
}

export async function run(_deps: unknown, _ctx: unknown): Promise<LayoutSplitResult> {
  // TODO[M5]: pickProvider({task:'layoutSplit'}).vision(...) → Zod parse
  return { majorQuestions: [] };
}
