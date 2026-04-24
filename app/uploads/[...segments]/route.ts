import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getById as getAssignmentById } from '@/db/dao/assignments';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';
import { loadConfig } from '@/lib/config';
import { authErrorResponse, errorResponse } from '@app/api/_lib/responses';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function normalizeSegments(segments: string[]): string[] | null {
  if (segments.length === 0) {
    return null;
  }

  const normalized = segments.map((segment) => segment.trim()).filter(Boolean);
  if (normalized.length !== segments.length) {
    return null;
  }
  if (normalized.some((segment) => segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('/'))) {
    return null;
  }

  return normalized;
}

function toContentType(filePath: string): string {
  return CONTENT_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function isAllowedForChild(segments: string[], childId: string): boolean {
  const [root, scope] = segments;
  if (root === 'mistakes') {
    return scope === childId;
  }

  if (root === 'crops' && scope) {
    const assignment = getAssignmentById(scope);
    return assignment?.childId === childId;
  }

  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> },
) {
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    throw error;
  }

  const { segments } = await params;
  const normalizedSegments = normalizeSegments(segments);
  if (!normalizedSegments) {
    return errorResponse(400, 'INVALID_INPUT', 'invalid upload path');
  }

  if (!isAllowedForChild(normalizedSegments, child.id)) {
    return errorResponse(404, 'NOT_FOUND', 'upload not found');
  }

  const cfg = loadConfig();
  const filePath = path.join(cfg.uploadDir, ...normalizedSegments);

  let content: Buffer;
  try {
    content = await fs.readFile(filePath);
  } catch {
    return errorResponse(404, 'NOT_FOUND', 'upload not found');
  }

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      'Content-Type': toContentType(filePath),
      'Cache-Control': 'private, max-age=300',
    },
  });
}
