# homework-V2 · API 列表

所有 HTTP 接口由 Next.js App Router 提供（`app/api/**`）。
- 默认监听 `0.0.0.0:3100`
- 内部接口无对外暴露，仅局域网
- 日期/时间戳：Unix milliseconds

## 约定

- 请求/响应 Content-Type：`application/json`（除上传）
- 鉴权：
  - `/api/wechat/**` → 头 `X-OpenClaw-Secret`（共享密钥）
  - `/debug/**` → Basic Auth（`ADMIN_USER` / `ADMIN_PASS`）
  - `/api/assignment/**`、`/api/mistakes/**`、`/api/feedback`、页面 `/r/:shortId` 与 `/mistakes` →
    **Cookie `hw_parent=<parent_token>`**
    - 首次由 `/r/:shortId?t=<parent_token>&e=<expSec>&s=<signature>` 设入（三件套**必须同时存在**，缺一即拒）
    - 中间件从 cookie 解析 → 反查 `children.id` → 仅放行该 child 的数据
    - 无 cookie / cookie 失效 / 短链过期 / 签名错 → 302 到 `/auth-required?reason=<...>`
  - `/api/knowledge-tags/**` → 局域网只读，无鉴权
- 错误响应：
  ```json
  { "ok": false, "error": { "code": "X_CODE", "message": "..." } }
  ```
- 成功响应均含 `"ok": true`

## 1. 微信入口

### 1.1 接收微信消息

```
POST /api/wechat/webhook
Headers:
  X-OpenClaw-Secret: <shared>
Body:
{
  "openId": "o_xxxxxxx",
  "messageType": "image",              // "image" | "text"
  "imageBase64": "<base64>",           // 仅 image
  "text": "…",                          // 仅 text（保留，V1 仅图）
  "timestamp": 1713654321000
}

Response 202:
{
  "ok": true,
  "assignmentId": "as_abc123",
  "estimateSeconds": 35
}
```

**副作用**：
1. 创建 `assignments` 行，`status=processing`
2. 异步触发 `AssignmentWorkflow`
3. 工作流完成后调用 OpenClaw 推回短链

### 1.2 回推（本服务 → OpenClaw 插件）

```
POST ${OPENCLAW_PUSHBACK_URL}
Headers:
  X-OpenClaw-Secret: <shared>                        // 与入站同一个 secret，便于运维
Body:
{
  "openId": "o_xxxxxxx",
  "messageType": "text",
  "text": "批改完成\n查看结果：http://192.168.1.100:3100/r/abc123?t=pt_xxxxxxxxxxxxxxxxxxxxxxx&e=1713655200&s=a1b2c3d4e5f6a7b8"
}
```

短链参数契约（三件套，**必须同时存在**，任一缺失或签名/过期失败即 302 到 `/auth-required`）：
- `abc123` = `assignments.short_id`
- `t` = 该 child 的 `parent_token`
- `e` = 过期 Unix 秒（签发时间 + `SHORT_LINK_TTL_MINUTES`，默认 15 分钟）
- `s` = `HMAC_SHA256(PARENT_LINK_SIGNING_SECRET, shortId + '.' + t + '.' + e)` 前 16 hex

URL 不含作业内容；但**短链在 15 分钟窗口内就是 bearer 凭据**，窗口期内持有者即可访问该 child 的全部资料——
请勿把短链转发给家长本人以外的人。详细威胁模型见 `docs/01-product-design.md §8.1`。

## 2. 作业（Assignment）

### 2.1 查询单份作业

```
GET /api/assignment/:id

Response 200:
{
  "ok": true,
  "assignment": {
    "id": "as_abc123",
    "shortId": "abc123",
    "childId": "ch_xxx",
    "subject": "math",
    "status": "done",
    "createdAt": 1713654321000,
    "completedAt": 1713654351000,
    "stats": { "total": 23, "correct": 18, "wrong": 3, "unmarked": 2 },
    "majorQuestions": [
      {
        "id": "mq_1",
        "number": "一",
        "orderIndex": 0,
        "stem": null,
        "subQuestions": [
          {
            "id": "sq_1_1",
            "number": "(1)",
            "cropUrl": "/uploads/as_abc123/sq_1_1.jpg",
            "parsedStem": { /* ParsedMathQuestion */ },
            "solutionSteps": [ { "text": "...", "formula": "x^2+..." } ],
            "finalAnswer": "x=2 或 x=-1",
            "confidence": 0.92,
            "verdict": "wrong",              // "correct" | "wrong" | "unmarked"
            "studentAnswer": "x=2",
            "errorType": "漏解",
            "explanationMd": "这道题…",
            "knowledgeTags": [
              { "id": "kt_123", "name": "一元二次方程", "confidence": 0.95 }
            ]
          }
        ]
      }
    ]
  }
}
```

### 2.2 作业列表（当前 child）

```
GET /api/assignment?limit=20&cursor=<ts>

（childId 由 cookie `hw_parent` 推导，不接受请求端传入——防止跨 child 越权）

Response 200:
{
  "ok": true,
  "items": [{ "id": "...", "shortId": "...", "createdAt": ..., "stats": {...} }],
  "nextCursor": 1713500000000 | null
}
```

### 2.3 删除作业

```
DELETE /api/assignment/:id

Response 200: { "ok": true }
```

语义：
- 鉴权：cookie `hw_parent` 必须映射到该作业的 `child_id`
- 级联删除：`major_questions` + `sub_questions` + `feedback`（全部 ON DELETE CASCADE）+ `uploads/<assignmentId>/` 目录下裁剪图与原图
- **错题本不受影响**：`mistakes` 采用自包含快照（见 `docs/02-tech-design.md` §5.3）；快照图位于 `uploads/mistakes/<childId>/<mistakeId>.jpg`，与作业侧文件独立
- `mistakes.source_sub_question_id` / `mistakes.source_assignment_id` 是软引用，删除作业后其值保留但不再可解引用——UI 上显示为"原作业已删除"

## 3. 错题本（Mistakes）

### 3.1 查询错题列表

```
GET /api/mistakes
  ?tags=kt_123,kt_456        // 知识点筛选（AND）
  &from=<ts>&to=<ts>          // 日期范围（added_at）
  &resolved=0|1               // 是否已掌握
  &limit=50&cursor=<ts>

（childId 由 cookie `hw_parent` 推导，不在 query）

Response 200:
{
  "ok": true,
  "items": [
    {
      "mistakeId": "mk_xxx",
      "sourceSubQuestionId": "sq_1_1",    // 软引用，可能已失效
      "sourceAssignmentId": "as_abc123",  // 软引用，可能已失效
      "addedAt": 1713654321000,
      "resolved": 0,
      "source": "auto",
      "subject": "math",
      "cropUrl": "/uploads/mistakes/ch_xxx/mk_xxx.jpg",
      "finalAnswer": "x=2 或 x=-1",
      "studentAnswer": "x=2",
      "errorType": "漏解",
      "explanationMd": "...",
      "knowledgeTags": [{ "id": "kt_123", "name": "一元二次方程", "confidence": 0.95 }]
    }
  ],
  "nextCursor": null,
  "summary": {
    "total": 42,
    "byTag": [
      { "tagId": "kt_123", "name": "一元二次方程", "count": 12 },
      { "tagId": "kt_234", "name": "二次函数",     "count": 8  }
    ]
  }
}
```

所有返回字段均读自 `mistakes.snapshot_*` 列，不 JOIN `sub_questions`。

### 3.2 加入错题本

```
POST /api/mistakes
Body:
{ "subQuestionId": "sq_1_1", "source": "manual" }

Response 200:
{ "ok": true, "mistakeId": "mk_xxx" }
```

语义：
- `childId` 由 cookie 推导，不接受请求体传入
- 服务端从 `sub_questions` 取该小题所有字段，**复制**到 `mistakes` 行的 `snapshot_*` 列，裁剪图复制到 `uploads/mistakes/<childId>/<mistakeId>.jpg`
- `source=auto` 由工作流批改结束、`verdict=wrong` 时写入；`source=manual` 由家长在结果页点击"加入错题本"时写入

### 3.3 标记已掌握 / 取消

```
PATCH /api/mistakes/:mistakeId
Body: { "resolved": true | false }

Response 200: { "ok": true }
```

### 3.4 删除错题

```
DELETE /api/mistakes/:mistakeId
Response 200: { "ok": true }
```

（物理删除行 + 删除 `uploads/mistakes/<childId>/<mistakeId>.jpg`；作业侧不受影响）

### 3.5 薄弱知识点 Top

```
GET /api/mistakes/weak-points?days=30&limit=5
（childId 由 cookie 推导）

Response 200:
{
  "ok": true,
  "windowDays": 30,
  "totalMistakes": 18,                     // 该 child 近 N 天错题总数
  "items": [
    {
      "tagId": "kt_123",
      "name": "一元二次方程",
      "mistakeCount": 12,                  // 该标签在窗口内出现的错题数
      "share": 0.667                       // mistakeCount / totalMistakes
    }
  ]
}
```

说明：

- 聚合来源是 `mistakes.snapshot_knowledge_tags_json`，不依赖 `sub_question_tags` 或 `sub_questions`；作业删除后仍可正确统计。
- **不返回"错误率"**：错题本只有错题样本、没有"总做题数"，无法算真正的错误率。`share` 是该标签**在本人错题里的占比**，语义明确不误导。
- 一条错题可带多个 `knowledge_tag`，会在多个标签下同时计数；因此 ∑`mistakeCount` ≥ `totalMistakes`，`share` ∈ (0, 1] 但总和可以 > 1。

## 4. 家长反馈

### 4.1 提交反馈

```
POST /api/feedback
Body:
{
  "subQuestionId": "sq_1_1",
  "feedbackType": "grading_wrong" | "confirm_correct" | "manual_verdict",
  "payload": { "correctVerdict": "correct", "note": "…" }
}

Response 200: { "ok": true, "feedbackId": "fb_xxx" }
```

## 5. 知识点（只读）

### 5.1 知识点树

```
GET /api/knowledge-tags?subject=math&grade=8

Response 200:
{
  "ok": true,
  "tree": [
    {
      "id": "kt_root_math",
      "name": "数学",
      "children": [
        {
          "id": "kt_algebra",
          "name": "代数",
          "children": [
            { "id": "kt_quadratic_eq", "name": "一元二次方程", "brief": "..." }
          ]
        }
      ]
    }
  ]
}
```

### 5.2 知识点详情

```
GET /api/knowledge-tags/:id

Response 200:
{
  "ok": true,
  "tag": {
    "id": "kt_123",
    "name": "一元二次方程",
    "subject": "math",
    "gradeMin": 8, "gradeMax": 9,
    "brief": "...",
    "aliases": ["Δ=b²-4ac", "判别式"],
    "parentId": "kt_algebra"
  }
}
```

## 6. 调试 / 监控（内网 + Basic Auth）

### 6.1 工作流 Trace

```
GET /api/debug/trace/:assignmentId

Response 200:
{
  "ok": true,
  "traces": [
    {
      "nodeName": "parseQuestion",
      "status": "success",
      "durationMs": 4320,
      "modelUsed": "claude:sonnet",       // "claude:<model>" | "codex:<model>" | "local"
      "errorMsg": null,
      "createdAt": 1713654321000
    }
  ]
}
```

订阅模式下不记录 token / cost。

### 6.2 每日统计

```
GET /api/debug/stats?days=7

Response 200:
{
  "ok": true,
  "items": [
    { "date": "2026-04-21", "assignments": 12, "avgDurationMs": 32000, "failureRate": 0.08 }
  ]
}
```

## 7. 页面路由（SSR）

| 路径 | 说明 |
|---|---|
| `/` | 首页（项目介绍 + 作业列表入口） |
| `/r/:shortId` | 批改结果页 |
| `/mistakes` | 错题本 |
| `/mistakes?tag=kt_123` | 某知识点错题 |
| `/practice?tags=kt_123` | 练习页（V2 占位） |
| `/debug/assignment/:id` | 工作流 Trace 页（Basic Auth） |

## 8. 错误码

| code | 含义 |
|---|---|
| `INVALID_INPUT` | 参数缺失/格式错 |
| `AUTH_REQUIRED` | 鉴权头/cookie 缺失 |
| `AUTH_FORBIDDEN` | cookie 有效但无权访问该资源（跨 child） |
| `NOT_FOUND` | 资源不存在 |
| `UPSTREAM_LLM_FAIL` | 所有 Provider 都失败 |
| `MCP_FAIL` | MCP 工具调用失败 |
| `WORKFLOW_TIMEOUT` | 超时 |
| `INTERNAL` | 其他 |

## 9. 未来 API（V2+ 预留）

- `POST /api/textbook-page`（教材章节上传）
- `POST /api/practice/generate`（练习包生成）
- `POST /api/children`（多孩子管理）
