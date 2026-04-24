import { NextResponse } from 'next/server';
import { getById } from '@/db/dao/tags';
import { errorResponse } from '@app/api/_lib/responses';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tag = getById(id);
  if (!tag) {
    return errorResponse(404, 'NOT_FOUND', 'knowledge tag not found');
  }

  return NextResponse.json({ ok: true, tag });
}
