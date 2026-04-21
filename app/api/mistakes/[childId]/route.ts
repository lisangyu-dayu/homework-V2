import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ childId: string }> },
) {
  const { childId } = await params;
  const { searchParams } = new URL(req.url);
  // TODO[M8]: 解析 tags / from / to / resolved / limit / cursor
  // TODO[M8]: 调用 mistakes DAO
  void childId;
  void searchParams;
  return NextResponse.json({
    ok: true,
    items: [],
    nextCursor: null,
    summary: { total: 0, byTag: [] },
  });
}
