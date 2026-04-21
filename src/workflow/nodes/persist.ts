// 持久化：批量写入 major/sub/tags + 更新 assignment 统计（M5）
export interface PersistResult { assignmentId: string; }

export async function run(_deps: unknown, _ctx: unknown): Promise<PersistResult> {
  // TODO[M5]: 事务：
  //  1. 写 major_questions
  //  2. 写 sub_questions（含 parsed/steps/answer/verdict/explanation）
  //  3. 写 sub_question_tags
  //  4. 写 auto mistakes（verdict=wrong 自动加入错题本）
  //  5. completeAssignment(stats)
  return { assignmentId: 'TODO' };
}
