/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { readCssColors, useCssColors } from '../src/use-css-colors.js';
import { mount, flush } from './mount.js';
import type { Mounted } from './mount.js';

let tree: Mounted | undefined;
afterEach(async () => { await tree?.unmount(); tree = undefined; vi.restoreAllMocks(); });

function canvas(): void {
  let fill = '#000000';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    get fillStyle() { return fill; },
    set fillStyle(value: string) { if (/^#[0-9a-f]{6}$/i.test(value)) fill = value; },
    clearRect: vi.fn(), fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([
      parseInt(fill.slice(1, 3), 16), parseInt(fill.slice(3, 5), 16), parseInt(fill.slice(5, 7), 16), 255,
    ]) }),
  } as unknown as CanvasRenderingContext2D);
}

it('converts opaque CSS colours and ignores missing or invalid variables', () => {
  canvas();
  const element = document.createElement('div');
  element.style.setProperty('--brand', '#123456');
  element.style.setProperty('--bad', 'garbage');
  document.body.append(element);
  expect(readCssColors(element, ['--brand', '--bad', '--missing'])).toEqual({ '--brand': 0x123456 });
  element.remove();
});

it('refreshes bindings on root and ancestor theme changes, and disconnects on unmount', async () => {
  canvas();
  function Example() {
    const ref = useRef<HTMLDivElement>(null);
    const colors = useCssColors(ref, { series: { orders: '--brand' } });
    return <div ref={ref} style={{ '--brand': '#123456' } as React.CSSProperties}>{colors['--brand']}</div>;
  }
  tree = await mount(<Example />);
  expect(tree.container.textContent).toBe(String(0x123456));
  const root = tree.container.firstElementChild as HTMLElement;
  await flush(() => { root.style.setProperty('--brand', '#abcdef'); });
  expect(tree.container.textContent).toBe(String(0xabcdef));
  const computed = vi.spyOn(window, 'getComputedStyle');
  await flush(() => { document.documentElement.classList.add('dark'); });
  expect(computed).toHaveBeenCalled();
  await tree.unmount();
  computed.mockClear();
  await flush(() => { document.documentElement.classList.remove('dark'); });
  expect(computed).not.toHaveBeenCalled();
});
