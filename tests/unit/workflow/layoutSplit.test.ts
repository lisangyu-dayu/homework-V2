import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-layout-split-'));
const uploadDir = path.join(tempRoot, 'uploads');

const routerMocks = vi.hoisted(() => ({
  pickProvider: vi.fn(),
  pickFallback: vi.fn(),
}));

vi.mock('@/providers/router', () => ({
  pickProvider: routerMocks.pickProvider,
  pickFallback: routerMocks.pickFallback,
}));

function createTestPageSvg(): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
      <rect width="1200" height="1800" fill="#ffffff" />
      <rect x="100" y="120" width="900" height="18" rx="4" fill="#111111" />
      <rect x="140" y="250" width="820" height="14" rx="4" fill="#111111" />
      <rect x="140" y="360" width="780" height="14" rx="4" fill="#111111" />
      <rect x="100" y="980" width="920" height="18" rx="4" fill="#111111" />
      <rect x="140" y="1120" width="760" height="14" rx="4" fill="#111111" />
      <rect x="140" y="1240" width="820" height="14" rx="4" fill="#111111" />
    </svg>
  `;
}

async function createTestPage(): Promise<Buffer> {
  return sharp(Buffer.from(createTestPageSvg())).jpeg({ quality: 92 }).toBuffer();
}

beforeEach(async () => {
  routerMocks.pickProvider.mockReset();
  routerMocks.pickFallback.mockReset();

  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(uploadDir, { recursive: true });

  process.env.OPENCLAW_WEBHOOK_SECRET = 'test-openclaw-secret';
  process.env.OPENCLAW_PUSHBACK_URL = 'https://example.com/pushback';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3100';
  process.env.PARENT_LINK_SIGNING_SECRET = '1234567890abcdef1234567890abcdef';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'pass';
  process.env.SQLITE_PATH = path.join(tempRoot, 'test.db');
  process.env.UPLOAD_DIR = uploadDir;

  const { resetConfigCacheForTest } = await import('@/lib/config');
  resetConfigCacheForTest();
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('layoutSplit', () => {
  it('parses fenced JSON and scales bbox coordinates back to the original image size', async () => {
    const { parseLayoutSplitResponse } = await import('@/workflow/nodes/layoutSplit');

    const result = parseLayoutSplitResponse(
      [
        '```json',
        JSON.stringify({
          majorQuestions: [
            {
              number: '二',
              bbox: { x: 40, y: 210, w: 280, h: 130 },
              subQuestions: [{ number: '(1)', bbox: { x: 60, y: 250, w: 220, h: 60 } }],
            },
            {
              number: '一',
              bbox: { x: -30, y: 10, w: 250, h: 120 },
              subQuestions: [{ number: '(2)', bbox: { x: 45, y: 55, w: 180, h: 55 } }],
            },
          ],
        }),
        '```',
      ].join('\n'),
      400,
      400,
      1200,
      1600,
    );

    expect(result.majorQuestions).toHaveLength(2);
    expect(result.majorQuestions[0]).toMatchObject({
      number: '一',
      bbox: { x: 0, y: 40, w: 750, h: 480 },
    });
    expect(result.majorQuestions[0]?.subQuestions[0]).toMatchObject({
      number: '(2)',
      bbox: { x: 135, y: 220, w: 540, h: 220 },
    });
    expect(result.majorQuestions[1]).toMatchObject({
      number: '二',
      bbox: { x: 120, y: 840, w: 840, h: 520 },
    });
  });

  it('uses provider vision output when available', async () => {
    const { run } = await import('@/workflow/nodes/layoutSplit');
    const processedPath = path.join(uploadDir, 'processed', 'page.jpg');
    mkdirSync(path.dirname(processedPath), { recursive: true });
    writeFileSync(processedPath, await createTestPage());

    const vision = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        majorQuestions: [
          {
            number: '一',
            bbox: { x: 0, y: 0, w: 800, h: 600 },
            subQuestions: [
              { number: '(1)', bbox: { x: 40, y: 120, w: 680, h: 180 } },
              { number: '(2)', bbox: { x: 40, y: 320, w: 680, h: 180 } },
            ],
          },
        ],
      }),
      model: 'sonnet',
      usage: { durationMs: 10 },
    });

    routerMocks.pickProvider.mockReturnValue({
      name: 'claude',
      supportsPromptCache: true,
      supportsVision: true,
      healthCheck: vi.fn(),
      chat: vi.fn(),
      vision,
    });
    routerMocks.pickFallback.mockReturnValue(null);

    const result = await run(
      { preprocess: { processedPath } },
      {
        assignmentId: 'asg_layout_1',
        originalImagePath: processedPath,
        childId: 'child_1',
        subject: 'math',
      },
    );

    expect(vision).toHaveBeenCalledTimes(1);
    expect(vision.mock.calls[0]?.[0]).toMatchObject({
      images: [expect.objectContaining({ mediaType: 'image/jpeg' })],
      messages: [expect.objectContaining({ role: 'user' })],
    });
    expect(result.majorQuestions[0]).toMatchObject({
      number: '一',
      bbox: { x: 0, y: 0, w: 900, h: 675 },
    });
    expect(result.majorQuestions[0]?.subQuestions).toHaveLength(2);
  });

  it('falls back to a full-page bbox when providers fail', async () => {
    const { run } = await import('@/workflow/nodes/layoutSplit');
    const processedPath = path.join(uploadDir, 'processed', 'page.jpg');
    mkdirSync(path.dirname(processedPath), { recursive: true });
    writeFileSync(processedPath, await createTestPage());

    routerMocks.pickProvider.mockReturnValue({
      name: 'claude',
      supportsPromptCache: true,
      supportsVision: true,
      healthCheck: vi.fn(),
      chat: vi.fn(),
      vision: vi.fn().mockRejectedValue(new Error('claude unavailable')),
    });
    routerMocks.pickFallback.mockReturnValue(null);

    const result = await run(
      { preprocess: { processedPath } },
      {
        assignmentId: 'asg_layout_2',
        originalImagePath: processedPath,
        childId: 'child_1',
        subject: 'math',
      },
    );

    expect(result).toEqual({
      majorQuestions: [
        {
          number: '一',
          bbox: { x: 0, y: 0, w: 1200, h: 1800 },
          subQuestions: [{ number: '(1)', bbox: { x: 0, y: 0, w: 1200, h: 1800 } }],
        },
      ],
    });
  });
});
