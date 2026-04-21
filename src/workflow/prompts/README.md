# Prompts

每个工作流节点的 prompt 模板放这里（M5 陆续落）。

约定：
- 一个文件一个节点
- 导出 `buildPrompt(input: T): { system: string; user: string }`
- 所有 system 段放入 Provider 的 `system` 参数，支持 prompt caching
- 输出**必须**带 Zod schema 对应
