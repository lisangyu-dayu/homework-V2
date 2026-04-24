import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-parse-question-'));
const uploadDir = path.join(tempRoot, 'uploads');

const routerMocks = vi.hoisted(() => ({
  pickProvider: vi.fn(),
  pickFallback: vi.fn(),
}));

vi.mock('@/providers/router', () => ({
  pickProvider: routerMocks.pickProvider,
  pickFallback: routerMocks.pickFallback,
}));

function createQuestionPageSvg(): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
      <rect width="1200" height="1600" fill="#ffffff" />
      <rect x="120" y="120" width="900" height="20" fill="#111111" />
      <rect x="160" y="220" width="760" height="16" fill="#111111" />
      <rect x="160" y="320" width="700" height="16" fill="#111111" />
      <rect x="120" y="860" width="900" height="20" fill="#111111" />
      <rect x="160" y="980" width="740" height="16" fill="#111111" />
      <rect x="160" y="1080" width="780" height="16" fill="#111111" />
    </svg>
  `;
}

async function createQuestionPage(): Promise<Buffer> {
  return sharp(Buffer.from(createQuestionPageSvg())).jpeg({ quality: 92 }).toBuffer();
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

describe('parseQuestion', () => {
  it('parses fenced JSON into ParsedMathQuestion shape', async () => {
    const { parseQuestionResponse } = await import('@/workflow/nodes/parseQuestion');

    const parsed = parseQuestionResponse(
      [
        '```json',
        JSON.stringify({
          subject: 'math',
          questionType: 'multiple-choice',
          stemText: '下列说法正确的是',
          knownConditions: ['题目给出四个选项'],
          goal: '选出正确选项',
          choices: [
            { label: 'A', text: '2 是质数' },
            { label: 'B', text: '4 是奇数' },
          ],
        }),
        '```',
      ].join('\n'),
    );

    expect(parsed).toMatchObject({
      subject: 'math',
      questionType: 'multiple-choice',
      stemText: '下列说法正确的是',
      knownConditions: ['题目给出四个选项'],
      goal: '选出正确选项',
    });
    expect(parsed.choices).toHaveLength(2);
  });

  it('crops each sub-question image and parses provider output', async () => {
    const { run } = await import('@/workflow/nodes/parseQuestion');
    const processedPath = path.join(uploadDir, 'processed', 'page.jpg');
    mkdirSync(path.dirname(processedPath), { recursive: true });
    writeFileSync(processedPath, await createQuestionPage());

    const vision = vi.fn(async (request: { messages: Array<{ content: string }> }) => {
      const prompt = request.messages[0]?.content ?? '';
      if (prompt.includes('(1)')) {
        return {
          text: JSON.stringify({
            subject: 'math',
            questionType: 'computation',
            stemText: '计算 1 + 1',
            knownConditions: [],
            goal: '求结果',
          }),
          model: 'sonnet',
          usage: { durationMs: 10 },
        };
      }

      return {
        text: JSON.stringify({
          subject: 'math',
          questionType: 'solve-equation',
          stemText: '解方程 x + 3 = 5',
          knownConditions: [],
          goal: '求 x',
        }),
        model: 'sonnet',
        usage: { durationMs: 10 },
      };
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
        preprocess: { processedPath },
        layoutSplit: {
          majorQuestions: [
            {
              number: '一',
              bbox: { x: 80, y: 80, w: 980, h: 580 },
              subQuestions: [
                { number: '(1)', bbox: { x: 120, y: 180, w: 820, h: 220 } },
                { number: '(2)', bbox: { x: 120, y: 900, w: 820, h: 220 } },
              ],
            },
          ],
        },
      },
      {
        assignmentId: 'asg_parse_1',
        originalImagePath: processedPath,
        childId: 'child_1',
        subject: 'math',
      },
    );

    expect(result.isPlaceholder).toBeUndefined();
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      subQuestionId: 'asg_parse_1_sq_1_1',
      cropPath: path.join('crops', 'asg_parse_1', 'asg_parse_1_sq_1_1.jpg'),
      parsed: {
        questionType: 'computation',
        stemText: '计算 1 + 1',
      },
    });
    expect(result.items[1]).toMatchObject({
      subQuestionId: 'asg_parse_1_sq_1_2',
      parsed: {
        questionType: 'solve-equation',
        stemText: '解方程 x + 3 = 5',
      },
    });
    expect(vision).toHaveBeenCalledTimes(2);

    const cropMeta = await sharp(path.join(uploadDir, result.items[0]!.cropPath)).metadata();
    expect(existsSync(path.join(uploadDir, result.items[0]!.cropPath))).toBe(true);
    expect(cropMeta.width).toBe(820);
    expect(cropMeta.height).toBe(220);
  });

  it('returns placeholder parsed output when provider parsing fails', async () => {
    const { run } = await import('@/workflow/nodes/parseQuestion');
    const processedPath = path.join(uploadDir, 'processed', 'page.jpg');
    mkdirSync(path.dirname(processedPath), { recursive: true });
    writeFileSync(processedPath, await createQuestionPage());

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
      {
        preprocess: { processedPath },
        layoutSplit: {
          majorQuestions: [
            {
              number: '二',
              bbox: { x: 80, y: 80, w: 980, h: 580 },
              subQuestions: [{ number: '(3)', bbox: { x: 120, y: 900, w: 820, h: 220 } }],
            },
          ],
        },
      },
      {
        assignmentId: 'asg_parse_2',
        originalImagePath: processedPath,
        childId: 'child_1',
        subject: 'math',
      },
    );

    expect(result.isPlaceholder).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.parsed.stemText).toContain('二(3)');
    expect(existsSync(path.join(uploadDir, result.items[0]!.cropPath))).toBe(true);
  });
});
