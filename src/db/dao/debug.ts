import { getDb } from '../client';

export interface DebugDailyStats {
  day: string;
  assignments: number;
  doneAssignments: number;
  failedAssignments: number;
  processingAssignments: number;
  correctQuestions: number;
  wrongQuestions: number;
  unmarkedQuestions: number;
  mistakes: number;
  feedback: number;
  failedTraces: number;
  traceDurationMs: number;
}

export interface DebugRecentAssignment {
  id: string;
  shortId: string;
  subject: string;
  status: string;
  createdAt: number;
  completedAt: number | null;
  totalCount: number | null;
  correctCount: number | null;
  wrongCount: number | null;
  unmarkedCount: number | null;
}

export interface DebugStats {
  generatedAt: number;
  windowStart: number;
  totals: {
    children: number;
    assignments: number;
    doneAssignments: number;
    failedAssignments: number;
    processingAssignments: number;
    subQuestions: number;
    mistakes: number;
    unresolvedMistakes: number;
    feedback: number;
    traces: number;
    failedTraces: number;
  };
  daily: DebugDailyStats[];
  recentAssignments: DebugRecentAssignment[];
}

interface AssignmentStatsRow {
  id: string;
  short_id: string;
  subject: string;
  status: 'processing' | 'done' | 'failed';
  created_at: number;
  completed_at: number | null;
  total_count: number | null;
  correct_count: number | null;
  wrong_count: number | null;
  unmarked_count: number | null;
}

interface CountRow {
  count: number;
}

interface TimestampRow {
  created_at: number;
}

interface TraceStatsRow {
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number | null;
  created_at: number;
}

function count(sql: string, ...params: Array<string | number>): number {
  const row = getDb().prepare(sql).get(...params) as CountRow | undefined;
  return row?.count ?? 0;
}

function formatLocalDay(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDailyBucket(day: string): DebugDailyStats {
  return {
    day,
    assignments: 0,
    doneAssignments: 0,
    failedAssignments: 0,
    processingAssignments: 0,
    correctQuestions: 0,
    wrongQuestions: 0,
    unmarkedQuestions: 0,
    mistakes: 0,
    feedback: 0,
    failedTraces: 0,
    traceDurationMs: 0,
  };
}

function getDailyBucket(buckets: Map<string, DebugDailyStats>, timestamp: number): DebugDailyStats {
  const day = formatLocalDay(timestamp);
  const existing = buckets.get(day);
  if (existing) return existing;
  const bucket = createDailyBucket(day);
  buckets.set(day, bucket);
  return bucket;
}

function getWindowStart(days: number): number {
  const normalizedDays = Math.max(1, Math.min(days, 90));
  return Date.now() - normalizedDays * 24 * 60 * 60 * 1000;
}

export function getDebugStats(input: { days: number; recentLimit: number }): DebugStats {
  const db = getDb();
  const windowStart = getWindowStart(input.days);
  const buckets = new Map<string, DebugDailyStats>();

  const assignments = db
    .prepare(
      `SELECT id, short_id, subject, status, created_at, completed_at,
              total_count, correct_count, wrong_count, unmarked_count
       FROM assignments
       WHERE created_at >= ?
       ORDER BY created_at ASC`,
    )
    .all(windowStart) as AssignmentStatsRow[];

  for (const assignment of assignments) {
    const bucket = getDailyBucket(buckets, assignment.created_at);
    bucket.assignments += 1;
    bucket.correctQuestions += assignment.correct_count ?? 0;
    bucket.wrongQuestions += assignment.wrong_count ?? 0;
    bucket.unmarkedQuestions += assignment.unmarked_count ?? 0;
    if (assignment.status === 'done') bucket.doneAssignments += 1;
    if (assignment.status === 'failed') bucket.failedAssignments += 1;
    if (assignment.status === 'processing') bucket.processingAssignments += 1;
  }

  const mistakes = db
    .prepare('SELECT added_at AS created_at FROM mistakes WHERE added_at >= ? ORDER BY added_at ASC')
    .all(windowStart) as TimestampRow[];
  for (const mistake of mistakes) {
    getDailyBucket(buckets, mistake.created_at).mistakes += 1;
  }

  const feedbackRows = db
    .prepare('SELECT created_at FROM feedback WHERE created_at >= ? ORDER BY created_at ASC')
    .all(windowStart) as TimestampRow[];
  for (const feedback of feedbackRows) {
    getDailyBucket(buckets, feedback.created_at).feedback += 1;
  }

  const traces = db
    .prepare(
      `SELECT status, duration_ms, created_at
       FROM workflow_traces
       WHERE created_at >= ?
       ORDER BY created_at ASC`,
    )
    .all(windowStart) as TraceStatsRow[];
  for (const trace of traces) {
    const bucket = getDailyBucket(buckets, trace.created_at);
    bucket.traceDurationMs += trace.duration_ms ?? 0;
    if (trace.status === 'failed') bucket.failedTraces += 1;
  }

  const recentRows = db
    .prepare(
      `SELECT id, short_id, subject, status, created_at, completed_at,
              total_count, correct_count, wrong_count, unmarked_count
       FROM assignments
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(input.recentLimit) as AssignmentStatsRow[];

  return {
    generatedAt: Date.now(),
    windowStart,
    totals: {
      children: count('SELECT COUNT(*) AS count FROM children'),
      assignments: count('SELECT COUNT(*) AS count FROM assignments'),
      doneAssignments: count("SELECT COUNT(*) AS count FROM assignments WHERE status = 'done'"),
      failedAssignments: count("SELECT COUNT(*) AS count FROM assignments WHERE status = 'failed'"),
      processingAssignments: count("SELECT COUNT(*) AS count FROM assignments WHERE status = 'processing'"),
      subQuestions: count('SELECT COUNT(*) AS count FROM sub_questions'),
      mistakes: count('SELECT COUNT(*) AS count FROM mistakes'),
      unresolvedMistakes: count('SELECT COUNT(*) AS count FROM mistakes WHERE resolved = 0'),
      feedback: count('SELECT COUNT(*) AS count FROM feedback'),
      traces: count('SELECT COUNT(*) AS count FROM workflow_traces'),
      failedTraces: count("SELECT COUNT(*) AS count FROM workflow_traces WHERE status = 'failed'"),
    },
    daily: Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day)),
    recentAssignments: recentRows.map((row) => ({
      id: row.id,
      shortId: row.short_id,
      subject: row.subject,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      totalCount: row.total_count,
      correctCount: row.correct_count,
      wrongCount: row.wrong_count,
      unmarkedCount: row.unmarked_count,
    })),
  };
}
