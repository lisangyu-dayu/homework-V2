import { cookies } from 'next/headers';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { findByParentToken } from '@/db/dao/children';
import { MathMarkdown } from '@/components/math-markdown';
import { getAssignmentDetailByShortIdForChild } from '@/db/dao/homeworkData';
import { getParentCookieName } from '@/lib/config';
import { addMistakeFromResultAction, reportAssignmentFeedbackAction } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ shortId: string }>;
  searchParams: Promise<{ t?: string; e?: string; s?: string }>;
}

function formatDateTime(ts: number | null): string {
  if (!ts) return '未完成';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function verdictBadge(verdict: 'correct' | 'wrong' | 'unmarked') {
  if (verdict === 'correct') return '正确';
  if (verdict === 'wrong') return '错误';
  return '未批改';
}

export default async function AssignmentResultPage({ params, searchParams }: PageProps) {
  const { shortId } = await params;
  const { t, e, s } = await searchParams;
  const cookieStore = await cookies();

  if (t || e || s) {
    const shortLinkParams = new URLSearchParams();
    if (t) shortLinkParams.set('t', t);
    if (e) shortLinkParams.set('e', e);
    if (s) shortLinkParams.set('s', s);
    const suffix = shortLinkParams.toString();
    redirect(`/auth/accept/${encodeURIComponent(shortId)}${suffix ? `?${suffix}` : ''}`);
  }

  const cookieToken = cookieStore.get(getParentCookieName())?.value;
  const child = cookieToken ? findByParentToken(cookieToken) : null;
  if (!child) redirect('/auth-required');

  const assignment = getAssignmentDetailByShortIdForChild(shortId, child.id);
  if (!assignment) notFound();

  const hasQuestions = assignment.majorQuestions.some((major) => major.subQuestions.length > 0);

  return (
    <main className="container">
      <header style={{ marginBottom: 24 }}>
        <h1>作业结果 · {assignment.subject}</h1>
        <p>
          状态：<strong>{assignment.status}</strong> · 创建于 {formatDateTime(assignment.createdAt)} · 完成于{' '}
          {formatDateTime(assignment.completedAt)}
        </p>
        <p>
          对 {assignment.stats.correct} · 错 {assignment.stats.wrong} · 未批改 {assignment.stats.unmarked}
          （共 {assignment.stats.total} 题）
        </p>
        <p>
          <a href="/mistakes">查看错题本</a>
        </p>
      </header>

      {!hasQuestions && assignment.status === 'processing' ? (
        <section
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <h2 style={{ marginTop: 0 }}>作业还在处理中</h2>
          <p style={{ marginBottom: 0 }}>
            当前还没有可展示的题目数据。等微信回推完成后，再打开这条结果链接即可查看。
          </p>
        </section>
      ) : null}

      {!hasQuestions && assignment.status === 'failed' ? (
        <section
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <h2 style={{ marginTop: 0 }}>这次处理没有完成</h2>
          <p style={{ marginBottom: 0 }}>
            当前没有可展示的题目数据。请回到微信重新提交作业图，或稍后再试。
          </p>
        </section>
      ) : null}

      {assignment.majorQuestions.map((major) => (
        <section
          key={major.id}
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
            boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
          }}
        >
          <h2 style={{ marginTop: 0 }}>大题 {major.number}</h2>
          {major.stem ? <MathMarkdown content={major.stem} className="section-copy" /> : null}

          {major.subQuestions.map((subQuestion) => (
            <article
              key={subQuestion.id}
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: '1px solid #d8dee4',
              }}
            >
              <h3 style={{ marginBottom: 12 }}>{subQuestion.number}</h3>

              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <strong>答案</strong>
                  <div style={{ marginTop: 4 }}>
                    <MathMarkdown content={subQuestion.finalAnswer || '暂无答案'} compact />
                  </div>
                </div>

                <div>
                  <strong>学生答案</strong>
                  <div style={{ marginTop: 4 }}>
                    <MathMarkdown content={subQuestion.studentAnswer ?? '未识别'} compact />
                  </div>
                </div>

                <div>
                  <strong>判定</strong>
                  <div style={{ marginTop: 4 }}>{verdictBadge(subQuestion.verdict)}</div>
                </div>

                {subQuestion.errorType ? (
                  <div>
                    <strong>错误类型</strong>
                    <div style={{ marginTop: 4 }}>{subQuestion.errorType}</div>
                  </div>
                ) : null}

                <div>
                  <strong>讲解</strong>
                  <div style={{ marginTop: 6 }}>
                    <MathMarkdown content={subQuestion.explanationMd || '暂无讲解'} />
                  </div>
                </div>

                {subQuestion.knowledgeTags.length > 0 ? (
                  <div>
                    <strong>知识点</strong>
                    <div style={{ marginTop: 4 }}>{subQuestion.knowledgeTags.map((tag) => tag.name).join('、')}</div>
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <form action={addMistakeFromResultAction}>
                  <input type="hidden" name="shortId" value={shortId} />
                  <input type="hidden" name="subQuestionId" value={subQuestion.id} />
                  <button type="submit">加入错题本</button>
                </form>
                <form action={reportAssignmentFeedbackAction}>
                  <input type="hidden" name="shortId" value={shortId} />
                  <input type="hidden" name="subQuestionId" value={subQuestion.id} />
                  <button type="submit">批改有误</button>
                </form>
              </div>

              <div style={{ marginTop: 12 }}>
                <p style={{ color: '#57606a', marginBottom: 8 }}>题图</p>
                <Image
                  src={subQuestion.cropUrl}
                  alt={`${major.number}${subQuestion.number} 题图`}
                  width={1200}
                  height={900}
                  loading="lazy"
                  unoptimized
                  sizes="(max-width: 920px) 100vw, 920px"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    borderRadius: 12,
                    border: '1px solid #d8dee4',
                    background: '#f6f8fa',
                  }}
                />
              </div>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
