import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { removeMistake, setResolvedForChild } from '@/db/dao/mistakes';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';
import { authErrorResponse, errorResponse } from '@app/api/_lib/responses';

const PatchMistakeSchema = z.object({
  resolved: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ mistakeId: string }> },
) {
  const { mistakeId } = await params;
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchMistakeSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_INPUT', 'bad payload');
  }

  const updated = setResolvedForChild(mistakeId, child.id, parsed.data.resolved);
  if (!updated) {
    return errorResponse(404, 'NOT_FOUND', 'mistake not found');
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ mistakeId: string }> },
) {
  const { mistakeId } = await params;
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }

  const removed = await removeMistake(mistakeId, child.id);
  if (!removed) {
    return errorResponse(404, 'NOT_FOUND', 'mistake not found');
  }

  return NextResponse.json({ ok: true });
}
