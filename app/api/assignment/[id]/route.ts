import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // TODO[M8]: 从 DAO 取 assignment（级联大题/小题/标签）
  return NextResponse.json({
    ok: true,
    assignment: { id, status: 'TODO', majorQuestions: [] },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // TODO[M8]: 级联删除 + 图片清理（保留错题本条目）
  void id;
  return NextResponse.json({ ok: true });
}
