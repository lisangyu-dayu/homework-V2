-- homework-V2 initial schema
-- 与 docs/02-tech-design.md §5 对齐
-- 执行：scripts/init-db.ts

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS children (
  id          TEXT PRIMARY KEY,
  openid      TEXT UNIQUE NOT NULL,
  nickname    TEXT,
  grade       INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id                  TEXT PRIMARY KEY,
  short_id            TEXT UNIQUE NOT NULL,
  child_id            TEXT NOT NULL,
  subject             TEXT NOT NULL,
  original_image_path TEXT NOT NULL,
  status              TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  total_count         INTEGER,
  correct_count       INTEGER,
  wrong_count         INTEGER,
  unmarked_count      INTEGER,
  cost_cents          INTEGER,
  FOREIGN KEY (child_id) REFERENCES children(id)
);

CREATE TABLE IF NOT EXISTS major_questions (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  number        TEXT NOT NULL,
  order_index   INTEGER NOT NULL,
  stem          TEXT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub_questions (
  id                  TEXT PRIMARY KEY,
  major_id            TEXT NOT NULL,
  number              TEXT NOT NULL,
  order_index         INTEGER NOT NULL,
  crop_path           TEXT NOT NULL,
  parsed_stem_json    TEXT NOT NULL,
  solution_steps_json TEXT NOT NULL,
  final_answer        TEXT NOT NULL,
  confidence          REAL NOT NULL,
  verdict             TEXT NOT NULL,
  student_answer      TEXT,
  error_type          TEXT,
  explanation_md      TEXT NOT NULL,
  FOREIGN KEY (major_id) REFERENCES major_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_tags (
  id           TEXT PRIMARY KEY,
  subject      TEXT NOT NULL,
  grade_min    INTEGER,
  grade_max    INTEGER,
  name         TEXT NOT NULL,
  parent_id    TEXT,
  brief        TEXT,
  aliases_json TEXT,
  FOREIGN KEY (parent_id) REFERENCES knowledge_tags(id)
);

CREATE TABLE IF NOT EXISTS sub_question_tags (
  sub_question_id TEXT NOT NULL,
  tag_id          TEXT NOT NULL,
  confidence      REAL NOT NULL,
  PRIMARY KEY (sub_question_id, tag_id),
  FOREIGN KEY (sub_question_id) REFERENCES sub_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES knowledge_tags(id)
);

CREATE TABLE IF NOT EXISTS mistakes (
  id              TEXT PRIMARY KEY,
  child_id        TEXT NOT NULL,
  sub_question_id TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  resolved        INTEGER NOT NULL DEFAULT 0,
  resolved_at     INTEGER,
  source          TEXT NOT NULL,
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (sub_question_id) REFERENCES sub_questions(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id              TEXT PRIMARY KEY,
  sub_question_id TEXT NOT NULL,
  feedback_type   TEXT NOT NULL,
  payload_json    TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (sub_question_id) REFERENCES sub_questions(id)
);

CREATE TABLE IF NOT EXISTS workflow_traces (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  node_name     TEXT NOT NULL,
  status        TEXT NOT NULL,
  duration_ms   INTEGER,
  input_json    TEXT,
  output_json   TEXT,
  error_msg     TEXT,
  model_used    TEXT,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost_cents    INTEGER,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_child ON assignments(child_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mistakes_child   ON mistakes(child_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_tags_tag     ON sub_question_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_traces_assignment ON workflow_traces(assignment_id);
CREATE INDEX IF NOT EXISTS idx_kt_subject        ON knowledge_tags(subject, parent_id);
