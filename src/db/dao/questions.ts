// major_questions / sub_questions DAO（M1 完成实现）
import type { ParsedMathQuestion, SolutionStep, Verdict } from '@/lib/types';

export interface SubQuestionInput {
  id: string;
  majorId: string;
  number: string;
  orderIndex: number;
  cropPath: string;
  parsedStem: ParsedMathQuestion;
  solutionSteps: SolutionStep[];
  finalAnswer: string;
  confidence: number;
  verdict: Verdict;
  studentAnswer: string | null;
  errorType?: string | null;
  explanationMd: string;
  knowledgeTagIds: Array<{ id: string; confidence: number }>;
}

export function insertMajorQuestion(_input: {
  id: string; assignmentId: string; number: string; orderIndex: number; stem?: string;
}): void {
  // TODO[M1]
}

export function bulkInsertSubQuestions(_items: SubQuestionInput[]): void {
  // TODO[M1]: 事务 + prepared statements
}

export function getByAssignment(_assignmentId: string): unknown {
  // TODO[M1]: 级联返回大题→小题→标签
  return null;
}
