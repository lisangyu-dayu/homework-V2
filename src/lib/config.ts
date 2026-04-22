import { z } from 'zod';

const ConfigSchema = z.object({
  // Claude Code CLI（订阅模式，无 API Key）
  claudeCliPath: z.string().default('claude'),
  claudeDefaultModel: z.string().default('sonnet'),
  claudePoolSize: z.number().int().min(1).max(16).default(4),
  claudeTimeoutMs: z.number().int().default(120_000),

  // Codex CLI（订阅模式，ChatGPT OAuth）
  codexCliPath: z.string().default('codex'),
  codexDefaultModel: z.string().default('gpt-5.4'),
  codexPoolSize: z.number().int().min(1).max(16).default(3),
  codexTimeoutMs: z.number().int().default(120_000),

  // OpenClaw（微信中继）
  openclawWebhookSecret: z.string().min(8),
  openclawPushbackUrl: z.string().url(),

  // HTTP
  port: z.number().int().default(3100),
  publicBaseUrl: z.string().url(),

  // Auth
  parentLinkSigningSecret: z.string().min(16),
  parentCookieName: z.string().default('hw_parent'),
  parentCookieMaxAgeDays: z.number().int().default(30),
  adminUser: z.string().min(1),
  adminPass: z.string().min(1),

  // Storage
  sqlitePath: z.string().default('./data/db/homework.db'),
  uploadDir: z.string().default('./uploads'),

  // Feature Flags
  enabledSubjects: z.array(z.string()).default(['math']),
  localVlmEnabled: z.boolean().default(false),

  // Observability
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const raw = {
    claudeCliPath: process.env.CLAUDE_CLI_PATH,
    claudeDefaultModel: process.env.CLAUDE_DEFAULT_MODEL,
    claudePoolSize: process.env.CLAUDE_POOL_SIZE ? Number(process.env.CLAUDE_POOL_SIZE) : undefined,
    claudeTimeoutMs: process.env.CLAUDE_TIMEOUT_MS ? Number(process.env.CLAUDE_TIMEOUT_MS) : undefined,
    codexCliPath: process.env.CODEX_CLI_PATH,
    codexDefaultModel: process.env.CODEX_DEFAULT_MODEL,
    codexPoolSize: process.env.CODEX_POOL_SIZE ? Number(process.env.CODEX_POOL_SIZE) : undefined,
    codexTimeoutMs: process.env.CODEX_TIMEOUT_MS ? Number(process.env.CODEX_TIMEOUT_MS) : undefined,
    openclawWebhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET,
    openclawPushbackUrl: process.env.OPENCLAW_PUSHBACK_URL,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    parentLinkSigningSecret: process.env.PARENT_LINK_SIGNING_SECRET,
    parentCookieName: process.env.PARENT_COOKIE_NAME,
    parentCookieMaxAgeDays: process.env.PARENT_COOKIE_MAX_AGE_DAYS ? Number(process.env.PARENT_COOKIE_MAX_AGE_DAYS) : undefined,
    adminUser: process.env.ADMIN_USER,
    adminPass: process.env.ADMIN_PASS,
    sqlitePath: process.env.SQLITE_PATH,
    uploadDir: process.env.UPLOAD_DIR,
    enabledSubjects: process.env.ENABLED_SUBJECTS?.split(',').map((s) => s.trim()),
    localVlmEnabled: process.env.LOCAL_VLM_ENABLED === 'true',
    logLevel: process.env.LOG_LEVEL,
  };
  cached = ConfigSchema.parse(raw);
  return cached;
}
