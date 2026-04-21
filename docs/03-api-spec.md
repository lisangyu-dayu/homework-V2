# homework-V2 · API 列表

所有 HTTP 接口由 Next.js App Router 提供（`app/api/**`）。
- 默认监听 `0.0.0.0:3100`
- 内部接口无对外暴露，仅局域网
- 日期/时间戳：Unix milliseconds

## 约定

- 请求/响应 Content-Type：`application/json`（除上传）
- 鉴权：
  - `/api/wechat/**` → 头 `X-OpenClaw-Secret`
  - `/debug/**` → Basic Auth
  - `/api/assignment/**` `/api/mistakes/**` → 内网信任，无鉴权
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
  X-Service-Secret: <shared>
Body:
{
  "openId": "o_xxxxxxx",
  "messageType": "text",
  "text": "批改完成 🎉\n查看结果：http://192.168.1.100:3100/r/abc123"
}
```

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

### 2.2 作业列表（某孩子）

```
GET /api/assignment?childId=ch_xxx&limit=20&cursor=<ts>

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

（级联删除 major_questions、sub_questions、crop 文件；不删除已加入错题本的条目）

## 3. 错题本（Mistakes）

### 3.1 查询错题列表

```
GET /api/mistakes/:childId
  ?tags=kt_123,kt_456        // 知识点筛选（AND）
  &from=<ts>&to=<ts>          // 日期范围
  &resolved=0|1               // 是否已掌握
  &limit=50&cursor=<ts>

Response 200:
{
  "ok": true,
  "items": [
    {
      "mistakeId": "ms_xxx",
      "subQuestionId": "sq_1_1",
      "addedAt": 1713654321000,
      "resolved": 0,
      "subject": "math",
      "cropUrl": "/uploads/.../sq_1_1.jpg",
      "finalAnswer": "x=2 或 x=-1",
      "studentAnswer": "x=2",
      "explanationMd": "...",
      "knowledgeTags": [{ "id": "kt_123", "name": "一元二次方程" }]
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

### 3.2 加入错题本

```
POST /api/mistakes
Body:
{ "childId": "ch_xxx", "subQuestionId": "sq_1_1", "source": "manual" }

Response 200:
{ "ok": true, "mistakeId": "ms_xxx" }
```

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

### 3.5 薄弱知识点 Top

```
GET /api/mistakes/:childId/weak-points?days=30&limit=5

Response 200:
{
  "ok": true,
  "items": [
    {
      "tagId": "kt_123",
      "name": "一元二次方程",
      "mistakeCount": 12,
      "totalCount": 18,
      "errorRate": 0.667
    }
  ]
}
```

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
      "modelUsed": "claude-sonnet-4-6",
      "tokensIn": 1820, "tokensOut": 650,
      "costCents": 3,
      "createdAt": 1713654321000
    }
  ]
}
```

### 6.2 每日统计

```
GET /api/debug/stats?days=7

Response 200:
{
  "ok": true,
  "items": [
    { "date": "2026-04-21", "assignments": 12, "avgDurationMs": 32000, "totalCostCents": 84 }
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
| `AUTH_REQUIRED` | 鉴权头缺失/错误 |
| `NOT_FOUND` | 资源不存在 |
| `UPSTREAM_LLM_FAIL` | 所有 Provider 都失败 |
| `MCP_FAIL` | MCP 工具调用失败 |
| `WORKFLOW_TIMEOUT` | 超时 |
| `INTERNAL` | 其他 |

## 9. 未来 API（V2+ 预留）

- `POST /api/textbook-page`（教材章节上传）
- `POST /api/practice/generate`（练习包生成）
- `POST /api/children`（多孩子管理）
