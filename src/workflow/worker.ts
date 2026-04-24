import { failAssignment, getById } from '@/db/dao/assignments';
import { logger, maskOpenId } from '@/lib/logger';
import { pushBackAssignmentDone, pushBackTextMessage } from '@/wechat/openclawAdapter';
import { runAssignment } from '@/workflow';

export interface AssignmentWorkerPayload {
  assignmentId: string;
  childId: string;
  subject: string;
  originalImagePath: string;
  openId: string;
  parentToken: string;
}

function summarizeAssignment(assignment: NonNullable<ReturnType<typeof getById>>): string {
  return `对 ${assignment.correctCount ?? 0} · 错 ${assignment.wrongCount ?? 0} · 未批改 ${assignment.unmarkedCount ?? 0}`;
}

export async function executeAssignmentWorkerJob(params: AssignmentWorkerPayload): Promise<void> {
  logger.info(
    {
      assignmentId: params.assignmentId,
      childId: params.childId,
      openId: maskOpenId(params.openId),
      subject: params.subject,
    },
    'assignment accepted; starting workflow',
  );

  try {
    const result = await runAssignment({
      assignmentId: params.assignmentId,
      originalImagePath: params.originalImagePath,
      childId: params.childId,
      subject: params.subject,
    });
    const assignment = getById(params.assignmentId);
    if (!assignment) {
      throw new Error(`assignment not found after workflow: ${params.assignmentId}`);
    }
    await pushBackAssignmentDone({
      openId: params.openId,
      shortId: result.shortId,
      parentToken: params.parentToken,
      summary: summarizeAssignment(assignment),
    });
  } catch (error) {
    failAssignment(params.assignmentId);
    await pushBackTextMessage(
      params.openId,
      '作业已收到，但本次处理失败。请稍后重新拍照提交。',
    );
    throw error;
  }
}
