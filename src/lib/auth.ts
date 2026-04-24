// 家长鉴权闭环
//
// 模型：
//   - 每个 children 行首次创建时生成 parent_token（DAO 负责，见 src/db/dao/children.ts）
//   - 回推微信的短链 `/r/:shortId?t=<parent_token>&e=<exp>&s=<sig>` 携带凭据
//     * t/e/s 三者必须同时存在；任一缺失或签名/过期失败即拒绝
//     * exp = 签发时间 + SHORT_LINK_TTL_MINUTES（默认 15 分钟）
//     * 签名覆盖 (shortId, parentToken, exp) 三项，防止替换任一参数
//   - 首次访问通过后写入 httpOnly cookie；后续请求只认 cookie，cookie 有 30 天独立有效期
//
// 威胁模型（V1，请与 docs/01-product-design.md §8.1 对齐阅读）：
//   - 短链是 bearer 凭据：窗口期内任何持有者都可进入 → 接受这个风险，靠 15 分钟窗口缩小爆炸半径
//   - cookie 同样是 bearer：被本机浏览器用户共享；V1 内网 http，无 Secure 标志
//   - 不防重放、不防转发；仅防猜测/暴力枚举（靠 HMAC）与过期重用（靠 exp）
//   - V1.1 计划升级：一次性 code → cookie，避免转发链接永久可用
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getParentCookieMaxAgeDays, getParentCookieName, loadConfig } from './config';
import { findByParentToken, type ChildRow } from '@/db/dao/children';
import { AuthError } from './errors';

// —— 签名短链 ——

/**
 * 为短链生成签名：sig = HMAC_SHA256(secret, `${shortId}.${parentToken}.${expSec}`).slice(0, 16)
 * 验证方：收到 `/r/:shortId?t=<pt>&e=<exp>&s=<sig>` → 校验未过期 + 重算签名比对
 */
export function signShortLink(shortId: string, parentToken: string, expSec: number): string {
  const { parentLinkSigningSecret } = loadConfig();
  return crypto
    .createHmac('sha256', parentLinkSigningSecret)
    .update(`${shortId}.${parentToken}.${expSec}`)
    .digest('hex')
    .slice(0, 16);
}

export function verifyShortLink(
  shortId: string,
  parentToken: string,
  expSec: number,
  signature: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): 'ok' | 'expired' | 'bad-signature' {
  if (expSec <= nowSec) return 'expired';
  const expected = signShortLink(shortId, parentToken, expSec);
  if (expected.length !== signature.length) return 'bad-signature';
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  return ok ? 'ok' : 'bad-signature';
}

export interface ShortLinkParams {
  shortId: string;
  parentToken: string;
  expSec: number;
  signature: string;
}

/** 构造回推微信的完整 URL；ttl 默认 15 分钟，可用 SHORT_LINK_TTL_MINUTES 覆盖 */
export function buildShortLinkUrl(shortId: string, parentToken: string): string {
  const { publicBaseUrl, shortLinkTtlMinutes } = loadConfig();
  const expSec = Math.floor(Date.now() / 1000) + shortLinkTtlMinutes * 60;
  const sig = signShortLink(shortId, parentToken, expSec);
  const u = new URL(`/r/${encodeURIComponent(shortId)}`, publicBaseUrl);
  u.searchParams.set('t', parentToken);
  u.searchParams.set('e', String(expSec));
  u.searchParams.set('s', sig);
  return u.toString();
}

// —— Cookie ——

export function cookieAttributesForParent(): string {
  const maxAge = getParentCookieMaxAgeDays() * 24 * 60 * 60;
  // SameSite=Lax：从微信内建浏览器跳转时 cookie 可正常携带
  // 内网 http，无 Secure
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function parentCookieHeader(parentToken: string): string {
  return `${getParentCookieName()}=${parentToken}; ${cookieAttributesForParent()}`;
}

// —— 从请求中解析 child ——

/**
 * 解析请求中的 parent_token（只认 cookie）。
 * 短链本身只在 /r/:shortId 路由使用 acceptShortLink 校验并写 cookie，不作为受保护接口的兜底。
 */
export function requireChildFromRequest(req: NextRequest): ChildRow {
  const cookieToken = req.cookies.get(getParentCookieName())?.value;
  if (!cookieToken) throw new AuthError('missing-cookie');
  const child = findByParentToken(cookieToken);
  if (!child) throw new AuthError('invalid-cookie');
  return child;
}

/**
 * 仅用于 `/r/:shortId` 首次进入：校验签名 + 过期；通过后 caller 需写 cookie 并继续渲染。
 */
export function acceptShortLink(params: ShortLinkParams): ChildRow {
  const verdict = verifyShortLink(params.shortId, params.parentToken, params.expSec, params.signature);
  if (verdict === 'expired') throw new AuthError('expired-link');
  if (verdict === 'bad-signature') throw new AuthError('bad-signature');
  const child = findByParentToken(params.parentToken);
  if (!child) throw new AuthError('unknown-token');
  return child;
}
