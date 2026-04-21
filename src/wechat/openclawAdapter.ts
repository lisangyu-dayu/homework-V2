// 与 OpenClaw 插件的通信适配（M7）
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

export async function pushBackTextMessage(openId: string, text: string): Promise<void> {
  const cfg = loadConfig();
  try {
    const resp = await fetch(cfg.openclawPushbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': cfg.openclawWebhookSecret,
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
