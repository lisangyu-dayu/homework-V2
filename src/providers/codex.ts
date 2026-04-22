// Codex Provider · Codex CLI 子进程（订阅模式）
//
// 与 Claude CLI 对称设计：同样的进程池 + stream JSON 协议。
// 订阅凭据落在 ~/.codex/auth.json（或 CODEX_HOME 覆盖），本服务只读复用登录态。
//
// 延迟优化：
//   - 进程池（CODEX_POOL_SIZE 常驻）
//   - 单进程串行，池级并发
//
// 视觉能力：Codex CLI 当前视觉支持需 M3 期间实测确认；
//   若不支持，Router 层自动降级到 Claude。
import type {
  ChatRequest, ChatResponse, LLMProvider, VisionRequest, VisionResponse,
} from './types';
import { UpstreamError } from '@/lib/errors';

export interface CodexCliOptions {
  cliPath: string;
  defaultModel: string;
  poolSize: number;
  timeoutMs: number;
}

export class CodexCliProvider implements LLMProvider {
  readonly name = 'codex' as const;
  readonly supportsPromptCache = false;          // 订阅模式下 CLI 缓存行为未公开
  readonly supportsVision = false;               // 待 M3 实测确认

  constructor(private readonly options: CodexCliOptions) {}

  async healthCheck(): Promise<void> {
    // TODO[M3]: spawn(cliPath, ['--version'])；验证已登录（无登录态要求用户 `codex login`）
    throw new UpstreamError('codex', 'not-implemented');
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    // TODO[M3]: 子进程池 + stream JSON
    throw new UpstreamError('codex', 'not-implemented');
  }

  async vision(_req: VisionRequest): Promise<VisionResponse> {
    // TODO[M3]: 若 CLI 支持则走同一通道；不支持则抛 NOT_SUPPORTED 让 Router 降级
    throw new UpstreamError('codex', 'vision-not-supported');
  }
}
