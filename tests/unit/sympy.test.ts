import { describe, expect, it } from 'vitest';
import { equivalent, simplify, solve } from '@/mcp/sympy';

describe('sympy mcp wrapper', () => {
  it.each([
    ['x + x', '2x'],
    ['\\frac{1}{2}', '0.5'],
    ['答案：1/2', '\\frac{1}{2}'],
    ['x = \\frac{3}{2}', 'x=1.5'],
    ['x=2', '2'],
    ['2x=4', 'x=2'],
    ['（x+1）²', 'x^2 + 2x + 1'],
    ['根号16', '4'],
    ['x的平方', 'x^2'],
    ['3×(x+1)', '3x + 3'],
    ['6÷3', '2'],
    ['\\sqrt{25}', '5'],
    ['x⁰', '1'],
  ])('normalizes and matches %s with %s', async (a, b) => {
    await expect(equivalent(a, b)).resolves.toMatchObject({ equivalent: true });
  });

  it.each([
    ['x', 'y'],
    ['x=1', 'y=1'],
    ['x+1', 'x+2'],
  ])('keeps non-equivalent expressions distinct: %s vs %s', async (a, b) => {
    await expect(equivalent(a, b)).resolves.toMatchObject({ equivalent: false });
  });

  it('solves equations after normalization', async () => {
    await expect(solve('2x＝4')).resolves.toEqual(['x=2']);
  });

  it('simplifies LaTeX-like input after normalization', async () => {
    await expect(simplify('\\frac{2}{4}')).resolves.toBe('1/2');
  });
});
