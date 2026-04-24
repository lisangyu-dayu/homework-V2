import { NextRequest, NextResponse } from 'next/server';
import { deleteAssignmentCascade, getAssignmentDetailByIdForChild } from '@/db/dao/homeworkData';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';
import { authErrorResponse, errorResponse } from '@app/api/_lib/responses';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }

  const assignment = getAssignmentDetailByIdForChild(id, child.id);
  if (!assignment) {
    return errorResponse(404, 'NOT_FOUND', 'assignment not found');
  }

  return NextResponse.json({ ok: true, assignment });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }

  const assignment = getAssignmentDetailByIdForChild(id, child.id);
  if (!assignment) {
    return errorResponse(404, 'NOT_FOUND', 'assignment not found');
  }

  await deleteAssignmentCascade(id);
  return NextResponse.json({ ok: true });
}
