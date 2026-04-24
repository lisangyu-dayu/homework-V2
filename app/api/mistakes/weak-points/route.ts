import { NextRequest, NextResponse } from 'next/server';
import { weakPoints } from '@/db/dao/mistakes';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';
import { authErrorResponse, errorResponse } from '@app/api/_lib/responses';

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 5;

function parseOptionalInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const daysRaw = searchParams.get('days');
  const limitRaw = searchParams.get('limit');
  const parsedDays = parseOptionalInteger(daysRaw);
  const parsedLimit = parseOptionalInteger(limitRaw);

  if (daysRaw && typeof parsedDays !== 'number') {
    return errorResponse(400, 'INVALID_INPUT', 'days must be an integer');
  }
  if (limitRaw && typeof parsedLimit !== 'number') {
    return errorResponse(400, 'INVALID_INPUT', 'limit must be an integer');
  }
  const days = parsedDays ?? DEFAULT_DAYS;
  const limit = parsedLimit ?? DEFAULT_LIMIT;
  if (days <= 0) {
    return errorResponse(400, 'INVALID_INPUT', 'days must be greater than 0');
  }
  if (limit <= 0 || limit > 100) {
    return errorResponse(400, 'INVALID_INPUT', 'limit must be between 1 and 100');
  }

  const result = weakPoints(child.id, { days, limit });

  return NextResponse.json({
    ok: true,
    windowDays: days,
    totalMistakes: result.totalMistakes,
    items: result.items.map((item) => ({
      tagId: item.tagId,
      name: item.tagName,
      mistakeCount: item.mistakeCount,
      share: item.share,
    })),
  });
}
