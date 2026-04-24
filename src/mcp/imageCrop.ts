import sharp from 'sharp';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const ANALYSIS_MAX_EDGE = 1200;
const DESKEW_MAX_ABS_DEG = 5;
const DESKEW_STEP_DEG = 0.5;
const MIN_DESKEW_ANGLE_DEG = 0.3;
const MIN_DESKEW_SCORE_RATIO = 1.03;
const MIN_DARKNESS = 24;

function calcProjectionScore(data: Buffer, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;

  const rows = new Float64Array(height);
  let totalDarkness = 0;

  for (let y = 0; y < height; y += 1) {
    let rowDarkness = 0;
    const offset = y * width;
    for (let x = 0; x < width; x += 1) {
      const darkness = 255 - data[offset + x]!;
      if (darkness > MIN_DARKNESS) {
        rowDarkness += darkness - MIN_DARKNESS;
      }
    }
    rows[y] = rowDarkness;
    totalDarkness += rowDarkness;
  }

  if (totalDarkness === 0) return 0;

  const mean = totalDarkness / height;
  let variance = 0;
  for (const value of rows) {
    const diff = value - mean;
    variance += diff * diff;
  }
  return variance / height;
}

async function toGreyscaleMatrix(
  imageBuffer: Buffer,
  angle = 0,
): Promise<{ data: Buffer; width: number; height: number }> {
  const rotated = angle === 0
    ? imageBuffer
    : await sharp(imageBuffer).rotate(angle, { background: WHITE }).png().toBuffer();
  const { data, info } = await sharp(rotated)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

export async function crop(imageBuffer: Buffer, bbox: BBox): Promise<Buffer> {
  return sharp(imageBuffer)
    .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
    .toBuffer();
}

export async function estimateDeskewAngle(imageBuffer: Buffer): Promise<number> {
  const baseImage = await sharp(imageBuffer)
    .rotate()
    .resize({
      width: ANALYSIS_MAX_EDGE,
      height: ANALYSIS_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: WHITE })
    .normalize()
    .png()
    .toBuffer();

  const baseMatrix = await toGreyscaleMatrix(baseImage);
  const baselineScore = calcProjectionScore(baseMatrix.data, baseMatrix.width, baseMatrix.height);

  let bestAngle = 0;
  let bestScore = baselineScore;

  for (let angle = -DESKEW_MAX_ABS_DEG; angle <= DESKEW_MAX_ABS_DEG; angle += DESKEW_STEP_DEG) {
    if (Math.abs(angle) < Number.EPSILON) continue;
    const matrix = await toGreyscaleMatrix(baseImage, angle);
    const score = calcProjectionScore(matrix.data, matrix.width, matrix.height);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  if (Math.abs(bestAngle) < MIN_DESKEW_ANGLE_DEG) return 0;
  if (baselineScore > 0 && bestScore / baselineScore < MIN_DESKEW_SCORE_RATIO) return 0;
  return bestAngle;
}

export async function preprocess(imageBuffer: Buffer): Promise<Buffer> {
  const oriented = await sharp(imageBuffer)
    .rotate()
    .flatten({ background: WHITE })
    .png()
    .toBuffer();

  const deskewAngle = await estimateDeskewAngle(oriented);
  let pipeline = sharp(oriented);
  if (Math.abs(deskewAngle) >= MIN_DESKEW_ANGLE_DEG) {
    pipeline = pipeline.rotate(deskewAngle, { background: WHITE });
  }

  const contrastAlpha = 1.12;
  const contrastBias = 128 * (1 - contrastAlpha);

  return pipeline
    .flatten({ background: WHITE })
    .normalize()
    .linear(contrastAlpha, contrastBias)
    .sharpen({ sigma: 1.1, m1: 0.8, m2: 2 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

export async function resizeForVision(imageBuffer: Buffer, maxEdge = 1600): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}
