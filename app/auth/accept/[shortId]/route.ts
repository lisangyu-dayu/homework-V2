import { NextRequest, NextResponse } from 'next/server';
import { acceptShortLink } from '@/lib/auth';
import { getParentCookieMaxAgeDays, getParentCookieName } from '@/lib/config';
import { AuthError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shortId: string }> },
) {
  const { shortId } = await params;
  const { searchParams } = new URL(req.url);
  const t = searchParams.get('t');
  const e = searchParams.get('e');
  const s = searchParams.get('s');

  if (!t || !e || !s) {
    return NextResponse.redirect(new URL('/auth-required?reason=incomplete-link', req.url));
  }

  const expSec = Number.parseInt(e, 10);
  if (!Number.isFinite(expSec)) {
    return NextResponse.redirect(new URL('/auth-required?reason=bad-link', req.url));
  }

  try {
    acceptShortLink({ shortId, parentToken: t, expSec, signature: s });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.redirect(
        new URL(`/auth-required?reason=${encodeURIComponent(error.reason)}`, req.url),
      );
    }
    throw error;
  }

  const response = NextResponse.redirect(new URL(`/r/${encodeURIComponent(shortId)}`, req.url));
  response.cookies.set({
    name: getParentCookieName(),
    value: t,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: getParentCookieMaxAgeDays() * 24 * 60 * 60,
  });
  return response;
}
