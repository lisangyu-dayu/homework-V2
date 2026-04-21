// 结果页：大题 → 小题 层级渲染
// 数据源：src/db/dao/assignments.ts（M1 完成后接通）
// 渲染：SSR，交互按钮为 Client Component（加入错题本 / 批改有误）
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ shortId: string }>;
}

export default async function AssignmentResultPage({ params }: PageProps) {
  const { shortId } = await params;

  // TODO[M8]: 从 DAO 取 assignment
  const assignment = null as unknown as {
    id: string;
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
        <p style={{ color: '#888' }}>（M8 实现中 · 数据层未接通）</p>
      </main>
    );
  }

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
  // 若路由无匹配：
  notFound();
}
