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

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  costCents?: number;
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
