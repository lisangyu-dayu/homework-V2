// Next.js 全局中间件：家长鉴权闭环 + 调试页 Basic Auth
//
// 通过 cookie `hw_parent` 放行受保护路由；/r/:shortId 本身可匿名进入（它自己会校验短链签名并写 cookie）
// /debug/* 使用 ADMIN_USER / ADMIN_PASS 的 Basic Auth。
//
// 注意：middleware 运行在 Edge runtime，不能直接用 better-sqlite3。
// 因此这里只做 cookie **存在性**校验；真正的 token → child 查询留给路由/页面层。
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = process.env.PARENT_COOKIE_NAME ?? 'hw_parent';

function isDebugPath(pathname: string): boolean {
  return pathname === '/debug' || pathname.startsWith('/debug/') || pathname.startsWith('/api/debug/');
}

function parseBasicAuth(headerValue: string | null): { user: string; pass: string } | null {
  if (!headerValue?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(headerValue.slice('Basic '.length));
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return {
      user: decoded.slice(0, separatorIndex),
      pass: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function requireDebugAuth(req: NextRequest): NextResponse | null {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  const credentials = parseBasicAuth(req.headers.get('authorization'));
  if (adminUser && adminPass && credentials?.user === adminUser && credentials.pass === adminPass) {
    return null;
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="homework-v2 debug", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}

function isProtectedPath(pathname: string): boolean {
  if (pathname.startsWith('/api/wechat')) return false;     // 插件 → 本服务，secret 校验
  if (pathname.startsWith('/api/knowledge-tags')) return false;
  if (pathname.startsWith('/auth-required')) return false;

  if (pathname.startsWith('/api/assignment')) return true;
  if (pathname.startsWith('/api/mistakes')) return true;
  if (pathname.startsWith('/api/feedback')) return true;
  if (pathname === '/mistakes' || pathname.startsWith('/mistakes/')) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isDebugPath(pathname)) {
    const authResponse = requireDebugAuth(req);
    if (authResponse) return authResponse;
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) return NextResponse.next();

  const hasCookie = Boolean(req.cookies.get(COOKIE_NAME)?.value);
  if (hasCookie) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { ok: false, error: { code: 'AUTH_REQUIRED', message: 'missing parent cookie' } },
      { status: 401 },
    );
  }

  const redirect = req.nextUrl.clone();
  redirect.pathname = '/auth-required';
  redirect.search = '';
  redirect.searchParams.set('reason', 'missing-cookie');
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: ['/api/:path*', '/mistakes/:path*', '/mistakes', '/debug', '/debug/:path*'],
};
