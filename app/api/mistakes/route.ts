// GET /api/mistakes · 错题本列表（M8 实现）
// POST /api/mistakes · 加入错题本（M8 实现）
//
// childId 由 cookie 推导，不接受 query/body 传入。
// middleware.ts 已拦截无 cookie 请求；本处再做 token → child 解析。
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';

export async function GET(req: NextRequest) {
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: 401 });
    }
    throw e;
  }

  const { searchParams } = new URL(req.url);
  // TODO[M8]: 解析 tags / from / to / resolved / limit / cursor
  // TODO[M8]: 调用 mistakes DAO（作用域 child.id）
  void child;
  void searchParams;

  return NextResponse.json({
    ok: true,
    items: [],
    nextCursor: null,
    summary: { total: 0, byTag: [] },
  });
}

const AddMistakeSchema = z.object({
  subQuestionId: z.string().min(1),
  source: z.enum(['auto', 'manual']).default('manual'),
});

export async function POST(req: NextRequest) {
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: 401 });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const parsed = AddMistakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_INPUT', message: 'bad payload' } },
      { status: 400 },
    );
  }

  // TODO[M8]:
  //   1) 从 sub_questions 读 subQuestionId，校验其 assignment.child_id === child.id
  //   2) 调 addMistake(...) 写快照 + 复制图
  void child;

  return NextResponse.json({ ok: true, mistakeId: 'TODO' });
}
