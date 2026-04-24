# homework-V2 · AI 家教

面向 6-9 年级**家长**的拍照批改/讲解工具。V1 聚焦**数学**。

## 特性（V1）

- 微信入口（经 OpenClaw 插件转发）
- 拍照上传作业图 → 切题 → 整题理解（含图表）→ 自解 → 交叉验证 → 讲解
- 学生答案机会性识别：能对就对，不能对就"跳过"（不硬判）
- 结果以**大题 → 小题**层级渲染成 HTML 页（局域网访问）
- 错题本按**知识点 + 日期**归类

## 技术栈

- Next.js 15 (App Router, SSR)
- TypeScript strict
- SQLite (better-sqlite3)
- Claude Code CLI + Codex CLI（对称 Provider Adapter · **订阅模式，不用 API Key**）
- SymPy MCP（数学等价验证）
- 部署：WSL/Ubuntu 本机服务（4090 主机常开）

## 快速开始

```bash
# 1) 本机先登录 Codex CLI（订阅模式的必要步骤）
codex login
# 可选：启用 Claude 兜底前再登录
claude login

# 2) 配置
cp .env.example .env
# 编辑 .env：生成 PARENT_LINK_SIGNING_SECRET（≥32 字节随机），填写 ADMIN_USER/PASS、OPENCLAW_*

# 3) 启动
npm install
npm run check:cli      # 验证 Codex CLI 可用
# 可选：同时验证 Claude 兜底登录态
REQUIRE_CLAUDE_CLI=true npm run check:cli
npm run db:init
npm run db:seed-kp
npm run dev
# 访问 http://localhost:3100
```

## WSL 生产运行

```bash
npm run build
npm run pm2:start
pm2 save
```

服务监听 `0.0.0.0:3100`。需要开机自启时，在 WSL 内按 PM2 输出执行 `pm2 startup` 对应命令。

## 文档

- [产品方案](docs/01-product-design.md)
- [技术设计方案](docs/02-tech-design.md)
- [API 列表](docs/03-api-spec.md)
- [TODO 清单](docs/04-todo-list.md)
- [开发规约](docs/05-dev-conventions.md)

## 目录结构

```
homework-V2/
├── app/              Next.js (App Router) · 页面 + API Route
├── src/
│   ├── workflow/     业务 DAG（纯 TS，编排核心）
│   ├── providers/    LLM Provider Adapter（Claude CLI + Codex CLI）
│   ├── mcp/          MCP 客户端（SymPy、Knowledge-Points 等）
│   ├── db/           SQLite schema + client
│   ├── wechat/       OpenClaw 插件消息协议适配
│   └── lib/          config / logger / types
├── scripts/          初始化/运维脚本
├── data/             本地数据（DB + 知识点种子）
├── uploads/          图片暂存
├── tests/            Vitest 单元/集成测试
└── docs/             设计文档
```

## 与 OpenClaw 的关系

OpenClaw 仅保留为**微信↔本服务的消息中继**（插件模式，老项目已实现）。业务编排、模型路由、MCP 调用全部在本服务的 TS 代码里自建。详见 [技术设计方案](docs/02-tech-design.md#openclaw-定位)。
