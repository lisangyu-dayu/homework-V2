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
│  │   /api/mistakes          ← 错题本（cookie 推导） │  │
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
│  │  - Claude CLI    │  │  - SymPy                 │   │
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
| 2 | `layoutSplit` | 同上 | 整页图 | 大题树（含 bbox） | Claude CLI · vision（V1 全走 VLM）|
| 3 | `parseQuestion` | 同上 | 单小题图 | 结构化 JSON（题面+图表+条件）| Claude CLI |
| 4 | `selfSolve` | 同上 | 题面 JSON | 解题步骤 + 最终答案 + 置信度 | Codex CLI 首选，Claude CLI 兜底 |
| 5 | `verify` | 同上 | 题面 + 自解答案 | 一致/不一致 + 补充解 | SymPy MCP |
| 6 | `extractStudentAnswer` | 同上 | 单题图 | 学生答案（可能为 null）| Claude CLI · vision（机会性）|
| 7 | `grade` | 同上 | 标准答案 + 学生答案 | ✓/✗/—（二态+跳过）| 代码规则 |
| 8 | `generateExplanation` | 同上 | 题面 + 解 + 判定 | 讲解文本（Markdown/LaTeX）| Claude CLI |
| 9 | `kpTagging` | 同上 | 题面 | 知识点 tag[] | KnowledgePoints MCP + LLM |
| 10 | `persist` | 同上 | 所有字段 | assignmentId | SQLite |
| 11 | `render` | 同上 | assignmentId | shortId + URL | 本地生成 |

具体模型名（如 Claude sonnet、Codex gpt-5.x）通过 `.env` 的 `CLAUDE_DEFAULT_MODEL` / `CODEX_DEFAULT_MODEL` 配置，代码不硬编码品牌版本。

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

### 4.2 订阅模式（对称 CLI 方案）

V1 两侧都走**本机已登录的 CLI 子进程**，不使用 API Key。
理由：
- Anthropic 自 2026-04 起禁止 Agent SDK 复用订阅 OAuth，官方唯一合规路径是 Claude Code CLI
- 为避免两侧实现发散与迁移成本，Codex 也采用 CLI 子进程，接口与池化策略与 Claude 对称
- 启动前由 `scripts/check-cli.ts` 探测 `claude --version` 与 `codex --version`；未安装/未登录则拒绝启动

凭据来源（只读复用）：
- Claude：`~/.claude/` 下的登录态（由 `claude login` 写入）
- Codex：`~/.codex/auth.json`（由 `codex login` 写入，或 `CODEX_HOME` 覆盖）

### 4.3 Claude 实现（CLI 子进程）

```
// src/providers/claude.ts
// child_process.spawn('claude', [
//   '-p', '--output-format', 'stream-json',
//   '--permission-mode', 'bypassPermissions',
//   '--model', 'sonnet',
// ])
// stdin 传 prompt + 可选图片引用，stdout 行分隔 JSON
```

关键点：
- **单例子进程池**（`CLAUDE_POOL_SIZE=4` 默认）
- **单进程串行、池级并发**：CLI 内状态机不支持多路复用
- **超时控制**：`CLAUDE_TIMEOUT_MS`，超时 SIGKILL + 重启
- **prompt 缓存**：沿用 CLI 内置行为，无需代码层干预

### 4.4 Codex 实现（CLI 子进程）

```
// src/providers/codex.ts
// child_process.spawn('codex', ['exec', '--model', 'gpt-5.4', '--json'])
// stdin 传 prompt，stdout 读 JSON 响应
```

关键点：
- **单例子进程池**（`CODEX_POOL_SIZE=3` 默认），避免每次 fork 开销
- **健康检查**：启动时 `codex --version` 探测
- **超时控制**：`CODEX_TIMEOUT_MS`，超时 SIGKILL + 重启进程
- **错误码映射**：CLI 非零退出 → `UpstreamError`（包含 stderr 片段）
- **视觉输入**：V1 Codex CLI 视觉能力需 M3 实测；若不支持 → 视觉任务全部路由到 Claude（Router 层决定）

### 4.5 Router

`src/providers/router.ts`：

| 任务 | 首选 | 备选 |
|---|---|---|
| `vision` / 整题理解 | Claude | （Codex 若支持） |
| `selfSolve` 数学 | **Codex** | Claude |
| `generateExplanation` | Claude | Codex |
| `kpTagging` 分类 | Claude (便宜) | — |

路由规则代码硬编码，环境变量可覆盖（`PROVIDER_OVERRIDE_<TASK>=claude|codex`）。

### 4.6 Prompt 缓存分层（Claude CLI 内置）

```
[system]     角色 + 输出 schema + 通用 rubric         · CLI 内置缓存
[assignment] 本次作业学科/年级/共用题干                · CLI 内置缓存
[turn]       单题图 + 题面 JSON                       · 不缓存
```

订阅模式下 CLI 缓存命中率不可编程控制，代码层只保证 system/assignment 文本稳定（逐字节相同）即可最大化命中。
Codex CLI 侧 V1 暂不做缓存（等 CLI 支持度验证）。

## 5. 数据模型（SQLite）

权威来源：`src/db/migrations/001_init.sql`。以下为讲解版本，与 SQL 严格对齐；改动以 SQL 为准。

### 5.1 概览

- `children`：一个 `openId` = 一个孩子（V1）。`parent_token` 作为签名短链与 cookie 凭据使用，永不外泄。
- `assignments` / `major_questions` / `sub_questions`：作业→大题→小题层级；`sub_questions` 级联 `ON DELETE CASCADE`。
- `knowledge_tags` + `sub_question_tags`：知识点主数据与多对多关联。
- `mistakes`：**错题本采用自包含快照**，不通过外键引用 `sub_questions`（详见 §5.3）。
- `feedback`：家长反馈；外键 `ON DELETE CASCADE` 到 `sub_questions`——反馈的价值依赖题面上下文，作业删了单独留反馈没有 few-shot 复现意义。
- `workflow_traces`：节点级调试 trace。
- 订阅模式下没有按次计费，因此 `assignments` 与 `workflow_traces` **不记录 cost_cents / tokens_in / tokens_out**。

### 5.2 核心约束

- `children.openid UNIQUE`、`children.parent_token UNIQUE`
- `assignments.short_id UNIQUE`，`assignments.child_id → children.id`（硬 FK）
- `major_questions.assignment_id → assignments.id ON DELETE CASCADE`
- `sub_questions.major_id → major_questions.id ON DELETE CASCADE`
- `feedback.sub_question_id → sub_questions.id ON DELETE CASCADE`
- `sub_question_tags (sub_question_id, tag_id)` 复合主键
- 所有 JSON 字段以 `*_json` 后缀命名；应用层负责 Zod 校验

### 5.3 错题本设计（快照 · 软引用）

为了让「删除作业」与「错题本保留」这两个生命周期互不干扰，`mistakes` 表采用**自包含快照**：

```sql
CREATE TABLE mistakes (
  id                      TEXT PRIMARY KEY,
  child_id                TEXT NOT NULL,
  source_sub_question_id  TEXT,            -- 软引用，无 FK
  source_assignment_id    TEXT,            -- 软引用，无 FK
  -- 快照字段（加入错题本时从 sub_question 复制）
  snapshot_crop_path           TEXT NOT NULL,  -- uploads/mistakes/<childId>/<mistakeId>.jpg
  snapshot_subject             TEXT NOT NULL,
  snapshot_parsed_stem_json    TEXT NOT NULL,
  snapshot_solution_steps_json TEXT NOT NULL,
  snapshot_final_answer        TEXT NOT NULL,
  snapshot_student_answer      TEXT,
  snapshot_error_type          TEXT,
  snapshot_explanation_md      TEXT NOT NULL,
  snapshot_knowledge_tags_json TEXT NOT NULL,  -- [{id,name,confidence}]
  -- 生命周期
  added_at    INTEGER NOT NULL,
  source      TEXT NOT NULL,          -- 'auto'|'manual'
  resolved    INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER,
  FOREIGN KEY (child_id) REFERENCES children(id)
);
```

关键点：
- 加入错题本时，应用层**复制裁剪图**到 `uploads/mistakes/<childId>/<mistakeId>.jpg`，并把 sub_question 的题面/解/讲解/标签复制到 snapshot_* 字段
- 因此删除作业（级联删 `sub_questions`）**不影响错题本**；错题本清理也不回撤作业
- `source_sub_question_id` / `source_assignment_id` 仅作调试线索，应用层不得依赖其存在

### 5.4 索引

```sql
idx_assignments_child  ON assignments(child_id, created_at DESC)
idx_mistakes_child     ON mistakes(child_id, added_at DESC)
idx_mistakes_source    ON mistakes(source_assignment_id)
idx_sub_tags_tag       ON sub_question_tags(tag_id)
idx_traces_assignment  ON workflow_traces(assignment_id)
idx_kt_subject         ON knowledge_tags(subject, parent_id)
idx_children_token     ON children(parent_token)
```

### 5.5 迁移策略

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

**契约权威来源：`docs/03-api-spec.md` §2（POST /api/wechat/webhook）与 §6（回推 `OPENCLAW_PUSHBACK_URL`）。** 本文不再重复字段定义，以防两处漂移。

要点：
- 入站与回推都使用 `X-OpenClaw-Secret`（共享密钥）；两侧相同环境变量 `OPENCLAW_WEBHOOK_SECRET`
- 入站图片以 **base64** 承载，时间戳**毫秒**
- 回推文本消息附**签名短链**：`/r/:shortId?t=<parent_token>&e=<expSec>&s=<signature>`，三件套**必须同时存在**，任一缺失即拒绝
  - `e`：签发时间 + `SHORT_LINK_TTL_MINUTES`（默认 15 分钟）后的 Unix 秒
  - `s`：`HMAC_SHA256(secret, shortId + '.' + parent_token + '.' + expSec)` 前 16 hex
  - 过期窗口内 cookie 一旦下发就走 30 天；过期后必须重新从微信进入
- 回推只承担"通知 + 链接"职能，不回传结果 JSON

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

## 10. 延迟预算（20 题数学试卷）

订阅模式下无按次计费，只跟踪延迟；订阅月费在产品文档层面核算。

| 阶段 | 耗时 |
|---|---|
| 预处理（Sharp） | 1-2s |
| 版面切题（Claude CLI · Vision） | 3-6s |
| 整题理解（Claude CLI · Vision，大题级并发） | 10-15s |
| 自解（Codex CLI，小题并发） | 8-14s |
| SymPy 验证 | <1s |
| 学生答案抽取（Claude CLI · Vision，机会性） | 4-8s |
| 讲解生成（Claude CLI，20 题） | 6-10s |
| 知识点打标 + 持久化 + 渲染 | 2s |
| **P50 合计** | **~35-45s** |

说明：
- CLI 子进程冷启动比 API 多 1-3s，因此整体放宽到 45s
- 产品侧可接受 P50 ≤ 45s / P90 ≤ 60s（与 `docs/01-product-design.md` §验收对齐）
- 如进程池预热到位、prompt 缓存命中稳定，实际可回落到 30s 量级

## 11. 可观测性

- 日志：Pino，结构化 JSON，写 `./data/logs/`
- Trace：每个节点执行写入 `workflow_traces` 表
- Debug 页面：`/debug/assignment/:id`（内网限制访问）查看工作流 trace
- 指标统计（简单）：
  - 每日作业数 / 成功率 / 平均耗时 / 失败率（**不记录成本**，订阅模式按月固定）
  - 通过 `/debug/stats` 页查看

## 12. 安全

- `/api/wechat/webhook` 需 `X-OpenClaw-Secret` 校验
- 外部访问只暴露**局域网**，不开公网端口
- **家长鉴权闭环**（V1）：
  - 每个 `children` 行首次创建时生成 `parent_token`（nanoid 24+，`pt_` 前缀）
  - 回推到微信的短链 `/r/:shortId?t=<parent_token>&e=<expSec>&s=<signature>` 承载凭据
    - 三参数**必须同时存在**，签名覆盖 `(shortId, parent_token, expSec)` 三项
    - 默认窗口 `SHORT_LINK_TTL_MINUTES=15`；过窗链接一律拒绝
  - 首次访问通过后写入 httpOnly cookie `hw_parent=<parent_token>`，`Max-Age` 由 `PARENT_COOKIE_MAX_AGE_DAYS`（默认 30 天）控制
  - `/mistakes`、`/api/assignment/**`、`/api/mistakes/**` 一律从 cookie 解析 `parent_token` → 反查 `children.id` → 仅允许访问该 child 自己的数据
  - 无 cookie / cookie 失效 / 短链过期 / 签名错 → 302 到 `/auth-required?reason=<...>` 提示页

- **短链威胁模型**（显式声明，不假装它比实际更强）：
  - `parent_token` 是 bearer 凭据：15 分钟窗口内持有链接的任何人都能通过
  - `hw_parent` cookie 也是 bearer：下发后 30 天内本机浏览器任何用户可访问
  - HMAC 只防篡改与枚举，**不防转发、不防截屏、不防重放**
  - V1 靠"仅内网暴露 + 15 分钟窗口"收敛风险；V1.1 计划改为一次性 code → cookie，消除长期 bearer
- 管理路由（`/debug/*`）加简单 basic auth（环境变量 `ADMIN_USER` / `ADMIN_PASS`）
- SQL 注入防护：全部使用 `better-sqlite3` prepared statements
- 上传图片校验 mime + 大小（≤ 20MB）
- **日志脱敏**：`parent_token`、webhook secret 不得落入日志；Pino 配置 redact 列表

## 13. 测试策略

- **单元**：Provider Adapter、DAG Runner、SQL 层、auth 签名/校验 → Vitest + mock
- **集成**：单节点工作流固定夹具测试 → 真实 CLI 调用（订阅模式无流量配额，但建议限频避免触发登录态速率）
- **鉴权回归**：A/B 两个 `parent_token` 互访应一律 403/404（单测 + E2E 各一份）
- **E2E**：选 5-10 张标准数学作业图作为回归集，覆盖「非目标题型正确降级为 unmarked」用例，每次发版手动跑

## 14. 版本路线图

| 版本 | 范围 |
|---|---|
| V1.0 | 数学 + 订阅模式 CLI（Claude+Codex）+ Win 本机 + 错题本（知识点+日期）|
| V1.1 | 家长反馈回流 few-shot；错题本"已掌握"管理 |
| V2.0 | 教材章节上传注入上下文；英语接入；Docker 打包 |
| V2.1 | 本地 VLM（学生答案抽取）；练习包生成 |
| V3.0 | 语文客观题；多孩子支持；数据导出 |
