// GET /api/assignment/:id · 查询单份作业（M8 实现）
// DELETE /api/assignment/:id · 删除作业（保留错题本快照）
//
// 鉴权：middleware 拦截无 cookie 请求；此处二次校验 child.id 归属。
import { NextRequest, NextResponse } from 'next/server';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: 401 });
    }
    throw e;
  }

  // TODO[M8]: 从 DAO 取 assignment；若 assignment.childId !== child.id → 404
  void child;
  return NextResponse.json({
    ok: true,
    assignment: { id, status: 'TODO', majorQuestions: [] },
  });
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
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: 401 });
    }
    throw e;
  }

  // TODO[M8]:
  //   1) 校验 assignment.child_id === child.id（否则 404）
  //   2) 级联删除 major_questions / sub_questions（ON DELETE CASCADE）
  //   3) 删除 uploads/<assignmentId>/ 整目录
  //   4) **错题本条目不受影响**：mistakes 自包含快照，不依赖 sub_questions
  void child;
  void id;
  return NextResponse.json({ ok: true });
}
