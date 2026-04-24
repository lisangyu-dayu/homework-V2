# homework-V2 · TODO 清单

**优先级约定**：P0 = V1 必须；P1 = V1 最好；P2 = V2+

## Milestone M0 · 项目基础（1 天）

- [x] 建目录、根配置、scaffolding ← *本次已完成*
- [x] 写五份设计文档 ← *本次已完成*
- [x] 切换到订阅模式（Claude CLI + Codex CLI，对称）← *本次已完成*
- [x] 数据模型对齐：错题本快照、家长 parent_token、workflow_traces 移除费用字段 ← *本次已完成*
- [x] 鉴权闭环骨架（auth.ts + middleware + /r 短链接受 + /auth-required）← *本次已完成*
- [x] 安装依赖（`npm install`），跑通本地校验链（`test` / `typecheck` / `lint`）← *本次已完成*
- [ ] `.env.example` → `.env`，生成 `PARENT_LINK_SIGNING_SECRET`（≥ 32 字节随机串）
- [x] 本机 `codex login`；运行 `npm run check:cli` 通过 ← *本次已验证：Codex CLI 0.124.0，OAuth 登录态存在*
- [ ] 可选 Claude 兜底：本机 `claude login`；运行 `REQUIRE_CLAUDE_CLI=true npm run check:cli` 通过 ← *当前 Claude CLI 已安装但未登录*

## Milestone M1 · 数据层（1-2 天）· P0

- [x] 实现 `src/db/client.ts`（better-sqlite3 单例 + prepared statements）← *本次已完成*
- [x] 迁移脚本 `scripts/init-db.ts` 执行 `src/db/migrations/001_init.sql` ← *本次已完成*
- [x] 实现 `src/db/dao/` 各表 DAO：`assignments.ts` / `questions.ts` / `mistakes.ts` / `tags.ts` / `traces.ts` ← *本次已完成；`tags.ts` 已补齐 M2 所需的树查询、详情与检索能力*
- [x] 写 DAO 单元测试（vitest，每个 insert/select 至少一个样例）← *本次已完成*

## Milestone M2 · 知识点种子（1 天）· P0

- [x] 从公开"义务教育数学课程标准"提取 6-9 年级知识点树 ← *本次已完成：按 2022 版课标四大领域整理首版种子*
- [x] 用 Claude 辅助转成 JSON（放在 `data/knowledge-points/math.json`）← *本次已完成*
- [x] `scripts/seed-knowledge-points.ts` 导入到 SQLite ← *本次已完成：实跑导入 277 个节点*
- [ ] 人工抽查 30 条确认命名/层级合理
- [x] 目标：数学 ~300 个知识点节点 ← *本次已完成：首版自动展开后共 277 个节点，达到 V1 可用规模*

## Milestone M3 · Provider Adapter（3-4 天）· P0

两侧对称走 CLI 子进程（订阅模式），不使用 API Key。

- [x] `src/providers/types.ts` 接口定义 ← *scaffolding 已完成*
- [x] `src/providers/claude.ts`（CLI 子进程池）：
  - [x] spawn 策略：最小可运行 CLI 调用已接通 ← *本次已完成*
  - [x] `chat` / `vision` 实现（图片临时文件输入）← *本次已完成*
  - [x] 并发受控执行、超时、错误映射 ← *本次已完成*
  - [ ] 真正常驻热进程池
- [x] `src/providers/codex.ts`（CLI 子进程池，对称）：
  - [x] `chat` 最小可运行实现 ← *本次已完成*
  - [x] stdin/stdout JSON 解析、超时、错误码映射 ← *本次已完成*
  - [x] Router 对 `vision-not-supported` 自动降级 ← *本次已完成*
  - [x] **先实测 Codex CLI 视觉支持**（阻塞点）；不支持则 Router 不派发 vision ← *本次已完成：Codex CLI 支持 `exec --image`，Router 已切换为 Codex 优先*
  - [ ] 真正常驻热进程池
- [x] `src/providers/router.ts`：按 task + 环境变量覆盖选择（已有骨架）← *本次已完成*
- [x] 集成测试：补 provider 单测覆盖关键路径 ← *本次已完成；真实 CLI 联调仍待本机登录环境*

## Milestone M4 · DAG Runner（1-2 天）· P0

- [x] `src/workflow/dag.ts`：节点注册、依赖、并发、重试、fallback ← *本次已完成*
- [x] Trace 自动写 `workflow_traces` 表 ← *本次已完成*
- [x] 单测：mock 节点、验证调度顺序与失败策略 ← *本次已完成*

## Milestone M5 · 核心批改节点（4-6 天）· P0

按顺序依赖，逐个落：

- [x] `preprocess.ts`：Sharp deskew + 对比度增强 → *本次已完成：增加自动倾斜校正、对比度增强与落盘单测*
- [x] `layoutSplit.ts`：Claude Vision 解析页面结构（prompt 要含大题/小题编号识别指引） → *本次已完成：接入 Vision provider、编号识别 prompt 与失败回退*
  - [x] 定义 LayoutSplitSchema（Zod） → *本次已完成*
  - [x] 输出裁剪 bbox → *本次已完成：输出真实像素 bbox，并支持从分析尺寸缩放回原图*
- [x] `parseQuestion.ts`：Claude Vision 结构化 JSON 输出 → *本次已完成：子题裁图、Vision 结构化解析与单题失败降级*
  - [x] 定义 ParsedMathQuestion schema（见技术设计方案 §7） → *本次已完成*
  - [x] "Self-describe then self-solve" 两步拆分 → *本次已完成：parseQuestion 仅做题面描述，不在本节点求解*
- [x] `selfSolve.ts`：Codex 优先 + Claude 兜底 → *本次已完成：接入主/备 provider 求解与失败占位降级*
  - [x] 强制 CoT 输出 → *本次已完成：输出面向展示的结构化求解步骤 steps*
  - [x] JSON 格式化的 steps + finalAnswer → *本次已完成*
- [x] `verify.ts`：SymPy 等价验证 → *本次已完成：接入多轮表达式比对与跳过/冲突标注*
  - [x] 处理"表达式 vs 数值"两种等价 → *本次已完成*
  - [x] 不一致时标注冲突 → *本次已完成*
- [x] `extractStudentAnswer.ts`：Claude Vision 机会性抽取 → *本次已完成：Vision 抽取学生作答，允许 `"unclear"`，低置信直接置空*
  - [x] 明确 prompt 允许返回 `"unclear"`
  - [x] 低置信直接跳过
- [x] `grade.ts`：代码规则聚合判定（三状态，但无 ⚠）→ *本次已完成：聚合学生答案、参考解、verify 结果，仅输出 correct/wrong/unmarked*
- [x] `generateExplanation.ts`：Claude 生成 Markdown + LaTeX 讲解 → *本次已完成：Provider 生成 JSON 讲解，失败时规则兜底*
  - [x] 面向家长/学生的文风
  - [x] 错题额外输出 `errorType`
- [x] `kpTagging.ts`：KnowledgePoints MCP 召回 + LLM 精排 → *本次已完成：DAO 召回候选，Provider 精排，失败时确定性排序*
- [x] `persist.ts`：批量写入 SQLite + 图片落盘 `uploads/` → *本次已完成：沿用裁剪图落盘并批量写入 major/sub/tag 数据*
- [x] `render.ts`：生成 shortId，返回 URL → *本次已完成*

## Milestone M6 · SymPy MCP（1 天）· P0

- [x] `scripts/sympy_runner.py`：JSON stdin → JSON stdout 子进程
  - [x] 接口：`solve` / `simplify` / `equivalent` ← *本次已完成*
  - [x] 支持中文 → LaTeX 归一化 ← *本次已完成：支持全角/中文符号、常见中文答案前缀、平方/根号、LaTeX 分式/根号归一化*
- [x] `src/mcp/sympy.ts`：TS 侧包装子进程 ← *本次已完成*
- [x] 样例集：10 道典型数学题的等价判定用例 ← *本次已完成：补充 12 个正例与 3 个反例，覆盖分式、方程答案、全角符号、中文根号/平方与 LaTeX*

## Milestone M7 · 微信入口 + 鉴权（1-2 天）· P0

- [x] `app/api/wechat/webhook/route.ts`：接收消息 + `X-OpenClaw-Secret` 鉴权 ← *本次已完成*
- [x] 首次消息时调 `findOrCreateByOpenId` 生成 `parent_token` ← *本次已完成*
- [x] `src/lib/auth.ts`：signShortLink / verifyShortLink / buildShortLinkUrl / acceptShortLink ← *本次已完成*
- [x] `middleware.ts`：cookie 存在性守卫 → 受保护路由 ← *本次已完成*
- [x] `/r/:shortId`：短链首次进入校验签名 → 写 cookie → 302 ← *本次已完成*
- [x] `/auth-required` 提示页 ← *本次已完成*
- [x] `src/wechat/openclawAdapter.ts`：`pushBackAssignmentDone` 使用 `buildShortLinkUrl` ← *本次已完成*
- [x] 异步任务：worker 调用 AssignmentWorkflow ← *本次已完成：webhook 落库后拉起独立 worker 进程执行工作流*
- [x] 占位回复（"正在批改中…"）实现 ← *本次已完成*
- [x] 集成测试：模拟 webhook → 触发工作流 → 验证 cookie 下发 / 跨 child 访问被 404 ← *本次已完成*

## Milestone M8 · 结果页 + 错题本页（2-3 天）· P0

- [x] `app/layout.tsx`：全局样式、字体 ← *本次已完成*
- [x] `app/r/[shortId]/page.tsx`：大题-小题层级 SSR 渲染（鉴权已就绪，补数据层）← *最小可用版已完成*
  - [x] LaTeX 渲染：`katex`（轻量，纯 CSS + 一次 JS）← *本次已完成*
  - [x] 图片懒加载 ← *本次已完成*
  - [x] 校验 `assignment.childId === cookieChild.id`，否则 404 ← *本次已完成*
  - [x] "加入错题本" / "批改有误" 按钮（Server Actions）← *本次已完成*
- [x] `app/mistakes/page.tsx`：
  - [x] 默认时间轴（读 `mistakes.snapshot_*` 列，不 JOIN sub_questions）← *本次已完成*
  - [x] 基础筛选（tag / resolved / 时间参数）← *本次已完成*
  - [x] 薄弱点 Top 5 卡片 ← *本次已完成*
- [x] API Routes（child 作用域由 cookie 推导）：
  - [x] `GET /api/assignment/:id`、`DELETE /api/assignment/:id` ← *本次已完成*
  - [x] `GET /api/mistakes`、`POST /api/mistakes`（复制快照 + 复制图）← *本次已完成；`GET /api/mistakes` 已补稳定复合游标分页（`addedAt + id`）*
  - [x] `PATCH /api/mistakes/:id`、`DELETE /api/mistakes/:id`、`GET /api/mistakes/weak-points` ← *本次已完成*
  - [x] `POST /api/feedback` ← *本次已完成*
  - [x] 图片静态托管：`/uploads/*` 路由（Next.js 自定义；`/uploads/mistakes/<childId>/...` 需 cookie 校验）← *本次已完成；作业裁剪图同样收口到受保护路由*

## Milestone M9 · 调试页（1 天）· P1

- [ ] `/debug/assignment/:id` Trace 页
- [ ] `/debug/stats` 日统计
- [ ] Basic Auth 中间件

## Milestone M10 · 测试与发布（1-2 天）· P0

- [ ] 准备 5-10 张真实数学作业图作为回归集（`tests/fixtures/`）
  - 覆盖：计算/解方程、选择、填空、应用题、函数、几何计算、**至少 1 道几何证明以验证正确降级为 unmarked**
- [ ] E2E 手动跑：验收指标对齐（01-产品方案 §10）
  - P50 ≤ 45s / P90 ≤ 60s
  - 非目标题型 0 误判（不应出现 ✓/✗）
- [x] 鉴权回归：从 A 家长 cookie 请求 B 家长的 shortId / mistakeId → 均应 403/404 ← *本次已完成：补 M10 auth-regression 单测覆盖结果页 shortId 与错题 API mistakeId 越权均 404*
- [x] PM2/systemd/supervisor 开机自启任选其一 ← *本次已完成：补 `ecosystem.config.cjs` 与 npm PM2 脚本；实际开机自启按 WSL 机器执行 `pm2 startup`*
- [ ] 内网访问验证：局域网 IP + 端口

## P1 · V1 上线后迭代（~1 周）

- [ ] 家长反馈回流：同学科 few-shot 注入
- [ ] 错题本"已掌握"追踪 + 重复出现提醒
- [ ] 每日统计自动生成报表页
- [ ] 失败作业的人工补救路径（重新上传替换）

## P2 · V2 规划（~2 周）

- [ ] 教材章节上传 + 上下文注入
- [ ] 英语（语法/填空/选择）接入
- [ ] Docker/NAS 迁移打包
- [ ] 练习包生成（基于错题本变式）

## P2+ · V3 规划

- [ ] 本地 Qwen2.5-VL-7B 用于学生答案抽取（降成本）
- [ ] 语文客观题（字词/拼音/默写）
- [ ] 多孩子支持（含数据迁移）
- [ ] 错题本导出 PDF / 打印
- [ ] Embedding 向量检索替代关键词召回

## 阻塞点 / 风险

- ⚠ **Codex CLI 视觉支持与输出格式**：M3 前必须验证，若不支持视觉则 Router 调整为 Claude 独揽视觉
- ⚠ **Claude Code CLI `--output-format stream-json` 的实际分帧/错误行为**：M3 前实测一版，固化 parser
- ⚠ **订阅模式登录态稳定性**：`~/.claude` `~/.codex` 令牌过期时 CLI 表现需验证；需加定期 `claude doctor` 心跳
- ⚠ **Claude Vision 对中文几何图/手写混排的稳定性**：M5 前需 10-20 张样本实测
- ⚠ **SymPy 对中学几何题（含辅助线、证明）支持有限**：几何证明 V1 明确列为非目标（见产品方案 §2.1），不纳入批改
- ⚠ **家长反馈成为误导**：一次错点反馈不该立即 few-shot，需攒阈值

## 里程碑时间表（估）

| Milestone | 预估工时 | 累计 |
|---|---|---|
| M0 | 1 d | 1 |
| M1 | 2 d | 3 |
| M2 | 1 d | 4 |
| M3 | 4 d | 8 |
| M4 | 2 d | 10 |
| M5 | 6 d | 16 |
| M6 | 1 d | 17 |
| M7 | 2 d | 19 |
| M8 | 3 d | 22 |
| M9 | 1 d | 23 |
| M10 | 2 d | **25 d** |

V1 全开发周期预计 **5 周（含调试/迭代）**。M3、M7 因切换到 CLI 子进程 + 鉴权闭环各加一天。
