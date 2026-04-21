// 生成 shortId + 完整 URL（M5）
import { loadConfig } from '@/lib/config';

export interface RenderResult { shortId: string; url: string; }

export async function run(_deps: unknown, _ctx: unknown): Promise<RenderResult> {
  // TODO[M5]: 取 persist 生成的 shortId，拼 PUBLIC_BASE_URL
  const cfg = loadConfig();
  const shortId = 'TODO';
  return { shortId, url: `${cfg.publicBaseUrl}/r/${shortId}` };
}
