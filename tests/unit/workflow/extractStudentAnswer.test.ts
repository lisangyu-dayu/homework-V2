import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-extract-answer-'));
const uploadDir = path.join(tempRoot, 'uploads');

const routerMocks = vi.hoisted(() => ({
  pickProvider: vi.fn(),
  pickFallback: vi.fn(),
}));

vi.mock('@/providers/router', () => ({
  pickProvider: routerMocks.pickProvider,
  pickFallback: routerMocks.pickFallback,
}));

async function createCrop(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 220,
      channels: 3,
      background: '#ffffff',
    },
  }).jpeg().toBuffer();
}

beforeEach(async () => {
  routerMocks.pickProvider.mockReset();
  routerMocks.pickFallback.mockReset();

  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(path.join(uploadDir, 'crops', 'as_1'), { recursive: true });
  writeFileSync(path.join(uploadDir, 'crops', 'as_1', 'sq_1.jpg'), await createCrop());

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

describe('extractStudentAnswer', () => {
  it('parses unclear and low-confidence answers as null', async () => {
    const { parseStudentAnswerResponse } = await import('@/workflow/nodes/extractStudentAnswer');

    expect(parseStudentAnswerResponse('{"answer":"unclear","confidence":0.8}')).toEqual({
      studentAnswer: null,
      confidence: 0.8,
    });
    expect(parseStudentAnswerResponse('{"answer":"x = 2","confidence":0.2}')).toEqual({
      studentAnswer: null,
      confidence: 0.2,
    });
  });

  it('uses provider vision output for each parsed crop', async () => {
    const { run } = await import('@/workflow/nodes/extractStudentAnswer');
    const vision = vi.fn().mockResolvedValue({
      text: JSON.stringify({ answer: 'x = 2', confidence: 0.92 }),
      model: 'sonnet',
      usage: { durationMs: 5 },
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
      {
        parseQuestion: {
          items: [{
            subQuestionId: 'sq_1',
            cropPath: path.join('crops', 'as_1', 'sq_1.jpg'),
            parsed: {
              subject: 'math',
              questionType: 'solve-equation',
              stemText: 'x + 3 = 5',
              knownConditions: [],
              goal: '求 x',
            },
          }],
        },
      },
      {
        assignmentId: 'as_1',
        originalImagePath: 'incoming/a.jpg',
        childId: 'ch_1',
        subject: 'math',
      },
    );

    expect(vision).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([{ subQuestionId: 'sq_1', studentAnswer: 'x = 2', confidence: 0.92 }]);
  });
});
