// 错题本页（M8 实现）
// 默认时间轴 · 支持按知识点/日期筛选
//
// 鉴权：middleware 已拦截未登录请求 → 无 cookie 的 request 根本不会到这里
//       本页二次校验 cookie → child 映射有效性（防 token 被删但 cookie 仍在）
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { findByParentToken } from '@/db/dao/children';
import { loadConfig } from '@/lib/config';

export default async function MistakesPage() {
  const cfg = loadConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(cfg.parentCookieName)?.value;
  const child = token ? findByParentToken(token) : null;
  if (!child) redirect('/auth-required');

  return (
    <main className="container">
      <h1>错题本</h1>
      <p style={{ color: '#888' }}>（M8 实现中 · child={child.id}）</p>
    </main>
  );
}
