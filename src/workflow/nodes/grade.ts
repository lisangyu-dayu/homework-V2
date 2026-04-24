import type { GradingResult } from '@/lib/types';
import * as sympy from '@/mcp/sympy';
import type { ExtractResult } from './extractStudentAnswer';
import type { ParseQuestionResult } from './parseQuestion';
import type { SelfSolveResult } from './selfSolve';
import type { VerifyResult } from './verify';

export interface GradeResult {
  items: Array<{ subQuestionId: string; grading: GradingResult }>;
}

interface GradeDeps {
  extractStudentAnswer?: ExtractResult;
  parseQuestion?: ParseQuestionResult;
  selfSolve?: SelfSolveResult;
  verify?: VerifyResult;
}

type AnswerComparison = 'equivalent' | 'different' | 'unknown';

function normalizeAnswer(value: string | null | undefined): string {
  return value
    ?.trim()
    .replace(/\s+/g, '')
    .replace(/[。．.]+$/u, '')
    .toLowerCase() ?? '';
}

function isNonTargetQuestion(item?: ParseQuestionResult['items'][number]): boolean {
  return item?.parsed.questionType === 'geometry-proof';
}

function requiresVerifiedReference(item?: ParseQuestionResult['items'][number]): boolean {
  return item?.parsed.questionType !== 'multiple-choice';
}

async function compareAnswers(studentAnswer: string, finalAnswer: string): Promise<AnswerComparison> {
  const normalizedStudent = normalizeAnswer(studentAnswer);
  const normalizedFinal = normalizeAnswer(finalAnswer);
  if (!normalizedStudent || !normalizedFinal) return 'unknown';
  if (normalizedStudent === normalizedFinal) return 'equivalent';

  try {
    const verdict = await sympy.equivalent(studentAnswer, finalAnswer);
    return verdict.equivalent ? 'equivalent' : 'different';
  } catch {
    return 'unknown';
  }
}

async function gradeOne(
  item: ExtractResult['items'][number],
  deps: GradeDeps,
): Promise<GradeResult['items'][number]> {
  const parsed = deps.parseQuestion?.items.find((candidate) => candidate.subQuestionId === item.subQuestionId);
  const solution = deps.selfSolve?.items.find((candidate) => candidate.subQuestionId === item.subQuestionId)?.solution;
  const verification = deps.verify?.items.find((candidate) => candidate.subQuestionId === item.subQuestionId);

  if (isNonTargetQuestion(parsed)) {
    return {
      subQuestionId: item.subQuestionId,
      grading: {
        verdict: 'unmarked',
        studentAnswer: item.studentAnswer,
        comment: 'Geometry proof questions are kept unmarked in V1.',
      },
    };
  }

  if (!item.studentAnswer || item.confidence < 0.45) {
    return {
      subQuestionId: item.subQuestionId,
      grading: {
        verdict: 'unmarked',
        studentAnswer: null,
        comment: 'Student answer is unclear or missing.',
      },
    };
  }

  if (!solution || (requiresVerifiedReference(parsed) && verification?.consistent !== true)) {
    return {
      subQuestionId: item.subQuestionId,
      grading: {
        verdict: 'unmarked',
        studentAnswer: item.studentAnswer,
        comment: 'Reference solution is not reliable enough for automatic grading.',
      },
    };
  }

  const comparison = await compareAnswers(item.studentAnswer, solution.finalAnswer);
  if (comparison === 'unknown') {
    return {
      subQuestionId: item.subQuestionId,
      grading: {
        verdict: 'unmarked',
        studentAnswer: item.studentAnswer,
        comment: 'Student answer could not be compared reliably.',
      },
    };
  }

  const equivalent = comparison === 'equivalent';
  return {
    subQuestionId: item.subQuestionId,
    grading: {
      verdict: equivalent ? 'correct' : 'wrong',
      studentAnswer: item.studentAnswer,
      errorType: equivalent ? undefined : '计算失误',
      comment: equivalent
        ? 'Student answer matches the reference answer.'
        : 'Student answer differs from the reference answer.',
    },
  };
}

export async function run(deps: GradeDeps | unknown): Promise<GradeResult> {
  const typedDeps = deps as GradeDeps;
  const extracted = typedDeps.extractStudentAnswer;
  return {
    items: await Promise.all((extracted?.items ?? []).map((item) => gradeOne(item, typedDeps))),
  };
}
