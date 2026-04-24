import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createFeedback, type FeedbackType } from '@/db/dao/feedback';
import { getSubQuestionSnapshotForChild } from '@/db/dao/homeworkData';
import { requireChildFromRequest } from '@/lib/auth';
import { AuthError } from '@/lib/errors';
import { authErrorResponse, errorResponse } from '@app/api/_lib/responses';

const FeedbackPayloadSchema = z.object({
  subQuestionId: z.string().min(1),
  feedbackType: z.enum(['grading_wrong', 'confirm_correct', 'manual_verdict']),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: NextRequest) {
  let child;
  try {
    child = requireChildFromRequest(req);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    throw error;
  }

  const body = await req.json().catch(() => ({}));
  const parsed = FeedbackPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_INPUT', 'bad payload');
  }

  const subQuestion = getSubQuestionSnapshotForChild(parsed.data.subQuestionId, child.id);
  if (!subQuestion) {
    return errorResponse(404, 'NOT_FOUND', 'sub question not found');
  }

  const { feedbackId } = createFeedback({
    subQuestionId: subQuestion.id,
    feedbackType: parsed.data.feedbackType as FeedbackType,
    payload: parsed.data.payload,
  });

  return NextResponse.json({ ok: true, feedbackId });
}
