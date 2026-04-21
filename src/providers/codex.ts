// Codex Provider · 通过本地 `codex` CLI 子进程调用
// M3 完成实现
// 关键点：
//  - 子进程池（避免每次 fork）
//  - JSON stdin/stdout 协议
//  - 超时 + SIGKILL + 自动重启
//  - 视觉能力需先验证 CLI 实际支持情况（阻塞点，见 docs/04-todo-list.md）
import type {
  ChatRequest, ChatResponse, LLMProvider, VisionRequest, VisionResponse,
} from './types';
import { UpstreamError } from '@/lib/errors';

export interface CodexOptions {
  cliPath: string;
  defaultModel: string;
  timeoutMs: number;
  poolSize?: number;
}

export class CodexProvider implements LLMProvider {
  readonly name = 'codex' as const;
  readonly supportsPromptCache = false;          // V1 暂不做
  readonly supportsVision = false;               // 待验证，M3 中确认后切换

  constructor(private readonly options: CodexOptions) {}

  async healthCheck(): Promise<void> {
    // TODO[M3]: spawn(cliPath, ['--version']) 成功即可
    throw new UpstreamError('codex', 'not-implemented');
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    // TODO[M3]: 取池中一个子进程 → 传 prompt JSON → 读响应 JSON
    throw new UpstreamError('codex', 'not-implemented');
  }

  async vision(_req: VisionRequest): Promise<VisionResponse> {
    // TODO[M3]: 视 CLI 支持：若不支持则抛 `NOT_SUPPORTED`，由 Router 重路由到 Claude
    throw new UpstreamError('codex', 'vision-not-supported');
  }
}
