// Claude Provider · @anthropic-ai/sdk
// M3 完成实现
import type {
  ChatRequest, ChatResponse, LLMProvider, VisionRequest, VisionResponse,
} from './types';
import { UpstreamError } from '@/lib/errors';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude' as const;
  readonly supportsPromptCache = true;
  readonly supportsVision = true;

  constructor(private readonly apiKey: string, private readonly defaultModel: string) {}

  async healthCheck(): Promise<void> {
    if (!this.apiKey) throw new UpstreamError('claude', 'ANTHROPIC_API_KEY missing');
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    // TODO[M3]: 用 @anthropic-ai/sdk messages.create
    // TODO[M3]: 支持 cache_control 标记 system/assignment 段
    // TODO[M3]: 重试（指数退避）+ 超时 + 费用记录
    throw new UpstreamError('claude', 'not-implemented');
  }

  async vision(_req: VisionRequest): Promise<VisionResponse> {
    // TODO[M3]: 把 images 转 image content block
    throw new UpstreamError('claude', 'not-implemented');
  }
}
