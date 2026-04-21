import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 家教 · homework-V2',
  description: '拍照批改与讲解（6-9 年级数学）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
