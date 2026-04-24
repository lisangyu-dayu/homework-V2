import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTree } from '@/db/dao/tags';
import { errorResponse } from '@app/api/_lib/responses';

const QuerySchema = z.object({
  subject: z.string().default('math'),
  grade: z.coerce.number().int().min(1).max(9).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    subject: req.nextUrl.searchParams.get('subject') ?? undefined,
    grade: req.nextUrl.searchParams.get('grade') ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(400, 'INVALID_INPUT', 'invalid knowledge tag query');
  }

  const tree = getTree(parsed.data.subject, parsed.data.grade);
  return NextResponse.json({ ok: true, tree });
}
