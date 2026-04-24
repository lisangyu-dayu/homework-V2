'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { findByParentToken } from '@/db/dao/children';
import { createFeedback } from '@/db/dao/feedback';
import { getSubQuestionSnapshotForChild } from '@/db/dao/homeworkData';
import { addMistake } from '@/db/dao/mistakes';
import { getParentCookieName } from '@/lib/config';

async function requireActionChild() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getParentCookieName())?.value;
  const child = token ? findByParentToken(token) : null;
  if (!child) throw new Error('authentication required');
  return child;
}

function readRequiredField(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`missing field: ${key}`);
  }
  return value.trim();
}

export async function addMistakeFromResultAction(formData: FormData) {
  const child = await requireActionChild();
  const subQuestionId = readRequiredField(formData, 'subQuestionId');
  const shortId = readRequiredField(formData, 'shortId');
  const subQuestion = getSubQuestionSnapshotForChild(subQuestionId, child.id);
  if (!subQuestion) throw new Error('sub question not found');

  await addMistake({
    childId: child.id,
    subQuestion,
    source: 'manual',
  });

  revalidatePath(`/r/${encodeURIComponent(shortId)}`);
  revalidatePath('/mistakes');
}

export async function reportAssignmentFeedbackAction(formData: FormData) {
  const child = await requireActionChild();
  const subQuestionId = readRequiredField(formData, 'subQuestionId');
  const shortId = readRequiredField(formData, 'shortId');
  const subQuestion = getSubQuestionSnapshotForChild(subQuestionId, child.id);
  if (!subQuestion) throw new Error('sub question not found');

  createFeedback({
    subQuestionId,
    feedbackType: 'grading_wrong',
    payload: {
      source: 'result-page',
      currentVerdict: subQuestion.verdict,
      currentStudentAnswer: subQuestion.studentAnswer,
      currentFinalAnswer: subQuestion.finalAnswer,
      currentErrorType: subQuestion.errorType,
    },
  });

  revalidatePath(`/r/${encodeURIComponent(shortId)}`);
}
