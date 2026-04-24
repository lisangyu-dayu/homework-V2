import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  VisionRequest,
  VisionResponse,
} from './types';
import {
  buildPrompt,
  CliProviderBase,
  type CliExecutor,
  type CliProviderCoreOptions,
} from './cli';
import { UpstreamError } from '@/lib/errors';

export interface CodexCliOptions extends CliProviderCoreOptions {
  executor?: CliExecutor;
}

function withRequestedModel(response: ChatResponse, requestedModel?: string): ChatResponse {
  return {
    ...response,
    model: requestedModel ?? response.model,
  };
}

function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new UpstreamError('codex', message, error);
}

export class CodexCliProvider extends CliProviderBase implements LLMProvider {
  readonly name = 'codex' as const;

  readonly supportsPromptCache = false;

  readonly supportsVision = false;

  constructor(options: CodexCliOptions) {
    super(options);
  }

  async healthCheck(): Promise<void> {
    try {
      await this.runHealthCheck(['--version']);
    } catch (error) {
      throw toUpstreamError(error);
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.runCommand({
        args: this.buildArgs(req.model),
        stdin: buildPrompt(req),
      });
      return withRequestedModel(response, req.model);
    } catch (error) {
      throw toUpstreamError(error);
    }
  }

  async vision(_req: VisionRequest): Promise<VisionResponse> {
    throw new UpstreamError('codex', 'vision-not-supported');
  }

  private buildArgs(model?: string): string[] {
    return [
      'exec',
      '--json',
      '--model',
      model ?? this.options.defaultModel,
    ];
  }
}
