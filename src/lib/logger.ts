import pino, { type DestinationStream, type Logger } from 'pino';

export const LOGGER_REDACT_PATHS = [
  'parent_token',
  'parentToken',
  'openclawWebhookSecret',
  'parentLinkSigningSecret',
  'headers.x-openclaw-secret',
  'req.headers.x-openclaw-secret',
  'body.parent_token',
  'body.parentToken',
  'query.t',
  'query.s',
  'searchParams.t',
  'searchParams.s',
  'params.parentToken',
  'params.signature',
  '*.parent_token',
  '*.parentToken',
] as const;

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { svc: 'homework-v2' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [...LOGGER_REDACT_PATHS],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

export const logger = createLogger();

export function maskOpenId(openId: string): string {
  if (openId.length < 8) return '***';
  return `${openId.slice(0, 4)}***${openId.slice(-4)}`;
}
