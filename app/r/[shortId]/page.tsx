// 结果页：大题 → 小题 层级渲染
// 数据源：src/db/dao/assignments.ts（M1 完成后接通）
// 渲染：SSR，交互按钮为 Client Component（加入错题本 / 批改有误）
//
// 鉴权：
//   - 首次来自微信的请求带 ?t=<parentToken>&e=<exp>&s=<sig>（三件套必须同时存在）
//     → 校验签名 + 未过期 → 写入 cookie → 302 到 /r/:shortId（去掉 query）
//   - 后续访问靠 cookie `hw_parent`；无 cookie / 链接过期 / 签名错 → 302 到 /auth-required
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { acceptShortLink } from '@/lib/auth';
import { findByParentToken } from '@/db/dao/children';
import { loadConfig } from '@/lib/config';
import { AuthError } from '@/lib/errors';

interface PageProps {
  params: Promise<{ shortId: string }>;
  searchParams: Promise<{ t?: string; e?: string; s?: string }>;
}

export default async function AssignmentResultPage({ params, searchParams }: PageProps) {
  const { shortId } = await params;
  const { t, e, s } = await searchParams;
  const cfg = loadConfig();
  const cookieStore = await cookies();

  // 1) 短链首次进入：必须同时带 t + e + s；任一缺失直接拒绝
  const hasAnyShortLinkParam = Boolean(t || e || s);
  if (hasAnyShortLinkParam) {
    if (!t || !e || !s) {
      redirect('/auth-required?reason=incomplete-link');
    }
    const expSec = Number.parseInt(e, 10);
    if (!Number.isFinite(expSec)) {
      redirect('/auth-required?reason=bad-link');
    }
    try {
      acceptShortLink({ shortId, parentToken: t, expSec, signature: s });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/auth-required?reason=${encodeURIComponent(err.reason)}`);
      }
      throw err;
    }
    cookieStore.set({
      name: cfg.parentCookieName,
      value: t,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: cfg.parentCookieMaxAgeDays * 24 * 60 * 60,
    });
    redirect(`/r/${encodeURIComponent(shortId)}`);
  }

  // 2) 正常访问：cookie 必须能映射到 child
  const cookieToken = cookieStore.get(cfg.parentCookieName)?.value;
  const child = cookieToken ? findByParentToken(cookieToken) : null;
  if (!child) redirect('/auth-required');

  // 3) 取作业（并校验归属）
  // TODO[M8]: 从 DAO 取 assignment；若 assignment.childId !== child.id → notFound()
  const assignment = null as unknown as {
    id: string;
    childId: string;
    subject: string;
    stats: { total: number; correct: number; wrong: number; unmarked: number };
    majorQuestions: Array<{
      id: string;
      number: string;
      subQuestions: Array<{
        id: string;
        number: string;
        cropUrl: string;
        finalAnswer: string;
        verdict: 'correct' | 'wrong' | 'unmarked';
        studentAnswer: string | null;
        explanationMd: string;
        knowledgeTags: Array<{ id: string; name: string }>;
      }>;
    }>;
  } | null;

  if (!assignment) {
    // 开发期占位
    return (
      <main className="container">
        <h1>作业结果 · {shortId}</h1>
        <p style={{ color: '#888' }}>（M8 实现中 · 数据层未接通 · child={child.id}）</p>
      </main>
    );
  }
  if (assignment.childId !== child.id) notFound();

  return (
    <main className="container">
      <header>
        <h1>今日作业 · {assignment.subject}</h1>
        <p>
          对 {assignment.stats.correct} · 错 {assignment.stats.wrong} ·
          未批改 {assignment.stats.unmarked}（共 {assignment.stats.total} 题）
        </p>
      </header>
      {assignment.majorQuestions.map((mq) => (
        <section key={mq.id}>
          <h2>【大题 {mq.number}】</h2>
          {mq.subQuestions.map((sq) => (
            <article key={sq.id}>
              <h3>
                {sq.number}{' '}
                {sq.verdict === 'correct' && '✓'}
                {sq.verdict === 'wrong' && '✗'}
                {sq.verdict === 'unmarked' && '—'}
              </h3>
              {/* TODO[M8]: 图片、LaTeX 渲染、讲解 Markdown、按钮 */}
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}

