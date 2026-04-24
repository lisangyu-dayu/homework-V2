import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MathMarkdown } from '@/components/math-markdown';

describe('MathMarkdown', () => {
  it('renders markdown and LaTeX with katex output', () => {
    const html = renderToStaticMarkup(
      <MathMarkdown content={'已知 $x^2 + 1$。\n\n$$\\frac{1}{2}$$'} />,
    );

    expect(html).toContain('math-markdown');
    expect(html).toContain('katex');
    expect(html).toContain('<p>已知');
    expect(html).toContain('\\frac{1}{2}');
  });

  it('normalizes \\( \\) delimiters in compact mode', () => {
    const html = renderToStaticMarkup(<MathMarkdown content={'\\(x+1\\)'} compact />);

    expect(html).toContain('compact');
    expect(html).toContain('katex');
  });
});
