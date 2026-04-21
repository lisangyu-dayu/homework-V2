export default function HomePage() {
  return (
    <main className="container">
      <h1>AI 家教 · homework-V2</h1>
      <p>V1 聚焦 6-9 年级数学。请通过微信上传作业图，完成后会收到结果页链接。</p>
      <ul>
        <li><a href="/mistakes">错题本</a></li>
        <li><a href="/debug/stats">运行统计（调试）</a></li>
      </ul>
    </main>
  );
}
