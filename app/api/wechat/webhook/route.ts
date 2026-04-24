import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { findOrCreateByOpenId } from '@/db/dao/children';
import { createAssignment } from '@/db/dao/assignments';
import { loadConfig } from '@/lib/config';
import { ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { pushBackTextMessage } from '@/wechat/openclawAdapter';
import { spawnDetachedAssignmentWorker } from '@/workflow/workerLauncher';
import { errorResponse } from '@app/api/_lib/responses';

const WebhookPayloadSchema = z
  .object({
    openId: z.string().min(1),
    messageType: z.enum(['image', 'text']),
    imageBase64: z.string().optional(),
    text: z.string().optional(),
    timestamp: z.number().int(),
  })
  .superRefine((payload, ctx) => {
    if (payload.messageType === 'image' && !payload.imageBase64) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'imageBase64 is required for image webhook',
        path: ['imageBase64'],
      });
    }
    if (payload.messageType === 'text' && !payload.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text is required for text webhook',
        path: ['text'],
      });
    }
  });

const ESTIMATE_SECONDS = 35;
const MAX_WEBHOOK_IMAGE_BYTES = 20 * 1024 * 1024;
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function hasValidSecret(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function detectImageExtension(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function decodeBase64Image(raw: string): { buffer: Buffer; extension: 'jpg' | 'png' | 'webp' } {
  const normalized = raw.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!normalized) {
    throw new ValidationError('image payload is empty');
  }
  if (normalized.length % 4 !== 0 || !BASE64_BODY_RE.test(normalized)) {
    throw new ValidationError('image payload is not valid base64');
  }

  const buf = Buffer.from(normalized, 'base64');
  if (buf.length === 0) {
    throw new ValidationError('image payload is empty');
  }
  if (buf.length > MAX_WEBHOOK_IMAGE_BYTES) {
    throw new ValidationError('image payload exceeds 20MB limit');
  }

  const extension = detectImageExtension(buf);
  if (!extension) {
    throw new ValidationError('image payload must be jpeg/png/webp');
  }

  return { buffer: buf, extension };
}

async function persistIncomingImage(base64: string): Promise<string> {
  const { buffer, extension } = decodeBase64Image(base64);

  const cfg = loadConfig();
  const filename = `wechat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`;
  const relativePath = path.join('incoming', filename);
  const absolutePath = path.join(cfg.uploadDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return relativePath;
}

export async function POST(req: NextRequest) {
  const cfg = loadConfig();
  if (!hasValidSecret(req.headers.get('X-OpenClaw-Secret'), cfg.openclawWebhookSecret)) {
    return errorResponse(401, 'AUTH_REQUIRED', 'invalid webhook secret');
  }

  const body = await req.json().catch(() => ({}));
  const parsed = WebhookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_INPUT', 'bad payload');
  }
  if (parsed.data.messageType !== 'image') {
    return errorResponse(400, 'INVALID_INPUT', 'text webhook is not supported yet');
  }

  let originalImagePath: string | null = null;
  let assignmentId: string | null = null;
  try {
    originalImagePath = await persistIncomingImage(parsed.data.imageBase64!);
    const child = findOrCreateByOpenId(parsed.data.openId);
    const subject = (cfg.enabledSubjects[0] as 'math' | undefined) ?? 'math';
    const assignment = createAssignment({
      childId: child.id,
      subject,
      originalImagePath,
    });
    assignmentId = assignment.id;

    spawnDetachedAssignmentWorker({
      assignmentId: assignment.id,
      childId: child.id,
      subject,
      originalImagePath,
      openId: parsed.data.openId,
      parentToken: child.parentToken,
    });
    await pushBackTextMessage(
      parsed.data.openId,
      `作业已收到，正在批改中，预计约 ${ESTIMATE_SECONDS} 秒完成。`,
    );

    return NextResponse.json(
      { ok: true, assignmentId: assignment.id, estimateSeconds: ESTIMATE_SECONDS },
      { status: 202 },
    );
  } catch (error) {
    if (originalImagePath && !assignmentId) {
      await fs.rm(path.join(cfg.uploadDir, originalImagePath), { force: true }).catch(() => undefined);
    }
    if (error instanceof ValidationError) {
      return errorResponse(400, error.code, error.message);
    }
    logger.error({ err: String(error), assignmentId }, 'wechat webhook failed');
    return errorResponse(500, 'INTERNAL', 'failed to accept webhook');
  }
}
