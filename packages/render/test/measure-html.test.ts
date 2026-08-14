// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { measureHtmlSizes } from '../src/measure-html.js';

/**
 * The measurement helper's plumbing.
 *
 * **jsdom has no layout engine, so it cannot measure anything: every
 * `getBoundingClientRect` there is zeros.** That is a real limit on what this
 * file can claim and it is worth being plain about rather than dressing it up.
 * What IS checkable without layout is the part most likely to be wrong and the
 * part the docstring makes promises about: that every element is mounted before
 * anything is read, that the container is styled so a browser WOULD measure the
 * right thing, that it is removed afterwards, and that ids map to the elements
 * they came from. The sizes themselves are stubbed per element, so the mapping
 * is asserted rather than the browser's arithmetic.
 *
 * What no test here establishes: that a real browser returns the size the
 * content will have where it is finally drawn. That is on the untested list in
 * `docs/docs/render.md` with the rest.
 */

function makeParent(): HTMLElement {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
}

/** An element whose measured size is fixed, so the mapping can be asserted. */
function sized(width: number, height: number): HTMLElement {
  const element = document.createElement('div');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });
  return element;
}

describe('measureHtmlSizes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns one size per id', () => {
    const parent = makeParent();
    const sizes = measureHtmlSizes(
      [
        { id: 'a', create: () => sized(120, 40) },
        { id: 'b', create: () => sized(64, 18) },
      ],
      { parent },
    );

    expect(sizes.get('a')).toEqual({ width: 120, height: 40 });
    expect(sizes.get('b')).toEqual({ width: 64, height: 18 });
    expect(sizes.size).toBe(2);
  });

  it('mounts every element before it reads any of them', () => {
    // The whole reason this helper exists. A browser flushes pending layout
    // when it is asked for a geometric property, so a mount interleaved with a
    // read is a layout per node: 2,800 nodes become 2,800 layouts of a growing
    // tree. The order below is what makes it one.
    const parent = makeParent();
    const order: string[] = [];
    const item = (id: string): { id: string; create: () => HTMLElement } => ({
      id,
      create: () => {
        order.push(`create:${id}`);
        const element = document.createElement('div');
        vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
          order.push(`read:${id}`);
          return new DOMRect(0, 0, 10, 10);
        });
        return element;
      },
    });

    measureHtmlSizes([item('a'), item('b'), item('c')], { parent });

    expect(order).toEqual([
      'create:a',
      'create:b',
      'create:c',
      'read:a',
      'read:b',
      'read:c',
    ]);
  });

  it('measures inside the parent, and leaves nothing behind', () => {
    // Inside the parent because inherited font, line height and custom
    // properties decide the answer: a card measured under the page's styles and
    // drawn under the overlay's is measured wrong, silently.
    const parent = makeParent();
    // Captured through arrays rather than reassigned locals, so the compiler
    // does not narrow them to `never` across the callback.
    const containers: HTMLElement[] = [];
    const grandparents: Node[] = [];

    measureHtmlSizes(
      [
        {
          id: 'a',
          create: () => {
            const element = sized(10, 10);
            vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
              const container = element.parentElement;
              if (container !== null) containers.push(container);
              const grandparent = container?.parentNode;
              if (grandparent != null) grandparents.push(grandparent);
              return new DOMRect(0, 0, 10, 10);
            });
            return element;
          },
        },
      ],
      { parent, className: 'measuring' },
    );

    expect(grandparents[0]).toBe(parent);
    const container = containers[0];
    expect(container).toBeInstanceOf(HTMLElement);
    if (container === undefined) return;
    expect(container.className).toBe('measuring');
    // `visibility: hidden` rather than `display: none`, which has no box at all
    // and would measure zero on every axis.
    expect(container.style.visibility).toBe('hidden');
    expect(container.style.display).not.toBe('none');
    // Offscreen to the LEFT: a container to the right can extend the document's
    // scrollable width and flash a horizontal scrollbar.
    expect(Number.parseFloat(container.style.left)).toBeLessThan(0);
    // A width, so an absolutely positioned item shrinks to fit something rather
    // than to its minimum content width, which for prose is one word per line.
    expect(Number.parseFloat(container.style.width)).toBeGreaterThan(1000);

    expect(parent.children.length).toBe(0);
  });

  it('constrains an item that says how wide it will be', () => {
    const parent = makeParent();
    let maxWidth = '';
    measureHtmlSizes(
      [
        {
          id: 'a',
          maxWidth: 180,
          create: () => {
            const element = sized(180, 60);
            vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
              maxWidth = element.style.maxWidth;
              return new DOMRect(0, 0, 180, 60);
            });
            return element;
          },
        },
      ],
      { parent },
    );

    expect(maxWidth).toBe('180px');
  });

  it('refuses two items with the same id', () => {
    // Keeping one of them silently would hand a layout a size that belongs to a
    // different node, which is the kind of wrong that looks right.
    const parent = makeParent();
    expect(() =>
      measureHtmlSizes(
        [
          { id: 'a', create: () => sized(10, 10) },
          { id: 'a', create: () => sized(20, 20) },
        ],
        { parent },
      ),
    ).toThrow(RangeError);
  });
});
