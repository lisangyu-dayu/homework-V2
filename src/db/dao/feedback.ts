import { nanoid } from 'nanoid';
import { getDb } from '../client';

export type FeedbackType = 'grading_wrong' | 'confirm_correct' | 'manual_verdict';

export function createFeedback(input: {
  subQuestionId: string;
  feedbackType: FeedbackType;
  payload: Record<string, unknown>;
}): { feedbackId: string } {
  const db = getDb();
  const feedbackId = `fb_${nanoid(12)}`;
  db.prepare(
    `INSERT INTO feedback (id, sub_question_id, feedback_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    feedbackId,
    input.subQuestionId,
    input.feedbackType,
    JSON.stringify(input.payload),
    Date.now(),
  );
  return { feedbackId };
}
