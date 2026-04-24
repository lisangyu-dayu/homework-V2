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
  withTempImages,
} from './cli';
import { UpstreamError } from '@/lib/errors';

export interface ClaudeCliOptions extends CliProviderCoreOptions {
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
  return new UpstreamError('claude', message, error);
}

export class ClaudeCliProvider extends CliProviderBase implements LLMProvider {
  readonly name = 'claude' as const;

  readonly supportsPromptCache = true;

  readonly supportsVision = true;

  constructor(options: ClaudeCliOptions) {
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

  async vision(req: VisionRequest): Promise<VisionResponse> {
    try {
      return await withTempImages(req.images, async (imagePaths) => {
        const response = await this.runCommand({
          args: this.buildArgs(req.model),
          stdin: buildPrompt(req, imagePaths),
        });
        return withRequestedModel(response, req.model);
      });
    } catch (error) {
      throw toUpstreamError(error);
    }
  }

  private buildArgs(model?: string): string[] {
    return [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'bypassPermissions',
      '--model',
      model ?? this.options.defaultModel,
    ];
  }
}
