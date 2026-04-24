import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { resetConfigCacheForTest } from '@/lib/config';
import { buildShortLinkUrl } from '@/lib/auth';
import { middleware } from '../../middleware';

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3100';
  process.env.PARENT_LINK_SIGNING_SECRET = '1234567890abcdef1234567890abcdef';
  process.env.SHORT_LINK_TTL_MINUTES = '15';
  process.env.PARENT_COOKIE_NAME = 'hw_parent';
  process.env.OPENCLAW_WEBHOOK_SECRET = 'test-openclaw-secret';
  process.env.OPENCLAW_PUSHBACK_URL = 'https://example.com/pushback';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'pass';
  resetConfigCacheForTest();
});

describe('auth and config integration', () => {
  it('uses validated short-link ttl from config when building signed urls', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));
    process.env.SHORT_LINK_TTL_MINUTES = '5';
    resetConfigCacheForTest();

    const url = new URL(buildShortLinkUrl('short-123', 'pt_secret'));
    expect(url.searchParams.get('t')).toBe('pt_secret');
    expect(url.searchParams.get('e')).toBe(String(Math.floor(Date.now() / 1000) + 5 * 60));
    expect(url.searchParams.get('s')).toHaveLength(16);

    vi.useRealTimers();
  });

  it('adds missing-cookie reason when middleware redirects protected page requests', () => {
    const res = middleware(new NextRequest('http://localhost/mistakes'));
    expect(res?.status).toBe(307);

    const location = res?.headers.get('location');
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe('/auth-required');
    expect(redirectUrl.searchParams.get('reason')).toBe('missing-cookie');
  });

  it('redacts sensitive fields in structured logs', async () => {
    const chunks: string[] = [];
    const stream = {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    };
    const testLogger = createLogger(stream);
    const headerSecretValue = 'openclaw-secret-value';

    testLogger.info({
      parentToken: 'pt_secret_value',
      parent_token: 'pt_secret_value',
      headers: { 'x-openclaw-secret': headerSecretValue },
      query: { t: 'pt_secret_value', s: 'signature-value' },
    });

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('pt_secret_value');
    expect(output).not.toContain(headerSecretValue);
    expect(output).not.toContain('signature-value');
  });
});
