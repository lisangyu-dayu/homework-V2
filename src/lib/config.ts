import { z } from 'zod';

const ConfigSchema = z.object({
  anthropicApiKey: z.string().min(1),
  anthropicModel: z.string().default('claude-sonnet-4-6'),
  anthropicModelVision: z.string().default('claude-sonnet-4-6'),
  anthropicModelEscalate: z.string().default('claude-opus-4-7'),

  codexCliPath: z.string().default('codex'),
  codexDefaultModel: z.string().default('gpt-5.4'),
  codexTimeoutMs: z.number().int().default(120_000),

  openclawWebhookSecret: z.string().min(1),
  openclawPushbackUrl: z.string().url(),

  port: z.number().int().default(3100),
  publicBaseUrl: z.string().url(),

  sqlitePath: z.string().default('./data/db/homework.db'),
  uploadDir: z.string().default('./uploads'),

  enabledSubjects: z.array(z.string()).default(['math']),
  localVlmEnabled: z.boolean().default(false),

  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const raw = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    anthropicModelVision: process.env.ANTHROPIC_MODEL_VISION,
    anthropicModelEscalate: process.env.ANTHROPIC_MODEL_ESCALATE,
    codexCliPath: process.env.CODEX_CLI_PATH,
    codexDefaultModel: process.env.CODEX_DEFAULT_MODEL,
    codexTimeoutMs: process.env.CODEX_TIMEOUT_MS ? Number(process.env.CODEX_TIMEOUT_MS) : undefined,
    openclawWebhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET,
    openclawPushbackUrl: process.env.OPENCLAW_PUSHBACK_URL,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    sqlitePath: process.env.SQLITE_PATH,
    uploadDir: process.env.UPLOAD_DIR,
    enabledSubjects: process.env.ENABLED_SUBJECTS?.split(',').map((s) => s.trim()),
    localVlmEnabled: process.env.LOCAL_VLM_ENABLED === 'true',
    logLevel: process.env.LOG_LEVEL,
  };
  cached = ConfigSchema.parse(raw);
  return cached;
}
