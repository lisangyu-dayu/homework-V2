// 全项目共享的业务类型
// Zod schemas 在各自模块就近声明；此处只放纯 TS 类型

export type Subject = 'math';

export type Verdict = 'correct' | 'wrong' | 'unmarked';

export interface KnowledgeTag {
  id: string;
  name: string;
  confidence?: number;
}

export type MathQuestionType =
  | 'multiple-choice'
  | 'fill-blank'
  | 'computation'
  | 'solve-equation'
  | 'word-problem'
  | 'geometry-proof'
  | 'geometry-compute'
  | 'function-analysis';

export interface DiagramExtract {
  type: 'geometry' | 'coordinate' | 'table' | 'chart';
  description: string;
  extractedObjects?: Array<{ name: string; properties: string[] }>;
  markedConditions?: string[];
}

export interface ParsedMathQuestion {
  subject: 'math';
  questionType: MathQuestionType;
  stemText: string;
  diagrams?: DiagramExtract[];
  knownConditions: string[];
  goal: string;
  choices?: Array<{ label: string; text: string }>;
}

export interface SolutionStep {
  text: string;
  formula?: string;
}

export interface Solution {
  steps: SolutionStep[];
  finalAnswer: string;
  confidence: number;
  solverModel: 'claude' | 'codex';
}

export interface GradingResult {
  verdict: Verdict;
  studentAnswer: string | null;
  errorType?: string;
  comment: string;
}

export interface AssignmentStats {
  total: number;
  correct: number;
  wrong: number;
  unmarked: number;
}
