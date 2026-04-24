import type { Metadata } from 'next';
import { Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google';
import Link from 'next/link';
import 'katex/dist/katex.min.css';
import './globals.css';

const sansFont = Noto_Sans_SC({
  variable: '--font-sans',
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
});

const serifFont = Noto_Serif_SC({
  variable: '--font-serif',
  weight: ['600', '700'],
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'AI 家教 · homework-V2',
  description: '拍照批改、讲解与错题沉淀（6-9 年级数学优先）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${sansFont.variable} ${serifFont.variable}`}>
        <div className="app-shell">
          <div className="app-glow app-glow--left" aria-hidden="true" />
          <div className="app-glow app-glow--right" aria-hidden="true" />

          <header className="site-header">
            <div className="site-header__inner">
              <Link className="site-brand" href="/">
                <span className="site-brand__eyebrow">拍照批改与错题沉淀</span>
                <strong>AI 家教</strong>
              </Link>

              <nav className="site-nav" aria-label="主导航">
                <Link href="/">首页</Link>
                <Link href="/mistakes">错题本</Link>
              </nav>
            </div>
          </header>

          <div className="site-content">{children}</div>

          <footer className="site-footer">
            仅在家庭局域网环境开放访问，首次访问请从微信回推短链进入。
          </footer>
        </div>
      </body>
    </html>
  );
}
