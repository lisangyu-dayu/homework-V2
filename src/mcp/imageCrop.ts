// 图像裁剪/压缩工具（Sharp）
// M5 完成实现
import sharp from 'sharp';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function crop(imageBuffer: Buffer, bbox: BBox): Promise<Buffer> {
  return sharp(imageBuffer)
    .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
    .toBuffer();
}

export async function preprocess(imageBuffer: Buffer): Promise<Buffer> {
  // TODO[M5]: deskew / 对比度增强 / 灰度
  return sharp(imageBuffer)
    .rotate()              // 按 EXIF 旋转
    .normalize()           // 对比度
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function resizeForVision(imageBuffer: Buffer, maxEdge = 1600): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}
