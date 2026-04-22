// 当家长没有有效 cookie 或短链校验失败时落到这里
// 支持 ?reason=<...> 展示友好文案（不泄漏任何 token）
interface PageProps {
  searchParams: Promise<{ reason?: string }>;
}

const REASON_COPY: Record<string, string> = {
  'expired-link': '这条链接已经过期，请回到微信重新打开最新的那一条。',
  'bad-signature': '链接校验失败，可能被改动过。请从微信重新进入。',
  'incomplete-link': '链接不完整，请从微信消息里完整复制后再打开。',
  'bad-link': '链接格式异常，请从微信重新进入。',
  'unknown-token': '账号已重置，请让孩子重新向机器人发送作业图触发初始化。',
  'missing-cookie': '请从微信消息链接进入。',
  'invalid-cookie': '登录已失效，请从微信消息链接重新进入。',
};

export default async function AuthRequiredPage({ searchParams }: PageProps) {
  const { reason } = await searchParams;
  const message = (reason && REASON_COPY[reason]) || '请从微信消息链接进入。';
  return (
    <main className="container" style={{ padding: '2rem' }}>
      <h1>需要重新从微信进入</h1>
      <p>{message}</p>
      <p style={{ color: '#888', fontSize: '0.9em', marginTop: '2rem' }}>
        作业结果与错题本只对家长本人开放。首次通过微信链接进入后，30 天内可直接在本机浏览器访问。
      </p>
    </main>
  );
}
