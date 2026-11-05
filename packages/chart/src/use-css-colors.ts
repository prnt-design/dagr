import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ChartCssColors } from './styling.js';

/** Canvas converts modern CSS colours (including Tailwind's OKLCH) into sRGB bytes. */
export function readCssColors(root: HTMLElement, names: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  const computed = getComputedStyle(root);
  const values = names.map((name) => [name, computed.getPropertyValue(name).trim()] as const).filter(([, value]) => value);
  if (values.length === 0) return result;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return result;
  for (const [name, token] of values) {
    const value = token.toLowerCase() === 'currentcolor' ? computed.color : token;
    context.fillStyle = '#010203';
    context.fillStyle = value;
    const first = context.fillStyle;
    context.fillStyle = '#040506';
    context.fillStyle = value;
    if (first !== context.fillStyle) continue;
    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    if (a === 255) result[name] = ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0);
  }
  return result;
}

export function useCssColors(rootRef: RefObject<HTMLDivElement | null>, mapping?: ChartCssColors): Readonly<Record<string, number>> {
  const [colors, setColors] = useState<Record<string, number>>({});
  const key = JSON.stringify(mapping ?? {});
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const parsed = JSON.parse(key) as ChartCssColors;
    const names = [...new Set([parsed.background, parsed.grid, parsed.baseline, ...Object.values(parsed.series ?? {})]
      .filter((name): name is `--${string}` => name !== undefined))];
    const refresh = (): void => {
      const next = readCssColors(root, names);
      setColors((was) => JSON.stringify(was) === JSON.stringify(next) ? was : next);
    };
    refresh();
    if (names.length === 0) return;
    // Observe just the ancestry, not every animation frame or DOM mark.
    const observer = new MutationObserver(refresh);
    for (let element: HTMLElement | null = root; element !== null; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', refresh);
    window.addEventListener('resize', refresh);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, [key, rootRef]);
  return colors;
}
