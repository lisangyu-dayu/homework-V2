// 微信入口（OpenClaw 插件 → 本服务）
// M7 完成实现；当前仅返回 200 占位
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const WebhookPayloadSchema = z.object({
  openId: z.string().min(1),
  messageType: z.enum(['image', 'text']),
  imageBase64: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.number().int(),
});

export async function POST(req: NextRequest) {
  // TODO[M7]: 校验 X-OpenClaw-Secret
  // TODO[M7]: 解析 + Zod 校验 payload
  // TODO[M7]: 创建 assignment（status=processing），异步触发 workflow
  // TODO[M7]: 立即返回 assignmentId，batch 完成后回推短链
  const _body = await req.json().catch(() => ({}));
  const parsed = WebhookPayloadSchema.safeParse(_body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_INPUT', message: 'bad payload' } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, assignmentId: 'TODO', estimateSeconds: 35 }, { status: 202 });
}
