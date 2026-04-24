// major_questions / sub_questions DAO（M1 完成实现）
import { getDb } from '../client';
import type { KnowledgeTag, ParsedMathQuestion, SolutionStep, Subject, Verdict } from '@/lib/types';

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

interface MajorQuestionRow {
  id: string;
  assignmentId: string;
  number: string;
  orderIndex: number;
  stem: string | null;
}

export interface SubQuestionRow {
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
  errorType: string | null;
  explanationMd: string;
  knowledgeTags: Array<{ id: string; confidence: number }>;
}

export interface AssignmentQuestionTree {
  majorQuestions: Array<MajorQuestionRow & { subQuestions: SubQuestionRow[] }>;
}

export interface AutoMistakeInput {
  id: string;
  childId: string;
  sourceSubQuestionId: string;
  sourceAssignmentId: string;
  snapshotCropPath: string;
  snapshotSubject: Subject;
  snapshotParsedStemJson: string;
  snapshotSolutionStepsJson: string;
  snapshotFinalAnswer: string;
  snapshotStudentAnswer: string | null;
  snapshotErrorType: string | null;
  snapshotExplanationMd: string;
  snapshotKnowledgeTags: KnowledgeTag[];
}

export interface PersistAssignmentQuestionResultsInput {
  assignmentId: string;
  majorQuestion: {
    id: string;
    number: string;
    orderIndex: number;
    stem?: string;
  };
  subQuestions: SubQuestionInput[];
  autoMistakes: AutoMistakeInput[];
  stats: {
    correct: number;
    wrong: number;
    unmarked: number;
    total: number;
  };
}

export function insertMajorQuestion(input: {
  id: string; assignmentId: string; number: string; orderIndex: number; stem?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO major_questions (id, assignment_id, number, order_index, stem)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.id, input.assignmentId, input.number, input.orderIndex, input.stem ?? null);
}

export function bulkInsertSubQuestions(items: SubQuestionInput[]): void {
  if (items.length === 0) return;
  const db = getDb();
  const insertSubQuestion = db.prepare(
    `INSERT INTO sub_questions (
       id, major_id, number, order_index, crop_path, parsed_stem_json,
       solution_steps_json, final_answer, confidence, verdict,
       student_answer, error_type, explanation_md
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTag = db.prepare(
    `INSERT INTO sub_question_tags (sub_question_id, tag_id, confidence)
     VALUES (?, ?, ?)`,
  );

  const transaction = db.transaction((entries: SubQuestionInput[]) => {
    for (const item of entries) {
      insertSubQuestion.run(
        item.id,
        item.majorId,
        item.number,
        item.orderIndex,
        item.cropPath,
        JSON.stringify(item.parsedStem),
        JSON.stringify(item.solutionSteps),
        item.finalAnswer,
        item.confidence,
        item.verdict,
        item.studentAnswer,
        item.errorType ?? null,
        item.explanationMd,
      );
      for (const tag of item.knowledgeTagIds) {
        insertTag.run(item.id, tag.id, tag.confidence);
      }
    }
  });

  transaction(items);
}

export function persistAssignmentQuestionResults(input: PersistAssignmentQuestionResultsInput): void {
  const db = getDb();
  const insertMajor = db.prepare(
    `INSERT INTO major_questions (id, assignment_id, number, order_index, stem)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertSubQuestion = db.prepare(
    `INSERT INTO sub_questions (
       id, major_id, number, order_index, crop_path, parsed_stem_json,
       solution_steps_json, final_answer, confidence, verdict,
       student_answer, error_type, explanation_md
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTag = db.prepare(
    `INSERT INTO sub_question_tags (sub_question_id, tag_id, confidence)
     VALUES (?, ?, ?)`,
  );
  const insertMistake = db.prepare(
    `INSERT INTO mistakes (
       id, child_id, source_sub_question_id, source_assignment_id,
       snapshot_crop_path, snapshot_subject,
       snapshot_parsed_stem_json, snapshot_solution_steps_json,
       snapshot_final_answer, snapshot_student_answer,
       snapshot_error_type, snapshot_explanation_md,
       snapshot_knowledge_tags_json,
       added_at, source, resolved
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', 0)`,
  );
  const complete = db.prepare(
    `UPDATE assignments
     SET status = 'done',
         completed_at = ?,
         total_count = ?,
         correct_count = ?,
         wrong_count = ?,
         unmarked_count = ?
     WHERE id = ?`,
  );

  db.transaction((payload: PersistAssignmentQuestionResultsInput) => {
    insertMajor.run(
      payload.majorQuestion.id,
      payload.assignmentId,
      payload.majorQuestion.number,
      payload.majorQuestion.orderIndex,
      payload.majorQuestion.stem ?? null,
    );

    for (const item of payload.subQuestions) {
      insertSubQuestion.run(
        item.id,
        item.majorId,
        item.number,
        item.orderIndex,
        item.cropPath,
        JSON.stringify(item.parsedStem),
        JSON.stringify(item.solutionSteps),
        item.finalAnswer,
        item.confidence,
        item.verdict,
        item.studentAnswer,
        item.errorType ?? null,
        item.explanationMd,
      );
      for (const tag of item.knowledgeTagIds) {
        insertTag.run(item.id, tag.id, tag.confidence);
      }
    }

    const now = Date.now();
    for (const mistake of payload.autoMistakes) {
      insertMistake.run(
        mistake.id,
        mistake.childId,
        mistake.sourceSubQuestionId,
        mistake.sourceAssignmentId,
        mistake.snapshotCropPath,
        mistake.snapshotSubject,
        mistake.snapshotParsedStemJson,
        mistake.snapshotSolutionStepsJson,
        mistake.snapshotFinalAnswer,
        mistake.snapshotStudentAnswer,
        mistake.snapshotErrorType,
        mistake.snapshotExplanationMd,
        JSON.stringify(mistake.snapshotKnowledgeTags),
        now,
      );
    }

    complete.run(
      now,
      payload.stats.total,
      payload.stats.correct,
      payload.stats.wrong,
      payload.stats.unmarked,
      payload.assignmentId,
    );
  })(input);
}

export function getByAssignment(assignmentId: string): AssignmentQuestionTree {
  const db = getDb();
  const majorRows = db.prepare(
    `SELECT id, assignment_id, number, order_index, stem
     FROM major_questions
     WHERE assignment_id = ?
     ORDER BY order_index ASC`,
  ).all(assignmentId) as Array<{
    id: string;
    assignment_id: string;
    number: string;
    order_index: number;
    stem: string | null;
  }>;

  const subRows = db.prepare(
    `SELECT sq.id, sq.major_id, sq.number, sq.order_index, sq.crop_path,
            sq.parsed_stem_json, sq.solution_steps_json, sq.final_answer,
            sq.confidence, sq.verdict, sq.student_answer, sq.error_type, sq.explanation_md
     FROM sub_questions sq
     JOIN major_questions mq ON mq.id = sq.major_id
     WHERE mq.assignment_id = ?
     ORDER BY mq.order_index ASC, sq.order_index ASC`,
  ).all(assignmentId) as Array<{
    id: string;
    major_id: string;
    number: string;
    order_index: number;
    crop_path: string;
    parsed_stem_json: string;
    solution_steps_json: string;
    final_answer: string;
    confidence: number;
    verdict: Verdict;
    student_answer: string | null;
    error_type: string | null;
    explanation_md: string;
  }>;

  const subIds = subRows.map((row) => row.id);
  const tagsBySubQuestionId = new Map<string, Array<{ id: string; confidence: number }>>();
  if (subIds.length > 0) {
    const placeholders = subIds.map(() => '?').join(', ');
    const tagRows = db.prepare(
      `SELECT sub_question_id, tag_id, confidence
       FROM sub_question_tags
       WHERE sub_question_id IN (${placeholders})
       ORDER BY confidence DESC`,
    ).all(...subIds) as Array<{
      sub_question_id: string;
      tag_id: string;
      confidence: number;
    }>;
    for (const row of tagRows) {
      const bucket = tagsBySubQuestionId.get(row.sub_question_id) ?? [];
      bucket.push({ id: row.tag_id, confidence: row.confidence });
      tagsBySubQuestionId.set(row.sub_question_id, bucket);
    }
  }

  return {
    majorQuestions: majorRows.map((major) => ({
      id: major.id,
      assignmentId: major.assignment_id,
      number: major.number,
      orderIndex: major.order_index,
      stem: major.stem,
      subQuestions: subRows
        .filter((row) => row.major_id === major.id)
        .map((row) => ({
          id: row.id,
          majorId: row.major_id,
          number: row.number,
          orderIndex: row.order_index,
          cropPath: row.crop_path,
          parsedStem: JSON.parse(row.parsed_stem_json) as ParsedMathQuestion,
          solutionSteps: JSON.parse(row.solution_steps_json) as SolutionStep[],
          finalAnswer: row.final_answer,
          confidence: row.confidence,
          verdict: row.verdict,
          studentAnswer: row.student_answer,
          errorType: row.error_type,
          explanationMd: row.explanation_md,
          knowledgeTags: tagsBySubQuestionId.get(row.id) ?? [],
        })),
    })),
  };
}
