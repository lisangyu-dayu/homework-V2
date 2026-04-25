import { getDebugStats } from '@/db/dao/debug';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

function parseDays(raw?: string): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 14;
  if (!Number.isFinite(parsed)) return 14;
  return Math.max(1, Math.min(parsed, 90));
}

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '未完成';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function statCard(label: string, value: string | number, hint: string) {
  return (
    <article
      style={{
        padding: 16,
        borderRadius: 8,
        background: '#fff',
        border: '1px solid #d0d7de',
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: '#57606a' }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 700 }}>{value}</p>
      <p style={{ margin: '4px 0 0', color: '#57606a' }}>{hint}</p>
    </article>
  );
}

export default async function DebugStatsPage({ searchParams }: PageProps) {
  const { days: rawDays } = await searchParams;
  const days = parseDays(rawDays);
  const stats = getDebugStats({ days, recentLimit: 12 });

  return (
    <main className="container">
      <header style={{ marginBottom: 24 }}>
        <h1>调试统计</h1>
        <p style={{ margin: 0, color: '#57606a' }}>
          窗口：近 {days} 天 · 生成于 {formatDateTime(stats.generatedAt)}
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {statCard('孩子数', stats.totals.children, '当前本地库')}
        {statCard('作业总数', stats.totals.assignments, `处理中 ${stats.totals.processingAssignments}`)}
        {statCard('已完成 / 失败', `${stats.totals.doneAssignments} / ${stats.totals.failedAssignments}`, '全量作业')}
        {statCard('小题数', stats.totals.subQuestions, '已持久化题目')}
        {statCard('错题本', stats.totals.mistakes, `未掌握 ${stats.totals.unresolvedMistakes}`)}
        {statCard('Trace 失败', stats.totals.failedTraces, `共 ${stats.totals.traces} 条 trace`)}
      </section>

      <section
        style={{
          marginBottom: 24,
          padding: 16,
          borderRadius: 8,
          background: '#fff',
          border: '1px solid #d0d7de',
          overflowX: 'auto',
        }}
      >
        <h2>日统计</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #d8dee4' }}>
              <th style={{ padding: '8px 6px' }}>日期</th>
              <th style={{ padding: '8px 6px' }}>作业</th>
              <th style={{ padding: '8px 6px' }}>完成/失败/处理中</th>
              <th style={{ padding: '8px 6px' }}>对/错/未批</th>
              <th style={{ padding: '8px 6px' }}>错题</th>
              <th style={{ padding: '8px 6px' }}>反馈</th>
              <th style={{ padding: '8px 6px' }}>Trace 失败</th>
              <th style={{ padding: '8px 6px' }}>Trace 耗时</th>
            </tr>
          </thead>
          <tbody>
            {stats.daily.map((day) => (
              <tr key={day.day} style={{ borderBottom: '1px solid #edf0f2' }}>
                <td style={{ padding: '8px 6px' }}>{day.day}</td>
                <td style={{ padding: '8px 6px' }}>{day.assignments}</td>
                <td style={{ padding: '8px 6px' }}>
                  {day.doneAssignments}/{day.failedAssignments}/{day.processingAssignments}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {day.correctQuestions}/{day.wrongQuestions}/{day.unmarkedQuestions}
                </td>
                <td style={{ padding: '8px 6px' }}>{day.mistakes}</td>
                <td style={{ padding: '8px 6px' }}>{day.feedback}</td>
                <td style={{ padding: '8px 6px' }}>{day.failedTraces}</td>
                <td style={{ padding: '8px 6px' }}>{formatDuration(day.traceDurationMs)}</td>
              </tr>
            ))}
            {stats.daily.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '14px 6px', color: '#57606a' }}>
                  当前时间窗口内暂无数据。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section
        style={{
          padding: 16,
          borderRadius: 8,
          background: '#fff',
          border: '1px solid #d0d7de',
        }}
      >
        <h2>最近作业</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {stats.recentAssignments.map((assignment) => (
            <article
              key={assignment.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1fr) minmax(120px, 0.7fr) minmax(160px, 1fr)',
                gap: 12,
                padding: 12,
                borderRadius: 8,
                border: '1px solid #d8dee4',
              }}
            >
              <div>
                <a href={`/debug/assignment/${encodeURIComponent(assignment.id)}`}>{assignment.id}</a>
                <div style={{ color: '#57606a' }}>shortId: {assignment.shortId}</div>
              </div>
              <div>
                <strong>{assignment.status}</strong>
                <div style={{ color: '#57606a' }}>{assignment.subject}</div>
              </div>
              <div style={{ color: '#57606a' }}>
                {formatDateTime(assignment.createdAt)}
                <br />
                题数：{assignment.totalCount ?? 0}，错：{assignment.wrongCount ?? 0}
              </div>
            </article>
          ))}
          {stats.recentAssignments.length === 0 ? <p style={{ color: '#57606a' }}>暂无作业记录。</p> : null}
        </div>
      </section>
    </main>
  );
}
