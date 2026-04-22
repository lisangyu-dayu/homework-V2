export type ProviderName = 'claude' | 'codex';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  cacheKey?: string;
}

export interface VisionImage {
  data: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface VisionRequest extends ChatRequest {
  images: VisionImage[];
}

// 订阅模式下 CLI 不暴露 per-call token/cost；只保留延迟与模型名做 trace
export interface Usage {
  durationMs: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: Usage;
  raw?: unknown;
}

export interface VisionResponse extends ChatResponse {}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly supportsPromptCache: boolean;
  readonly supportsVision: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  vision(req: VisionRequest): Promise<VisionResponse>;
  healthCheck(): Promise<void>;
}

export type TaskKind =
  | 'vision'
  | 'layoutSplit'
  | 'parseQuestion'
  | 'selfSolve'
  | 'extractStudentAnswer'
  | 'generateExplanation'
  | 'kpTagging';
