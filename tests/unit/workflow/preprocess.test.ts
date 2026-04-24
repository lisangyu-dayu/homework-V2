import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'homework-v2-preprocess-'));
const uploadDir = path.join(tempRoot, 'uploads');

function createWorksheetSvg({
  background,
  lineColor,
}: {
  background: string;
  lineColor: string;
}): string {
  const lines = Array.from({ length: 8 }, (_, index) => {
    const y = 90 + index * 65;
    const width = index % 2 === 0 ? 720 : 620;
    return `<rect x="120" y="${y}" width="${width}" height="12" rx="3" fill="${lineColor}" />`;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700">
      <rect width="1000" height="700" fill="${background}" />
      <rect x="80" y="60" width="8" height="560" fill="${lineColor}" opacity="0.4" />
      ${lines}
    </svg>
  `;
}

async function createWorksheetImage({
  background = '#ffffff',
  lineColor = '#111111',
  rotation = 0,
}: {
  background?: string;
  lineColor?: string;
  rotation?: number;
} = {}): Promise<Buffer> {
  const base = await sharp(Buffer.from(createWorksheetSvg({ background, lineColor }))).png().toBuffer();
  if (rotation === 0) return base;
  return sharp(base)
    .rotate(rotation, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
}

async function getGreyscaleStdev(imageBuffer: Buffer): Promise<number> {
  const stats = await sharp(imageBuffer).greyscale().stats();
  return stats.channels[0]?.stdev ?? 0;
}

beforeEach(async () => {
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

describe('image preprocess', () => {
  it('deskews worksheet-like images before jpeg output', async () => {
    const { estimateDeskewAngle, preprocess } = await import('@/mcp/imageCrop');
    const skewed = await createWorksheetImage({ rotation: 3 });

    const estimatedBefore = await estimateDeskewAngle(skewed);
    const processed = await preprocess(skewed);
    const estimatedAfter = await estimateDeskewAngle(processed);
    const metadata = await sharp(processed).metadata();

    expect(Math.abs(estimatedBefore)).toBeGreaterThan(1.5);
    expect(Math.abs(estimatedAfter)).toBeLessThan(0.75);
    expect(metadata.format).toBe('jpeg');
  });

  it('boosts contrast for low-contrast source images', async () => {
    const { preprocess } = await import('@/mcp/imageCrop');
    const lowContrast = await createWorksheetImage({
      background: '#dddddd',
      lineColor: '#c3c3c3',
    });

    const before = await getGreyscaleStdev(lowContrast);
    const processed = await preprocess(lowContrast);
    const after = await getGreyscaleStdev(processed);

    expect(after).toBeGreaterThan(before * 1.4);
  });

  it('writes processed images beside the original upload path', async () => {
    const { run } = await import('@/workflow/nodes/preprocess');
    const inputPath = path.join('incoming', 'assignment-1.png');
    const absoluteInputPath = path.join(uploadDir, inputPath);
    mkdirSync(path.dirname(absoluteInputPath), { recursive: true });
    writeFileSync(absoluteInputPath, await createWorksheetImage({ rotation: 2 }));

    const result = await run({}, {
      assignmentId: 'asg_preprocess',
      originalImagePath: inputPath,
      childId: 'child_1',
      subject: 'math',
    });

    expect(result.processedPath).toBe(`${absoluteInputPath}.processed.jpg`);
    expect(existsSync(result.processedPath)).toBe(true);
    expect((await sharp(result.processedPath).metadata()).format).toBe('jpeg');
  });
});
