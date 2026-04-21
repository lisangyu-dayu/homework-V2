import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { svc: 'homework-v2' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function maskOpenId(openId: string): string {
  if (openId.length < 8) return '***';
  return `${openId.slice(0, 4)}***${openId.slice(-4)}`;
}
