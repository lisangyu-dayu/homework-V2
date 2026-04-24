import { buildShortLinkUrl } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

export async function pushBackTextMessage(openId: string, text: string): Promise<void> {
  const cfg = loadConfig();
  try {
    const resp = await fetch(cfg.openclawPushbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenClaw-Secret': cfg.openclawWebhookSecret,
      },
      body: JSON.stringify({ openId, messageType: 'text', text }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'openclaw pushback non-2xx');
    }
  } catch (err) {
    logger.error({ err: String(err) }, 'openclaw pushback failed');
  }
}

export async function pushBackAssignmentDone(params: {
  openId: string;
  shortId: string;
  parentToken: string;
  summary: string;
}): Promise<void> {
  const url = buildShortLinkUrl(params.shortId, params.parentToken);
  const text = `批改完成\n${params.summary}\n查看结果：${url}`;
  await pushBackTextMessage(params.openId, text);
}
