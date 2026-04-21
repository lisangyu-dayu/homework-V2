# homework-V2 · 开发规约

## 1. 技术栈锁定

- **Node**：≥ 20.10
- **TypeScript**：≥ 5.6，strict、`noUncheckedIndexedAccess` 开启
- **Next.js**：15.x，App Router（不写 Pages Router）
- **DB**：SQLite via `better-sqlite3`（同步 API、性能好）
- **运行时**：Windows 10/11，4090
- **Python**：3.10+（用于 SymPy 子进程）

## 2. 代码组织

### 2.1 模块边界

```
app/       只放 UI + API Route 薄层；业务逻辑一律引 src/
src/       所有业务；不感知 Next.js（可被 CLI/脚本复用）
scripts/   CLI 脚本；通过 tsx 直接跑
tests/     Vitest 测试
```

### 2.2 导入别名

- `@/…` → `src/`
- `@app/…` → `app/`

**禁止**：从 `src/` 反向引 `app/` 或 `next/*`。

### 2.3 文件命名

- 文件：`camelCase.ts`（节点、模块）/ `PascalCase.tsx`（React 组件）
- 类型：`PascalCase`；接口不加 `I` 前缀
- 常量：`UPPER_SNAKE_CASE`
- 导出优先 named；一个文件一个主导出

## 3. 风格

### 3.1 TypeScript

- **禁止** `any`；不得已用 `unknown` + 缩窄
- **禁止** 非空断言 `!`；用 `if/?.` 兜底
- 函数参数 ≥ 3 个改用 options 对象
- 返回类型**显式**标注（对外模块必需）
- 异步函数用 `async/await`，禁 `.then()` 链

### 3.2 错误处理

- 用户输入错 → `throw new ValidationError(...)`（见 `src/lib/errors.ts`）
- 上游调用失 → `throw new UpstreamError('claude', cause)`
- **绝不 swallow**：`try { ... } catch {}` 只允许在节点失败→`fallback` 的场景，且必须写 trace
- Next.js API 路由统一用 `withErrorHandler(handler)` 包裹

### 3.3 日志

- 只用 `@/lib/logger`（Pino 单例）
- 日志级别：
  - `debug`：开发态详情
  - `info`：请求进出、节点开始/结束
  - `warn`：降级、回退、部分失败
  - `error`：外部调用失败、数据库错、未捕获异常
- **不**打印 PII（openId 脱敏后打）
- **不**打印完整大 prompt / 完整图片 base64（只记 hash 和长度）

## 4. LLM 调用规范

### 4.1 必须通过 Provider Adapter

```ts
// ❌ 禁止直接
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic(...);

// ✅ 正确
import { pickProvider } from '@/providers/router';
const provider = pickProvider({ task: 'vision' });
const resp = await provider.vision({ ... });
```

### 4.2 Prompt 组织

- Prompt 模板放 `src/workflow/prompts/`（每个节点一个文件）
- 模板函数签名：`(input: T) => { system: string; user: string }`
- **禁止** 在业务代码里硬编码长 prompt 字符串

### 4.3 结构化输出

- 所有 LLM 输出**必须** Zod 校验
- 节点文件：
  1. 定义 Zod schema
  2. 调 provider
  3. `schema.parse(response)`
  4. 失败 → 重试（最多 2 次）→ 再失败 → 节点降级

## 5. 数据库规范

### 5.1 访问

- **禁止** 在业务代码里写 `db.prepare(SQL)`；全部过 DAO（`src/db/dao/*.ts`）
- Prepared statements **必须**缓存（模块级 `const stmt = db.prepare(...)`）
- 事务：用 `db.transaction(fn)`；跨多表写一定开事务

### 5.2 Schema 变更

- 改 schema → 新建 `src/db/migrations/NNN_xxx.sql`
- **不改旧迁移**；只新增
- `scripts/init-db.ts` 按顺序应用，幂等

### 5.3 字段规范

- 主键统一 `TEXT` + `nanoid()`
- 时间戳统一 `INTEGER`（ms）
- JSON 字段命名后缀 `_json`，TS 侧 `JSON.parse` 前过 Zod
- 索引显式声明，取最常见的查询模式

## 6. 前端组件

### 6.1 结构

- 页面：`app/**/page.tsx`（Server Component 默认）
- 交互组件：`app/_components/*.tsx`；用 `'use client'`
- 共享组件：`app/_components/ui/*.tsx`

### 6.2 样式

- CSS Modules（`.module.css`）
- 全局样式只有 `app/globals.css`（重置 + 基础排版）
- **不**引入 Tailwind / styled-components（V1 不需要）

### 6.3 数据获取

- SSR 页面直接在 Server Component 里调 DAO
- 客户端交互通过 Server Actions 或 API Routes
- **禁止** SWR/React Query（V1 复杂度不需要）

## 7. Git 规约

### 7.1 分支

- `main`：受保护，只接 PR
- 功能分支：`feat/<milestone>-<short>`，如 `feat/m5-parse-question`
- 修 bug：`fix/<area>-<short>`

### 7.2 Commit Message

**格式**：`<type>: <短描述>`

type 取值：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`

**Subject 内容**：讲"为什么"优于"做了什么"；代码 diff 会讲"what"。

**示例**：
```
feat: parseQuestion 拆成 describe + solve 两步降低视觉幻觉
fix: Codex CLI 子进程崩溃后未重启导致后续请求 hang
docs: 补充 M3 Codex 视觉支持的阻塞点
```

### 7.3 PR

- 标题同 commit
- 描述必含：
  - 背景（解决什么）
  - 主要改动点
  - 如何验证（命令/截图）
- 挂对应 Milestone label

## 8. 测试

### 8.1 分层

| 层 | 工具 | 位置 | 覆盖率目标 |
|---|---|---|---|
| 单元 | Vitest | `tests/unit/` | 纯函数 80%+ |
| 集成 | Vitest + 真实 DB | `tests/integration/` | 关键路径 |
| E2E | 手动 + 回归集 | `tests/fixtures/` | 每次发版前 |

### 8.2 约定

- 单测文件：`xxx.test.ts` 放 `tests/unit` 镜像目录
- 禁用 `--update-snapshots` 之外的自动快照更新
- Fixture 图片不入 Git LFS；≤ 2MB/张

## 9. 安全

- `.env` 入 `.gitignore`，**绝不**提交
- API Key 只从 `process.env` 读；启动时校验缺失即早失败
- 所有外部输入（微信 payload、URL 参数）经 Zod 校验
- SQL 只用 prepared statements；**禁止**字符串拼接
- 图片上传：白名单 mime + 头 magic byte 校验 + 大小 ≤ 20MB

## 10. 性能

- 启动 **冷启动 ≤ 3s**（Next build 后）
- 单份作业端到端 **P50 ≤ 35s**
- SQLite 开启 WAL（`PRAGMA journal_mode=WAL`）
- 大题级并发默认 4，从 `WORKFLOW_CONCURRENCY` 调

## 11. 代码审查清单（自查）

- [ ] 变更点是否在 Milestone 范围？越界先开 issue
- [ ] 新增的 prompt 是否放到 `prompts/`？是否做了 Zod 校验？
- [ ] 新增的 SQL 是否走 DAO？是否加索引？
- [ ] 是否打印了敏感信息？
- [ ] 是否引入了新依赖？该依赖体积/维护度/许可是否 OK？
- [ ] 失败路径是否有 trace / log？
- [ ] 是否更新了 `04-todo-list.md`？

## 12. 禁止事项

- ❌ **禁止** 直接用 OpenClaw 工作流编排业务（OpenClaw 只做消息中继）
- ❌ **禁止** 在 LLM 输出对错判定后直接信任（必须代码/SymPy 交叉）
- ❌ **禁止** 向家长展示"AI 不确定"的含糊态（只有 ✓ / ✗ / —）
- ❌ **禁止** 写"TODO: will handle later"而不建 issue
- ❌ **禁止** 在图片上传路径使用原始文件名（用 nanoid 重命名防冲突/注入）
- ❌ **禁止** 写 multi-paragraph docstrings；单行注释只解释"why"

## 13. 文档维护

- 设计文档变化 → 同时改 `docs/` 对应文件
- API 变更 → 先改 `docs/03-api-spec.md` 再写代码
- TODO 打勾 → PR 里改 `docs/04-todo-list.md`
