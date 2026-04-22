// 与 OpenClaw 插件的通信适配（M7）
//
// 与入站一致使用 X-OpenClaw-Secret（同一 shared secret）。
// 消息文本中的短链通过 auth.buildShortLinkUrl 生成，承载签名 + parent_token。
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { buildShortLinkUrl } from '@/lib/auth';

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

/**
 * 批改完成时的回推：文本 = 提示语 + 签名短链
 */
export async function pushBackAssignmentDone(params: {
  openId: string;
  shortId: string;
  parentToken: string;
  summary: string;            // 如 "对 18 · 错 3 · 未批改 2"
}): Promise<void> {
  const url = buildShortLinkUrl(params.shortId, params.parentToken);
  const text = `批改完成\n${params.summary}\n查看结果：${url}`;
  await pushBackTextMessage(params.openId, text);
}
