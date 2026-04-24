import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

interface MathMarkdownProps {
  content: string;
  className?: string;
  compact?: boolean;
}

function normalizeMathDelimiters(content: string): string {
  return content
    .replace(/\\\[((?:.|\r?\n)+?)\\\]/g, (_, expr: string) => `$$${expr}$$`)
    .replace(/\\\(((?:.|\r?\n)+?)\\\)/g, (_, expr: string) => `$${expr}$`);
}

export function MathMarkdown({ content, className, compact = false }: MathMarkdownProps) {
  const normalized = normalizeMathDelimiters(content.trim() || '暂无内容');
  const classes = ['math-markdown', compact ? 'compact' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={
          compact
            ? {
                p: ({ children }) => <span>{children}</span>,
              }
            : undefined
        }
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
