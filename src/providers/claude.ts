// Claude Provider · Claude Code CLI 子进程（订阅模式）
//
// 为什么走 CLI 而非 SDK？
//   Anthropic 自 2026-04 起禁止订阅 OAuth 用于 Agent SDK 和第三方应用。
//   只有 Claude Code 本体可使用订阅。因此订阅模式下，CLI 子进程是唯一合规路径。
//
// 延迟优化：
//   - 进程池（CLAUDE_POOL_SIZE 常驻）避免每次冷启动
//   - streaming JSON 输入输出（`claude -p --input-format=stream-json --output-format=stream-json`）
//   - 单进程串行，池级并发
//
// M3 完成实现；当前为占位
import type {
  ChatRequest, ChatResponse, LLMProvider, VisionRequest, VisionResponse,
} from './types';
import { UpstreamError } from '@/lib/errors';

export interface ClaudeCliOptions {
  cliPath: string;
  defaultModel: string;
  poolSize: number;
  timeoutMs: number;
}

export class ClaudeCliProvider implements LLMProvider {
  readonly name = 'claude' as const;
  readonly supportsPromptCache = true;   // Claude Code 内建缓存
  readonly supportsVision = true;

  constructor(private readonly options: ClaudeCliOptions) {}

  async healthCheck(): Promise<void> {
    // TODO[M3]: spawn(cliPath, ['--version'])；要求已登录（claude doctor 或测试调用）
    throw new UpstreamError('claude', 'not-implemented');
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    // TODO[M3]:
    //  1. 取池中空闲子进程（或新建，上限 poolSize）
    //  2. 写 stream-json 请求，含 system/user messages
    //  3. 读 stream-json 响应到结束事件
    //  4. 归还进程到池；超时则 SIGKILL + 创建新进程替代
    //  5. 解析 usage → ChatResponse.usage
    throw new UpstreamError('claude', 'not-implemented');
  }

  async vision(_req: VisionRequest): Promise<VisionResponse> {
    // TODO[M3]: 图片通过临时文件路径 + `@/path/to/image` 引用传入（CLI 支持）
    throw new UpstreamError('claude', 'not-implemented');
  }
}
