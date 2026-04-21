# homework-V2 · 技术设计方案

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│  微信                                                    │
└─────────▲──────────────────────────────┬────────────────┘
          │ 回推短链 + 文本               │ 上传图片
┌─────────┴──────────────────────────────▼────────────────┐
│  OpenClaw 插件（消息中继，老项目已有，V2 不改）          │
│    职责：微信消息 <→> HTTP POST <→> 本服务               │
└─────────▲──────────────────────────────┬────────────────┘
          │                              │
          │ POST /pushback               │ POST /api/wechat/webhook
          │                              │
┌─────────┴──────────────────────────────▼────────────────┐
│  homework-V2 服务（Next.js + TS，Win 本机常开）          │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ App Router（Next.js）                              │  │
│  │   /api/wechat/webhook    ← 入口                   │  │
│  │   /api/assignment/:id    ← 结果 JSON              │  │
│  │   /api/mistakes/:childId ← 错题本                 │  │
│  │   /r/:shortId            ← 结果页（SSR）          │  │
│  │   /mistakes              ← 错题本页（SSR）        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Workflow（src/workflow/）                          │  │
│  │   DAG Runner + 节点                                │  │
│  │   preprocess → layoutSplit → parseQuestion        │  │
│  │   → selfSolve → verify → extractStudentAnswer     │  │
│  │   → grade → generateExplanation → kpTagging       │  │
│  │   → persist → render                              │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ Provider Adapter │  │ MCP 客户端                │   │
│  │  - Claude SDK    │  │  - SymPy                 │   │
│  │  - Codex CLI     │  │  - KnowledgePoints       │   │
│  │  - Router        │  │  - ImageCrop             │   │
│  └──────────────────┘  └──────────────────────────┘   │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ SQLite（better-sqlite3，./data/db/homework.db）    │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 2. OpenClaw 定位

**只做消息中继**，不做业务编排。

| 事项 | 由谁负责 |
|---|---|
| 微信协议/加解密 | OpenClaw 插件（沿用） |
| 消息推送/回推 | OpenClaw 插件 |
| 业务流程编排 | **本服务的 TS 代码** |
| 模型路由 | **本服务的 Provider Adapter** |
| 工具调用（MCP） | **本服务直连** |
| 持久化 | **本服务 SQLite** |
| HTML 渲染 | **本服务 Next.js** |

**不用 OpenClaw 工作流的原因**：迭代速度、类型安全、调试便利、少一层依赖。详见历次讨论。

## 3. 业务工作流（DAG）

### 3.1 节点清单

| # | 节点 | 位置 | 输入 | 输出 | 模型/工具 |
|---|---|---|---|---|---|
| 1 | `preprocess` | `src/workflow/nodes/preprocess.ts` | 原图 buffer | 矫正/增强图 + 元数据 | Sharp（本地 CPU） |
| 2 | `layoutSplit` | 同上 | 整页图 | 大题树（含 bbox） | Claude Vision（V1 全走 VLM）|
| 3 | `parseQuestion` | 同上 | 单小题图 | 结构化 JSON（题面+图表+条件）| Claude Sonnet 4.6 |
| 4 | `selfSolve` | 同上 | 题面 JSON | 解题步骤 + 最终答案 + 置信度 | Codex (GPT-5.4) 首选 |
| 5 | `verify` | 同上 | 题面 + 自解答案 | 一致/不一致 + 补充解 | SymPy MCP |
| 6 | `extractStudentAnswer` | 同上 | 单题图 | 学生答案（可能为 null）| Claude Vision（机会性）|
| 7 | `grade` | 同上 | 标准答案 + 学生答案 | ✓/✗/—（二态+跳过）| 代码规则 |
| 8 | `generateExplanation` | 同上 | 题面 + 解 + 判定 | 讲解文本（Markdown/LaTeX）| Claude Sonnet 4.6 |
| 9 | `kpTagging` | 同上 | 题面 | 知识点 tag[] | KnowledgePoints MCP + LLM |
| 10 | `persist` | 同上 | 所有字段 | assignmentId | SQLite |
| 11 | `render` | 同上 | assignmentId | shortId + URL | 本地生成 |

### 3.2 并发与重试策略

- **大题级并发**：同一大题下的小题独立，并发处理（默认并发度 4，环境变量 `WORKFLOW_CONCURRENCY` 调整）
- **节点级重试**：LLM/MCP 调用失败重试 3 次（指数退避）
- **节点级兜底**：
  - `selfSolve` 失败 → 切换另一 Provider 重试
  - `verify` 不一致 → 标 "未批改"
  - `extractStudentAnswer` 失败/低置信 → 标 "未批改"
- **全局超时**：单份作业 120s，超时返回占位页并记录

### 3.3 DAG Runner 最小实现

`src/workflow/dag.ts` 提供 ~150 行实现：
- 节点注册
- 依赖声明
- 并发调度（p-limit）
- 失败策略（retry / fallback / skip）
- Trace 写入 SQLite（用于调试回放）

**不引入 Temporal/n8n 等外部引擎**——当前规模不值得。

## 4. Provider Adapter

### 4.1 接口

```typescript
// src/providers/types.ts
export interface LLMProvider {
  readonly name: 'claude' | 'codex';
  chat(req: ChatRequest): Promise<ChatResponse>;
  vision(req: VisionRequest): Promise<VisionResponse>;
  readonly supportsPromptCache: boolean;
}

export interface ChatRequest {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  cacheKey?: string;  // 用于 prompt cache 分段标识
}

export interface VisionRequest extends ChatRequest {
  images: Array<{ data: Buffer; mediaType: 'image/jpeg' | 'image/png' }>;
}
```

### 4.2 Claude 实现

- 依赖：`@anthropic-ai/sdk`
- 原生支持 prompt caching（使用 `cache_control` 字段）
- 视觉消息用 `image` content block

### 4.3 Codex 实现（CLI 子进程）

```
// src/providers/codex.ts
// 通过 child_process.spawn('codex', ['exec', '--model', 'gpt-5.4', '--json'])
// stdin 传 prompt，stdout 读 JSON 响应
```

关键点：
- **单例子进程池**（`CODEX_POOL_SIZE=3` 默认），避免每次 fork 开销
- **健康检查**：启动时 `codex --version` 探测
- **超时控制**：`CODEX_TIMEOUT_MS`，超时 SIGKILL + 重启进程
- **错误码映射**：CLI 非零退出 → `ProviderError`（包含 stderr 片段）
- **视觉输入**：V1 Codex CLI 视觉能力视实际支持情况，若不支持 → 视觉任务全部路由到 Claude（Router 层决定）

### 4.4 Router

`src/providers/router.ts`：

| 任务 | 首选 | 备选 |
|---|---|---|
| `vision` / 整题理解 | Claude | （Codex 若支持） |
| `selfSolve` 数学 | **Codex** | Claude |
| `generateExplanation` | Claude | Codex |
| `kpTagging` 分类 | Claude (便宜) | — |

路由规则代码硬编码，环境变量可覆盖（`PROVIDER_OVERRIDE_<TASK>=claude|codex`）。

### 4.5 Prompt 缓存分层（仅 Claude）

```
[system]     角色 + 输出 schema + 通用 rubric         · 缓存（永久）
[assignment] 本次作业学科/年级/共用题干                · 缓存（作业内）
[turn]       单题图 + 题面 JSON                       · 不缓存
```

Codex CLI 侧 V1 暂不做缓存（等 CLI 支持度验证）。

## 5. 数据模型（SQLite）

### 5.1 表设计

```sql
-- 孩子（V1 一个 openId = 一个 child）
CREATE TABLE children (
  id          TEXT PRIMARY KEY,       -- nanoid
  openid      TEXT UNIQUE NOT NULL,   -- 微信 openid
  nickname    TEXT,
  grade       INTEGER,
  created_at  INTEGER NOT NULL
);

-- 作业
CREATE TABLE assignments (
  id          TEXT PRIMARY KEY,
  short_id    TEXT UNIQUE NOT NULL,   -- URL 短码
  child_id    TEXT NOT NULL,
  subject     TEXT NOT NULL,          -- V1: 'math'
  original_image_path TEXT NOT NULL,
  status      TEXT NOT NULL,          -- 'processing'|'done'|'failed'
  created_at  INTEGER NOT NULL,
  completed_at INTEGER,
  total_count INTEGER,
  correct_count INTEGER,
  wrong_count INTEGER,
  unmarked_count INTEGER,
  cost_cents  INTEGER,                 -- 本次 API 成本（分）
  FOREIGN KEY (child_id) REFERENCES children(id)
);

-- 大题
CREATE TABLE major_questions (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  number        TEXT NOT NULL,         -- "一" / "1"
  order_index   INTEGER NOT NULL,
  stem          TEXT,                  -- 共用题干（阅读材料）
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
);

-- 小题
CREATE TABLE sub_questions (
  id                 TEXT PRIMARY KEY,
  major_id           TEXT NOT NULL,
  number             TEXT NOT NULL,    -- "(1)" / "①"
  order_index        INTEGER NOT NULL,
  crop_path          TEXT NOT NULL,
  parsed_stem_json   TEXT NOT NULL,    -- 题面 JSON
  solution_steps_json TEXT NOT NULL,   -- 解题步骤数组
  final_answer       TEXT NOT NULL,
  confidence         REAL NOT NULL,
  verdict            TEXT NOT NULL,    -- 'correct'|'wrong'|'unmarked'
  student_answer     TEXT,             -- 可能为 null
  error_type         TEXT,             -- 概念不清/计算失误/漏解/题意偏差
  explanation_md     TEXT NOT NULL,
  FOREIGN KEY (major_id) REFERENCES major_questions(id) ON DELETE CASCADE
);

-- 小题-知识点关联
CREATE TABLE sub_question_tags (
  sub_question_id TEXT NOT NULL,
  tag_id          TEXT NOT NULL,
  confidence      REAL NOT NULL,
  PRIMARY KEY (sub_question_id, tag_id),
  FOREIGN KEY (sub_question_id) REFERENCES sub_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES knowledge_tags(id)
);

-- 知识点主数据
CREATE TABLE knowledge_tags (
  id          TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  grade_min   INTEGER,
  grade_max   INTEGER,
  name        TEXT NOT NULL,
  parent_id   TEXT,
  brief       TEXT,
  aliases_json TEXT,
  FOREIGN KEY (parent_id) REFERENCES knowledge_tags(id)
);

-- 错题本
CREATE TABLE mistakes (
  id                TEXT PRIMARY KEY,
  child_id          TEXT NOT NULL,
  sub_question_id   TEXT NOT NULL,
  added_at          INTEGER NOT NULL,
  resolved          INTEGER NOT NULL DEFAULT 0,  -- 0/1
  resolved_at       INTEGER,
  source            TEXT NOT NULL,               -- 'auto'|'manual'
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (sub_question_id) REFERENCES sub_questions(id)
);

-- 家长反馈
CREATE TABLE feedback (
  id              TEXT PRIMARY KEY,
  sub_question_id TEXT NOT NULL,
  feedback_type   TEXT NOT NULL,      -- 'grading_wrong'|'confirm_correct'|'manual_verdict'
  payload_json    TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (sub_question_id) REFERENCES sub_questions(id)
);

-- 工作流 trace（调试/监控）
CREATE TABLE workflow_traces (
  id              TEXT PRIMARY KEY,
  assignment_id   TEXT NOT NULL,
  node_name       TEXT NOT NULL,
  status          TEXT NOT NULL,       -- 'success'|'failed'|'skipped'
  duration_ms     INTEGER,
  input_json      TEXT,
  output_json     TEXT,
  error_msg       TEXT,
  model_used      TEXT,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  cost_cents      INTEGER,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id)
);

-- 索引
CREATE INDEX idx_assignments_child ON assignments(child_id, created_at DESC);
CREATE INDEX idx_mistakes_child ON mistakes(child_id, added_at DESC);
CREATE INDEX idx_sub_tags_tag ON sub_question_tags(tag_id);
CREATE INDEX idx_traces_assignment ON workflow_traces(assignment_id);
```

### 5.2 迁移策略

- V1 直接一份完整 schema（`src/db/migrations/001_init.sql`）
- 后续变更**只加列/表不改类型**；重大变更用新迁移文件（`002_xxx.sql`）
- 迁移执行：`npm run db:init` 幂等（`CREATE TABLE IF NOT EXISTS`）

## 6. MCP 客户端

V1 只上 SymPy 和 KnowledgePoints 两个；统一放 `src/mcp/`。

### 6.1 SymPy MCP

- 用途：
  - `solve(equation)`：独立求解
  - `simplify(expr)`：化简比对
  - `equivalent(a, b)`：等价判定（核心接口）
- 实现：
  - V1 先用 Python 子进程本地调用（不走真正的 MCP 协议，用子进程+JSON 标准输入输出简化）
  - 独立文件 `scripts/sympy_runner.py`
  - 后续切真 MCP Server（如需多端共享）

### 6.2 KnowledgePoints MCP

- 用途：`search(text) → top-k tags`
- 实现：
  - V1 纯 TS 本地：`better-sqlite3` 读 `knowledge_tags`，关键词匹配 + LLM 精排
  - **不上 embedding 向量检索**（V1 节点数少，~300 个，全表 LLM 召回足够）
  - V2 扩展到全学科/数千节点时再加 embedding

## 7. 题面理解 · 结构化 JSON（数学）

```typescript
// src/lib/types.ts
export interface ParsedMathQuestion {
  subject: 'math';
  questionType:
    | 'multiple-choice'    // 选择
    | 'fill-blank'         // 填空
    | 'computation'        // 计算
    | 'solve-equation'     // 解方程
    | 'word-problem'       // 应用题
    | 'geometry-proof'     // 几何证明
    | 'geometry-compute'   // 几何计算
    | 'function-analysis'; // 函数分析

  stemText: string;              // 题面纯文本（LaTeX 表示公式）
  diagrams?: Array<{
    type: 'geometry' | 'coordinate' | 'table' | 'chart';
    description: string;         // 自然语言描述
    extractedObjects?: Array<{   // 结构化对象（几何图）
      name: string;
      properties: string[];
    }>;
    markedConditions?: string[]; // 图中标注的条件（如 ∠BAD=30°）
  }>;
  knownConditions: string[];     // 已知条件（从题面 + 图 合并）
  goal: string;                  // 求证/求解目标
  choices?: Array<{ label: string; text: string }>; // 选择题选项
}
```

## 8. 微信接入协议（与 OpenClaw 插件契约）

### 8.1 插件 → 本服务

```
POST /api/wechat/webhook
Headers: X-OpenClaw-Secret: <shared-secret>
Body (JSON):
{
  "openId": "o_xxx",
  "messageType": "image" | "text",
  "imageBuffer": "<base64>",       // 仅 image
  "text": "...",                    // 仅 text
  "timestamp": 1713654321
}
```

响应：立即 `{ ok: true, assignmentId: "..." }`，批改异步进行。

### 8.2 本服务 → 插件（回推短链）

```
POST ${OPENCLAW_PUSHBACK_URL}
Headers: X-Service-Secret: <shared-secret>
Body:
{
  "openId": "o_xxx",
  "messageType": "text",
  "text": "批改完成，查看结果：http://192.168.1.100:3100/r/abc123"
}
```

## 9. 渲染与部署

### 9.1 HTML 渲染

- Next.js 15 App Router，SSR
- 结果页（`/r/:shortId`）、错题本页（`/mistakes`）均 SSR
- 图片：直接从 `uploads/` 提供静态（Next.js 配置 `publicRuntimeConfig` 或自定义路由）
- 不引入前端状态管理库（V1 无复杂交互）
- 样式：CSS Modules（零依赖）

### 9.2 局域网访问

- 监听 `0.0.0.0:3100`
- `PUBLIC_BASE_URL` 填 Win 机内网 IP
- 回推微信的短链使用 `PUBLIC_BASE_URL`

### 9.3 进程管理（Win 本机）

- 开发：`npm run dev`
- 生产：
  - 方案 A：`npm run build && npm run start`，用 `pm2-windows-startup` 或任务计划开机启动
  - 方案 B：直接 `nssm` 装成 Windows 服务
- V1 推荐方案 A，后期视稳定性换 B

## 10. 成本/延迟预算（20 题数学试卷）

| 阶段 | 耗时 | 成本（人民币） |
|---|---|---|
| 预处理 | 1-2s | 0 |
| 版面切题（Claude Vision） | 3-5s | ¥0.05-0.10 |
| 整题理解（Claude Vision，20 题并发） | 8-12s | ¥0.20-0.30 |
| 自解（Codex，20 题并发） | 6-10s | ¥0.15-0.25 |
| SymPy 验证 | <1s | 0 |
| 学生答案抽取（Claude Vision，机会性） | 4-6s | ¥0.08-0.12 |
| 讲解生成（Claude，20 题） | 5-8s | ¥0.10-0.15 |
| 知识点打标 + 持久化 + 渲染 | 2s | 0 |
| **P50 合计** | **~30-40s** | **≈¥0.6-0.9** |

## 11. 可观测性

- 日志：Pino，结构化 JSON，写 `./data/logs/`
- Trace：每个节点执行写入 `workflow_traces` 表
- Debug 页面：`/debug/assignment/:id`（内网限制访问）查看工作流 trace
- 指标统计（简单）：
  - 每日作业数 / 成功率 / 平均耗时 / 平均成本
  - 通过 `/debug/stats` 页查看

## 12. 安全

- `/api/wechat/webhook` 需 `X-OpenClaw-Secret` 校验
- 外部访问只暴露**局域网**，不开公网端口
- 管理路由（`/debug/*`）加简单 basic auth（环境变量 `ADMIN_USER` / `ADMIN_PASS`）
- SQL 注入防护：全部使用 `better-sqlite3` prepared statements
- 上传图片校验 mime + 大小（≤ 20MB）

## 13. 测试策略

- **单元**：Provider Adapter、DAG Runner、SQL 层 → Vitest + mock
- **集成**：单节点工作流固定夹具测试 → 真实 API 调用（使用小流量配额）
- **E2E**：选 5-10 张标准数学作业图作为回归集，每次发版手动跑

## 14. 版本路线图

| 版本 | 范围 |
|---|---|
| V1.0 | 数学 + 在线 API + Win 本机 + 错题本（知识点+日期）|
| V1.1 | 家长反馈回流 few-shot；错题本"已掌握"管理 |
| V2.0 | 教材章节上传注入上下文；英语接入；Docker 打包 |
| V2.1 | 本地 VLM（学生答案抽取）；练习包生成 |
| V3.0 | 语文客观题；多孩子支持；数据导出 |
