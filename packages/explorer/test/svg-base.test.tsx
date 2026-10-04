// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ExplorerBaseProps } from '../src/base.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from '../src/index.js';
import { layoutView } from '../src/index.js';
import { svgBase } from '../src/svg-base.js';
import type { ExplorerVisibleSet } from '../src/visible-set.js';
import { mount } from './dom.js';
import type { Mounted } from './dom.js';

/** a -> b -> c, a dashed red edge, a self loop on c, and a group around a and b. */
const view: ExplorerView = {
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A', color: 'rgb(1, 2, 3)' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b', dash: true, color: 'rgb(200, 0, 0)' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'cc', source: 'c', target: 'c' },
  ],
  groups: [{ id: 'g', label: 'Trust boundary', nodeIds: ['a', 'b'] }],
};
const layout = layoutView(view);

const everything: ExplorerVisibleSet = {
  overlay: new Map(),
  baseNodes: ['a', 'b', 'c'],
  edges: ['ab', 'bc', 'cc'],
};
const noEmphasis = { selectedId: null, dimmed: new Set<string>() };

let tree: Mounted | null = null;
afterEach(async () => {
  await tree?.unmount();
  tree = null;
});

async function draw(props: Partial<ExplorerBaseProps<ExplorerNode, ExplorerEdge>> = {}): Promise<SVGSVGElement> {
  const Layer = svgBase.Layer;
  tree = await mount(
    <Layer view={view} layout={layout} visible={everything} emphasis={noEmphasis} {...props} />,
  );
  const svg = tree.container.querySelector('svg');
  if (svg === null) throw new Error('no svg');
  return svg;
}

const ids = (svg: Element, selector: string, attribute: string): (string | null)[] =>
  [...svg.querySelectorAll(selector)].map((element) => element.getAttribute(attribute));

describe('svgBase', () => {
  it('renders inside the plane, as a hidden svg the size of the layout', async () => {
    expect(svgBase.space).toBe('plane');
    const svg = await draw();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe(String(layout.width));
    expect(svg.getAttribute('height')).toBe(String(layout.height));
  });

  it('draws only the visible edges and the base nodes, in the order given', async () => {
    const svg = await draw({
      visible: { overlay: new Map([['a', 'summary']]), baseNodes: ['c', 'b'], edges: ['bc'] },
    });
    expect(ids(svg, 'rect[data-node-id]', 'data-node-id')).toEqual(['c', 'b']);
    expect(ids(svg, 'path[data-edge-id]', 'data-edge-id')).toEqual(['bc']);
  });

  it('draws each node mark at its box, filled with its color', async () => {
    const svg = await draw();
    const mark = svg.querySelector('rect[data-node-id="a"]');
    const box = layout.boxes.get('a');
    expect(box).toBeDefined();
    expect(mark?.getAttribute('x')).toBe(String(box?.x));
    expect(mark?.getAttribute('y')).toBe(String(box?.y));
    expect(mark?.getAttribute('width')).toBe(String(box?.width));
    expect(mark?.getAttribute('height')).toBe(String(box?.height));
    expect(mark?.getAttribute('fill')).toBe('rgb(1, 2, 3)');
    expect(svg.querySelector('rect[data-node-id="b"]')?.getAttribute('fill')).toBe('currentColor');
  });

  it('draws each group as a rectangle with its label', async () => {
    const svg = await draw();
    const group = svg.querySelector('[data-group-id="g"]');
    const rect = group?.querySelector('rect');
    const box = layout.groups.get('g');
    expect(box).toBeDefined();
    expect(rect?.getAttribute('x')).toBe(String(box?.x));
    expect(rect?.getAttribute('y')).toBe(String(box?.y));
    expect(rect?.getAttribute('width')).toBe(String(box?.width));
    expect(rect?.getAttribute('height')).toBe(String(box?.height));
    expect(group?.querySelector('text')?.textContent).toBe('Trust boundary');
  });

  it('draws an edge through its route, with dash, color and an arrowhead', async () => {
    const svg = await draw();
    const dashed = svg.querySelector('path[data-edge-id="ab"]');
    const plain = svg.querySelector('path[data-edge-id="bc"]');
    const route = layout.routes.get('bc') ?? [];
    const expected = route.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(p.x)} ${String(p.y)}`).join(' ');
    expect(plain?.getAttribute('d')).toBe(expected);

    expect(dashed?.getAttribute('stroke')).toBe('rgb(200, 0, 0)');
    expect(dashed?.getAttribute('stroke-dasharray')).not.toBeNull();
    expect(plain?.getAttribute('stroke')).toBe('currentColor');
    expect(plain?.getAttribute('stroke-dasharray')).toBeNull();

    for (const path of [dashed, plain]) {
      const reference = /^url\(#(.+)\)$/.exec(path?.getAttribute('marker-end') ?? '');
      expect(reference).not.toBeNull();
      const marker = svg.querySelector(`marker[id="${reference?.[1] ?? ''}"]`);
      expect(marker).not.toBeNull();
      // The arrowhead takes the edge's own color.
      expect(marker?.querySelector('path')?.getAttribute('fill')).toBe(path?.getAttribute('stroke'));
    }
  });

  it('gives two layers on one page different marker ids', async () => {
    const Layer = svgBase.Layer;
    tree = await mount(
      <>
        <Layer view={view} layout={layout} visible={everything} emphasis={noEmphasis} />
        <Layer view={view} layout={layout} visible={everything} emphasis={noEmphasis} />
      </>,
    );
    const markers = [...tree.container.querySelectorAll('marker')].map((m) => m.id);
    expect(new Set(markers).size).toBe(markers.length);
  });

  it('dims a mark, and an edge with a dimmed end at either side', async () => {
    const svg = await draw({ emphasis: { selectedId: null, dimmed: new Set(['b']) } });
    expect(svg.querySelector('rect[data-node-id="b"]')?.hasAttribute('data-dimmed')).toBe(true);
    expect(svg.querySelector('rect[data-node-id="a"]')?.hasAttribute('data-dimmed')).toBe(false);
    expect(svg.querySelector('path[data-edge-id="ab"]')?.hasAttribute('data-dimmed')).toBe(true);
    expect(svg.querySelector('path[data-edge-id="bc"]')?.hasAttribute('data-dimmed')).toBe(true);

    await tree?.rerender(
      <svgBase.Layer
        view={view}
        layout={layout}
        visible={everything}
        emphasis={{ selectedId: null, dimmed: new Set(['a']) }}
      />,
    );
    expect(svg.querySelector('path[data-edge-id="ab"]')?.hasAttribute('data-dimmed')).toBe(true);
    expect(svg.querySelector('path[data-edge-id="bc"]')?.hasAttribute('data-dimmed')).toBe(false);
  });

  it('draws no path for an edge with an empty route', async () => {
    expect(layout.routes.get('cc')).toEqual([]);
    const svg = await draw();
    expect(svg.querySelector('path[data-edge-id="cc"]')).toBeNull();
  });

  it('skips ids the layout does not have, as a set from a previous layout would', async () => {
    const svg = await draw({ visible: { overlay: new Map(), baseNodes: ['gone', 'a'], edges: ['gone', 'ab'] } });
    expect(ids(svg, 'rect[data-node-id]', 'data-node-id')).toEqual(['a']);
    expect(ids(svg, 'path[data-edge-id]', 'data-edge-id')).toEqual(['ab']);
  });
});
