# homework-V2 · TODO 清单

**优先级约定**：P0 = V1 必须；P1 = V1 最好；P2 = V2+

## Milestone M0 · 项目基础（1 天）

- [x] 建目录、根配置、scaffolding ← *本次已完成*
- [x] 写五份设计文档 ← *本次已完成*
- [ ] 安装依赖（`npm install`），跑通 `next dev`
- [ ] `.env.example` → `.env`，填入 `ANTHROPIC_API_KEY`
- [ ] 本机验证 `codex --version` 可执行

## Milestone M1 · 数据层（1-2 天）· P0

- [ ] 实现 `src/db/client.ts`（better-sqlite3 单例 + prepared statements）
- [ ] 迁移脚本 `scripts/init-db.ts` 执行 `src/db/migrations/001_init.sql`
- [ ] 实现 `src/db/dao/` 各表 DAO：`assignments.ts` / `questions.ts` / `mistakes.ts` / `tags.ts` / `traces.ts`
- [ ] 写 DAO 单元测试（vitest，每个 insert/select 至少一个样例）

## Milestone M2 · 知识点种子（1 天）· P0

- [ ] 从公开"义务教育数学课程标准"提取 6-9 年级知识点树
- [ ] 用 Claude 辅助转成 JSON（放在 `data/knowledge-points/math.json`）
- [ ] `scripts/seed-knowledge-points.ts` 导入到 SQLite
- [ ] 人工抽查 30 条确认命名/层级合理
- [ ] 目标：数学 ~300 个知识点节点

## Milestone M3 · Provider Adapter（2-3 天）· P0

- [ ] `src/providers/types.ts` 接口定义
- [ ] `src/providers/claude.ts`：
  - [ ] `chat` / `vision` 实现
  - [ ] prompt caching（`cache_control`）
  - [ ] 重试（指数退避）+ 超时
  - [ ] 费用记录（从响应 usage 提取）
- [ ] `src/providers/codex.ts`：
  - [ ] 子进程池（大小从环境变量）
  - [ ] stdin/stdout JSON 协议
  - [ ] 健康检查 + 自动重启
  - [ ] 超时 + SIGKILL
  - [ ] 错误码映射
  - [ ] **需先验证 Codex CLI 的实际输出格式和视觉支持**（阻塞点）
- [ ] `src/providers/router.ts`：按 task + 环境变量覆盖选择
- [ ] 集成测试：用简短 prompt 分别调通 Claude / Codex

## Milestone M4 · DAG Runner（1-2 天）· P0

- [ ] `src/workflow/dag.ts`：节点注册、依赖、并发、重试、fallback
- [ ] Trace 自动写 `workflow_traces` 表
- [ ] 单测：mock 节点、验证调度顺序与失败策略

## Milestone M5 · 核心批改节点（4-6 天）· P0

按顺序依赖，逐个落：

- [ ] `preprocess.ts`：Sharp deskew + 对比度增强
- [ ] `layoutSplit.ts`：Claude Vision 解析页面结构（prompt 要含大题/小题编号识别指引）
  - [ ] 定义 LayoutSplitSchema（Zod）
  - [ ] 输出裁剪 bbox
- [ ] `parseQuestion.ts`：Claude Vision 结构化 JSON 输出
  - [ ] 定义 ParsedMathQuestion schema（见技术设计方案 §7）
  - [ ] "Self-describe then self-solve" 两步拆分
- [ ] `selfSolve.ts`：Codex 优先 + Claude 兜底
  - [ ] 强制 CoT 输出
  - [ ] JSON 格式化的 steps + finalAnswer
- [ ] `verify.ts`：SymPy 等价验证
  - [ ] 处理"表达式 vs 数值"两种等价
  - [ ] 不一致时标注冲突
- [ ] `extractStudentAnswer.ts`：Claude Vision 机会性抽取
  - [ ] 明确 prompt 允许返回 `"unclear"`
  - [ ] 低置信直接跳过
- [ ] `grade.ts`：代码规则聚合判定（三状态，但无 ⚠）
- [ ] `generateExplanation.ts`：Claude 生成 Markdown + LaTeX 讲解
  - [ ] 面向家长/学生的文风
  - [ ] 错题额外输出 `errorType`
- [ ] `kpTagging.ts`：KnowledgePoints MCP 召回 + LLM 精排
- [ ] `persist.ts`：批量写入 SQLite + 图片落盘 `uploads/`
- [ ] `render.ts`：生成 shortId，返回 URL

## Milestone M6 · SymPy MCP（1 天）· P0

- [ ] `scripts/sympy_runner.py`：JSON stdin → JSON stdout 子进程
  - [ ] 接口：`solve` / `simplify` / `equivalent`
  - [ ] 支持中文 → LaTeX 归一化
- [ ] `src/mcp/sympy.ts`：TS 侧包装子进程
- [ ] 样例集：10 道典型数学题的等价判定用例

## Milestone M7 · 微信入口（1 天）· P0

- [ ] `app/api/wechat/webhook/route.ts`：接收消息 + 鉴权
- [ ] `src/wechat/openclawAdapter.ts`：回推短链
- [ ] 异步任务：worker 调用 AssignmentWorkflow
- [ ] 占位回复（"正在批改中…"）实现

## Milestone M8 · 结果页 + 错题本页（2-3 天）· P0

- [ ] `app/layout.tsx`：全局样式、字体
- [ ] `app/r/[shortId]/page.tsx`：大题-小题层级 SSR 渲染
  - [ ] LaTeX 渲染：`katex`（轻量，纯 CSS + 一次 JS）
  - [ ] 图片懒加载
  - [ ] "加入错题本" / "批改有误" 按钮（Server Actions）
- [ ] `app/mistakes/page.tsx`：
  - [ ] 默认时间轴
  - [ ] 筛选条（知识点多选、日期范围、已掌握切换）
  - [ ] 薄弱点 Top 5 卡片
- [ ] API Routes：`assignment/:id` `mistakes/:childId` `feedback` `mistakes/:id PATCH`
- [ ] 图片静态托管：`/uploads/*` 路由（Next.js 自定义）

## Milestone M9 · 调试页（1 天）· P1

- [ ] `/debug/assignment/:id` Trace 页
- [ ] `/debug/stats` 日统计
- [ ] Basic Auth 中间件

## Milestone M10 · 测试与发布（1-2 天）· P0

- [ ] 准备 5-10 张真实数学作业图作为回归集（`tests/fixtures/`）
- [ ] E2E 手动跑：验收指标对齐（01-产品方案 §10）
- [ ] PM2 开机自启 / nssm Windows 服务任选其一
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
- ⚠ **Claude Vision 对中文几何图/手写混排的稳定性**：M5 前需 10-20 张样本实测
- ⚠ **SymPy 对中学几何题（含辅助线、证明）支持有限**：M6 接入后，证明题可能默认标"未批改"
- ⚠ **家长反馈成为误导**：一次错点反馈不该立即 few-shot，需攒阈值

## 里程碑时间表（估）

| Milestone | 预估工时 | 累计 |
|---|---|---|
| M0 | 1 d | 1 |
| M1 | 2 d | 3 |
| M2 | 1 d | 4 |
| M3 | 3 d | 7 |
| M4 | 2 d | 9 |
| M5 | 6 d | 15 |
| M6 | 1 d | 16 |
| M7 | 1 d | 17 |
| M8 | 3 d | 20 |
| M9 | 1 d | 21 |
| M10 | 2 d | **23 d** |

V1 全开发周期预计 **4-5 周（含调试/迭代）**。
