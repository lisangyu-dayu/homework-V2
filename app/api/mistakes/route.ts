import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addMistake } from '@/db/dao/mistakes';
import { getSubQuestionSnapshotForChild, listMistakesForChild } from '@/db/dao/homeworkData';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';
import { authErrorResponse, errorResponse } from '@app/api/_lib/responses';

const AddMistakeSchema = z.object({
  subQuestionId: z.string().min(1),
  source: z.enum(['auto', 'manual']).default('manual'),
});

function parseOptionalInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCursor(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function GET(req: NextRequest) {
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const limit = parseOptionalInteger(searchParams.get('limit')) ?? 50;
  const from = parseOptionalInteger(searchParams.get('from'));
  const to = parseOptionalInteger(searchParams.get('to'));
  const cursor = parseCursor(searchParams.get('cursor'));
  const resolvedRaw = searchParams.get('resolved');
  const resolved =
    resolvedRaw === '0' ? false : resolvedRaw === '1' ? true : undefined;
  const tags = (searchParams.get('tags') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (limit <= 0 || limit > 100) {
    return errorResponse(400, 'INVALID_INPUT', 'limit must be between 1 and 100');
  }
  if (searchParams.get('from') && typeof from !== 'number') {
    return errorResponse(400, 'INVALID_INPUT', 'from must be an integer timestamp');
  }
  if (searchParams.get('to') && typeof to !== 'number') {
    return errorResponse(400, 'INVALID_INPUT', 'to must be an integer timestamp');
  }
  if (searchParams.get('cursor') && !cursor) {
    return errorResponse(400, 'INVALID_INPUT', 'cursor must be a non-empty string');
  }
  if (resolvedRaw && !['0', '1'].includes(resolvedRaw)) {
    return errorResponse(400, 'INVALID_INPUT', 'resolved must be 0 or 1');
  }

  const result = listMistakesForChild({
    childId: child.id,
    tagIds: tags,
    from,
    to,
    resolved,
    limit,
    cursor,
  });

  return NextResponse.json({
    ok: true,
    items: result.items,
    nextCursor: result.nextCursor,
    summary: result.summary,
  });
}

export async function POST(req: NextRequest) {
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const parsed = AddMistakeSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_INPUT', 'bad payload');
  }

  const subQuestion = getSubQuestionSnapshotForChild(parsed.data.subQuestionId, child.id);
  if (!subQuestion) {
    return errorResponse(404, 'NOT_FOUND', 'sub question not found');
  }

  const { mistakeId } = await addMistake({
    childId: child.id,
    subQuestion,
    source: parsed.data.source,
  });

  return NextResponse.json({ ok: true, mistakeId });
}
