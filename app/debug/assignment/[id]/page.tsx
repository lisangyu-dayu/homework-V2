import { notFound } from 'next/navigation';
import { getAssignmentDetailById } from '@/db/dao/homeworkData';
import { listByAssignment } from '@/db/dao/traces';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '未完成';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

function statusColor(status: string): string {
  if (status === 'success' || status === 'done') return '#1a7f37';
  if (status === 'failed') return '#cf222e';
  return '#6e7781';
}

export default async function DebugAssignmentPage({ params }: PageProps) {
  const { id } = await params;
  const assignment = getAssignmentDetailById(id);
  if (!assignment) notFound();

  const traces = listByAssignment(assignment.id);

  return (
    <main className="container">
      <header style={{ marginBottom: 24 }}>
        <p style={{ margin: '0 0 8px' }}>
          <a href="/debug/stats">返回调试统计</a>
        </p>
        <h1>Trace · {assignment.id}</h1>
        <p style={{ margin: 0, color: '#57606a' }}>
          shortId: {assignment.shortId} · childId: {assignment.childId} · subject: {assignment.subject}
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
        <article style={{ padding: 16, borderRadius: 8, background: '#fff', border: '1px solid #d0d7de' }}>
          <p style={{ margin: 0, color: '#57606a' }}>状态</p>
          <p style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 700, color: statusColor(assignment.status) }}>
            {assignment.status}
          </p>
        </article>
        <article style={{ padding: 16, borderRadius: 8, background: '#fff', border: '1px solid #d0d7de' }}>
          <p style={{ margin: 0, color: '#57606a' }}>题目统计</p>
          <p style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 700 }}>
            {assignment.stats.correct}/{assignment.stats.wrong}/{assignment.stats.unmarked}
          </p>
        </article>
        <article style={{ padding: 16, borderRadius: 8, background: '#fff', border: '1px solid #d0d7de' }}>
          <p style={{ margin: 0, color: '#57606a' }}>创建/完成</p>
          <p style={{ margin: '6px 0 0' }}>{formatDateTime(assignment.createdAt)}</p>
          <p style={{ margin: 0, color: '#57606a' }}>{formatDateTime(assignment.completedAt)}</p>
        </article>
      </section>

      <section
        style={{
          marginBottom: 24,
          padding: 16,
          borderRadius: 8,
          background: '#fff',
          border: '1px solid #d0d7de',
        }}
      >
        <h2>题目结构</h2>
        {assignment.majorQuestions.length === 0 ? <p style={{ color: '#57606a' }}>暂无题目结构。</p> : null}
        {assignment.majorQuestions.map((major) => (
          <article key={major.id} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #edf0f2' }}>
            <strong>大题 {major.number}</strong>
            <div style={{ color: '#57606a' }}>
              {major.subQuestions.length} 小题 · {major.subQuestions.map((sub) => sub.verdict).join(' / ') || '无'}
            </div>
          </article>
        ))}
      </section>

      <section
        style={{
          padding: 16,
          borderRadius: 8,
          background: '#fff',
          border: '1px solid #d0d7de',
        }}
      >
        <h2>Workflow Trace</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {traces.map((trace) => (
            <article key={trace.id} style={{ padding: 12, borderRadius: 8, border: '1px solid #d8dee4' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <strong>{trace.nodeName}</strong>
                  <span style={{ marginLeft: 8, color: statusColor(trace.status) }}>{trace.status}</span>
                </div>
                <div style={{ color: '#57606a' }}>
                  {trace.durationMs}ms · {trace.modelUsed ?? 'local'} · {formatDateTime(trace.createdAt)}
                </div>
              </div>
              {trace.errorMsg ? (
                <pre style={{ whiteSpace: 'pre-wrap', color: '#cf222e', marginBottom: 0 }}>{trace.errorMsg}</pre>
              ) : null}
              {trace.input !== undefined ? (
                <details style={{ marginTop: 10 }}>
                  <summary>input</summary>
                  <pre style={{ overflowX: 'auto' }}>{formatJson(trace.input)}</pre>
                </details>
              ) : null}
              {trace.output !== undefined ? (
                <details style={{ marginTop: 10 }}>
                  <summary>output</summary>
                  <pre style={{ overflowX: 'auto' }}>{formatJson(trace.output)}</pre>
                </details>
              ) : null}
            </article>
          ))}
          {traces.length === 0 ? <p style={{ color: '#57606a' }}>暂无 trace。</p> : null}
        </div>
      </section>
    </main>
  );
}
