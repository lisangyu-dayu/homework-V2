import * as sympy from '@/mcp/sympy';
import type { SelfSolveResult } from './selfSolve';

export interface VerifyResult {
  items: Array<{
    subQuestionId: string;
    consistent: boolean;
    skipped?: boolean;
    note?: string;
    comparedAnswer?: string;
    comparedAgainst?: string;
    canonicalAnswer?: string;
    canonicalAgainst?: string;
  }>;
}

interface VerifyDeps {
  selfSolve?: SelfSolveResult;
}

interface VerificationAttempt {
  actual: string;
  expected: string;
  label: string;
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(/[。．\.]+$/u, '').trim() ?? '';
}

function extractEquationRight(expr: string): string | null {
  const index = expr.indexOf('=');
  if (index < 0) return null;
  const right = expr.slice(index + 1).trim();
  return right || null;
}

function addAttempt(attempts: VerificationAttempt[], seen: Set<string>, attempt: VerificationAttempt): void {
  if (!attempt.actual || !attempt.expected) return;
  const key = `${attempt.actual}>>>${attempt.expected}`;
  if (seen.has(key)) return;
  seen.add(key);
  attempts.push(attempt);
}

export function buildVerificationAttempts(
  solution: SelfSolveResult['items'][number]['solution'],
): VerificationAttempt[] {
  const attempts: VerificationAttempt[] = [];
  const seen = new Set<string>();
  const finalAnswer = normalizeText(solution.finalAnswer);
  const lastFormula = normalizeText(
    [...solution.steps].reverse().find((step) => normalizeText(step.formula))?.formula,
  );
  const finalRight = extractEquationRight(finalAnswer);
  const formulaRight = extractEquationRight(lastFormula);

  addAttempt(attempts, seen, {
    actual: finalAnswer,
    expected: lastFormula,
    label: 'final-answer-vs-last-formula',
  });

  if (formulaRight) {
    addAttempt(attempts, seen, {
      actual: finalAnswer,
      expected: formulaRight,
      label: 'final-answer-vs-last-formula-rhs',
    });
  }

  if (finalRight) {
    addAttempt(attempts, seen, {
      actual: finalRight,
      expected: lastFormula,
      label: 'final-answer-rhs-vs-last-formula',
    });
  }

  if (finalRight && formulaRight) {
    addAttempt(attempts, seen, {
      actual: finalRight,
      expected: formulaRight,
      label: 'final-answer-rhs-vs-last-formula-rhs',
    });
  }

  return attempts;
}

async function verifySingleItem(
  item: SelfSolveResult['items'][number],
): Promise<VerifyResult['items'][number]> {
  const attempts = buildVerificationAttempts(item.solution);

  if (attempts.length === 0) {
    return {
      subQuestionId: item.subQuestionId,
      consistent: false,
      skipped: true,
      note: 'verification-skipped:no-comparable-expression',
    };
  }

  let firstConflict: VerifyResult['items'][number] | null = null;
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const verdict = await sympy.equivalent(attempt.actual, attempt.expected);
      if (verdict.equivalent) {
        return {
          subQuestionId: item.subQuestionId,
          consistent: true,
          note: `${attempt.label}:${verdict.note ?? 'equivalent'}`,
          comparedAnswer: attempt.actual,
          comparedAgainst: attempt.expected,
          canonicalAnswer: verdict.canonicalA,
          canonicalAgainst: verdict.canonicalB,
        };
      }

      if (!firstConflict) {
        firstConflict = {
          subQuestionId: item.subQuestionId,
          consistent: false,
          note: `conflict:${attempt.label}:${verdict.note ?? 'not-equivalent'}`,
          comparedAnswer: attempt.actual,
          comparedAgainst: attempt.expected,
          canonicalAnswer: verdict.canonicalA,
          canonicalAgainst: verdict.canonicalB,
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (firstConflict) {
    if (errors.length > 0) {
      firstConflict.note = `${firstConflict.note};ignored-errors=${errors.join(' | ')}`;
    }
    return firstConflict;
  }

  return {
    subQuestionId: item.subQuestionId,
    consistent: false,
    skipped: true,
    note: `verification-skipped:${errors.join(' | ') || 'unknown'}`,
  };
}

export async function run(deps: VerifyDeps | unknown): Promise<VerifyResult> {
  const selfSolve = (deps as VerifyDeps).selfSolve;
  return {
    items: await Promise.all((selfSolve?.items ?? []).map((item) => verifySingleItem(item))),
  };
}
