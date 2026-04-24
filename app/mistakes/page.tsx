import { cookies } from 'next/headers';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { findByParentToken } from '@/db/dao/children';
import { MathMarkdown } from '@/components/math-markdown';
import { getAssignmentShortIdMap, listMistakesForChild } from '@/db/dao/homeworkData';
import { weakPoints } from '@/db/dao/mistakes';
import { getParentCookieName } from '@/lib/config';
import { deleteMistakeAction, setMistakeResolvedAction } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    tag?: string;
    tags?: string;
    resolved?: string;
    from?: string;
    to?: string;
  }>;
}

interface MistakesQueryState {
  tagIds: string[];
  resolved?: boolean;
  from?: number;
  to?: number;
}

function parseOptionalInteger(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDate(value?: number): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function normalizeQueryState(query: Awaited<PageProps['searchParams']>): MistakesQueryState {
  const tagIds = [query.tag, query.tags]
    .filter(Boolean)
    .flatMap((value) => (value ?? '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    tagIds,
    resolved: query.resolved === '0' ? false : query.resolved === '1' ? true : undefined,
    from: parseOptionalInteger(query.from),
    to: parseOptionalInteger(query.to),
  };
}

function buildMistakesHref(
  current: MistakesQueryState,
  patch: {
    tagIds?: string[] | null;
    resolved?: boolean | null;
    from?: number | null;
    to?: number | null;
  },
): string {
  const params = new URLSearchParams();
  const nextTagIds = patch.tagIds === undefined ? current.tagIds : patch.tagIds ?? [];
  const nextResolved = patch.resolved === undefined ? current.resolved : patch.resolved ?? undefined;
  const nextFrom = patch.from === undefined ? current.from : patch.from ?? undefined;
  const nextTo = patch.to === undefined ? current.to : patch.to ?? undefined;

  if (nextTagIds.length > 0) params.set('tags', nextTagIds.join(','));
  if (typeof nextResolved === 'boolean') params.set('resolved', nextResolved ? '1' : '0');
  if (typeof nextFrom === 'number') params.set('from', String(nextFrom));
  if (typeof nextTo === 'number') params.set('to', String(nextTo));

  const query = params.toString();
  return query ? `/mistakes?${query}` : '/mistakes';
}

function getRelativeWindowStart(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

export default async function MistakesPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get(getParentCookieName())?.value;
  const child = token ? findByParentToken(token) : null;
  if (!child) redirect('/auth-required');

  const query = normalizeQueryState(await searchParams);
  const result = listMistakesForChild({
    childId: child.id,
    tagIds: query.tagIds,
    from: query.from,
    to: query.to,
    resolved: query.resolved,
    limit: 50,
  });
  const topWeakPoints = weakPoints(child.id, { days: 30, limit: 5 });
  const currentPageHref = buildMistakesHref(query, {});
  const assignmentShortIds = getAssignmentShortIdMap(
    Array.from(new Set(result.items.map((item) => item.sourceAssignmentId).filter(Boolean) as string[])),
  );
  const tagNameMap = new Map<string, string>();
  for (const tag of result.summary.byTag) {
    tagNameMap.set(tag.tagId, tag.name);
  }
  for (const item of result.items) {
    for (const tag of item.knowledgeTags) {
      tagNameMap.set(tag.id, tag.name);
    }
  }
  for (const item of topWeakPoints.items) {
    tagNameMap.set(item.tagId, item.tagName);
  }

  const hasFilters =
    query.tagIds.length > 0 ||
    typeof query.resolved === 'boolean' ||
    typeof query.from === 'number' ||
    typeof query.to === 'number';

  return (
    <main className="container">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 8 }}>错题本</h1>
        <p style={{ margin: 0, color: '#57606a' }}>
          按时间轴复盘最近错题，并结合知识点分布查看近 30 天最需要优先巩固的内容。
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <article
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: '#57606a' }}>当前结果</p>
          <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 700 }}>{result.summary.total}</p>
          <p style={{ margin: '4px 0 0', color: '#57606a' }}>条错题记录</p>
        </article>
        <article
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: '#57606a' }}>知识点覆盖</p>
          <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 700 }}>{result.summary.byTag.length}</p>
          <p style={{ margin: '4px 0 0', color: '#57606a' }}>个标签命中当前筛选</p>
        </article>
        <article
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: '#57606a' }}>近 30 天错题</p>
          <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 700 }}>{topWeakPoints.totalMistakes}</p>
          <p style={{ margin: '4px 0 0', color: '#57606a' }}>条，用于薄弱点 Top 5</p>
        </article>
      </section>

      <section
        style={{
          marginBottom: 20,
          padding: 16,
          borderRadius: 12,
          background: '#fff',
          border: '1px solid #d0d7de',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: hasFilters ? 12 : 0,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>筛选视图</h2>
            <p style={{ margin: '6px 0 0', color: '#57606a' }}>
              支持按知识点、掌握状态和时间范围筛选，当前列表最多展示最近 50 条。
            </p>
          </div>
          {hasFilters ? (
            <a href="/mistakes" style={{ alignSelf: 'flex-start' }}>
              清除筛选
            </a>
          ) : null}
        </div>

        {hasFilters ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {query.tagIds.map((tagId) => (
              <span
                key={tagId}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#ddf4ff',
                  color: '#0969da',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                知识点：{tagNameMap.get(tagId) ?? tagId}
              </span>
            ))}
            {typeof query.resolved === 'boolean' ? (
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: query.resolved ? '#dafbe1' : '#fff8c5',
                  color: query.resolved ? '#1a7f37' : '#9a6700',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {query.resolved ? '仅看已掌握' : '仅看未掌握'}
              </span>
            ) : null}
            {typeof query.from === 'number' ? (
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#f6f8fa',
                  color: '#57606a',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                从 {formatDate(query.from)}
              </span>
            ) : null}
            {typeof query.to === 'number' ? (
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#f6f8fa',
                  color: '#57606a',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                到 {formatDate(query.to)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a
            href={buildMistakesHref(query, { resolved: null })}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #d0d7de',
              background: typeof query.resolved === 'boolean' ? '#fff' : '#1f2328',
              color: typeof query.resolved === 'boolean' ? '#1f2328' : '#fff',
              fontWeight: 600,
            }}
          >
            全部状态
          </a>
          <a
            href={buildMistakesHref(query, { resolved: false })}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #d0d7de',
              background: query.resolved === false ? '#fff8c5' : '#fff',
              color: '#1f2328',
              fontWeight: 600,
            }}
          >
            未掌握
          </a>
          <a
            href={buildMistakesHref(query, { resolved: true })}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #d0d7de',
              background: query.resolved === true ? '#dafbe1' : '#fff',
              color: '#1f2328',
              fontWeight: 600,
            }}
          >
            已掌握
          </a>
          <a
            href={buildMistakesHref(query, { from: getRelativeWindowStart(7), to: null })}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #d0d7de',
              background: '#fff',
              color: '#1f2328',
              fontWeight: 600,
            }}
          >
            最近 7 天
          </a>
          <a
            href={buildMistakesHref(query, { from: getRelativeWindowStart(30), to: null })}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #d0d7de',
              background: '#fff',
              color: '#1f2328',
              fontWeight: 600,
            }}
          >
            最近 30 天
          </a>
        </div>
      </section>

      <section
        style={{
          marginBottom: 20,
          padding: 16,
          borderRadius: 12,
          background: '#fff',
          border: '1px solid #d0d7de',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>薄弱点 Top 5</h2>
          <p style={{ margin: '6px 0 0', color: '#57606a' }}>
            基于近 30 天错题聚合，展示“错题出现最多”的知识点。占比指该知识点在本人错题中的占比，不是错误率。
          </p>
        </div>

        {topWeakPoints.items.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {topWeakPoints.items.map((item, index) => (
              <article
                key={item.tagId}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid #d8dee4',
                  background: '#f6f8fa',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 12, color: '#57606a' }}>Top {index + 1}</p>
                    <h3 style={{ margin: '4px 0 0', fontSize: 17 }}>{item.tagName}</h3>
                  </div>
                  <a href={buildMistakesHref(query, { tagIds: [item.tagId] })}>查看</a>
                </div>
                <p style={{ margin: '0 0 8px', color: '#57606a' }}>
                  {item.mistakeCount} 条错题 · 占近 30 天错题 {formatPercent(item.share)}
                </p>
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    background: '#d8dee4',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(item.share * 100, 8)}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: '#0969da',
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: '#57606a' }}>近 30 天还没有可统计的错题，暂时无法生成薄弱点 Top 5。</p>
        )}
      </section>

      {result.summary.byTag.length > 0 ? (
        <section
          style={{
            marginBottom: 20,
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>知识点分布</h2>
            <p style={{ margin: '6px 0 0', color: '#57606a' }}>
              当前筛选结果中出现次数最多的知识点，可继续点开缩小范围。
            </p>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {result.summary.byTag.slice(0, 8).map((item) => {
              const share = result.summary.total === 0 ? 0 : item.count / result.summary.total;
              return (
                <a
                  key={item.tagId}
                  href={buildMistakesHref(query, { tagIds: [item.tagId] })}
                  style={{
                    display: 'block',
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid #d8dee4',
                    background: '#f6f8fa',
                    color: '#1f2328',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginBottom: 8,
                    }}
                  >
                    <strong>{item.name}</strong>
                    <span style={{ color: '#57606a' }}>{item.count} 条</span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: '#d8dee4',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(share * 100, 4)}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: '#1f883d',
                      }}
                    />
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      ) : null}

      {result.items.length === 0 ? (
        <section
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #d0d7de',
          }}
        >
          <p style={{ margin: 0 }}>当前筛选条件下还没有错题。</p>
        </section>
      ) : null}

      {result.items.map((item) => {
        const shortId = item.sourceAssignmentId ? assignmentShortIds[item.sourceAssignmentId] : undefined;

        return (
          <article
            key={item.mistakeId}
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 12,
              background: '#fff',
              border: '1px solid #d0d7de',
              boxShadow: '0 18px 42px rgba(15, 23, 42, 0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>错题 {item.mistakeId}</h2>
                <p style={{ margin: '6px 0 0', color: '#57606a' }}>
                  {formatDateTime(item.addedAt)} · {item.subject} · {item.source === 'auto' ? '自动沉淀' : '手动加入'}
                </p>
              </div>
              <span
                style={{
                  alignSelf: 'flex-start',
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: item.resolved ? '#dafbe1' : '#fff8c5',
                  color: item.resolved ? '#1a7f37' : '#9a6700',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {item.resolved ? '已掌握' : '未掌握'}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <form action={setMistakeResolvedAction}>
                <input type="hidden" name="mistakeId" value={item.mistakeId} />
                <input type="hidden" name="resolved" value={item.resolved ? '0' : '1'} />
                <input type="hidden" name="returnTo" value={currentPageHref} />
                <button type="submit">{item.resolved ? '标记为未掌握' : '标记为已掌握'}</button>
              </form>
              <form action={deleteMistakeAction}>
                <input type="hidden" name="mistakeId" value={item.mistakeId} />
                <input type="hidden" name="returnTo" value={currentPageHref} />
                <button type="submit">从错题本移除</button>
              </form>
            </div>

            {item.knowledgeTags.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {item.knowledgeTags.map((tag) => (
                  <a
                    key={`${item.mistakeId}-${tag.id}`}
                    href={buildMistakesHref(query, { tagIds: [tag.id] })}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: '#ddf4ff',
                      color: '#0969da',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {tag.name}
                  </a>
                ))}
              </div>
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              <div>
                <div
                  style={{
                    borderRadius: 12,
                    overflow: 'hidden',
                    border: '1px solid #d8dee4',
                    background: '#f6f8fa',
                  }}
                >
                  <Image
                    src={item.cropUrl}
                    alt={`${item.mistakeId} 题图`}
                    width={1200}
                    height={900}
                    unoptimized
                    sizes="(max-width: 920px) 100vw, 420px"
                    style={{ display: 'block', width: '100%', height: 'auto' }}
                  />
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 13, color: '#57606a' }}>题图快照来自错题本独立存档。</p>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ marginBottom: 12 }}>
                  <strong>来源作业</strong>
                  <p style={{ margin: '6px 0 0' }}>
                    {shortId ? (
                      <a href={`/r/${encodeURIComponent(shortId)}`}>查看原题结果页</a>
                    ) : item.sourceAssignmentId ? (
                      '原作业已删除'
                    ) : (
                      '无来源作业'
                    )}
                  </p>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>正确答案</strong>
                  <div style={{ marginTop: 4 }}>
                    <MathMarkdown content={item.finalAnswer || '暂无答案'} compact />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <strong>学生答案</strong>
                  <div style={{ marginTop: 4 }}>
                    <MathMarkdown content={item.studentAnswer ?? '未识别'} compact />
                  </div>
                </div>

                {item.errorType ? (
                  <div style={{ marginBottom: 12 }}>
                    <strong>错误类型</strong>
                    <p style={{ margin: '6px 0 0' }}>{item.errorType}</p>
                  </div>
                ) : null}

                <div>
                  <strong>讲解</strong>
                  <div style={{ marginTop: 6 }}>
                    <MathMarkdown content={item.explanationMd || '暂无讲解'} />
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </main>
  );
}
