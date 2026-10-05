// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Camera2D } from '../src/camera.js';
import { createNodeGroupLayer, nodeGroupBounds } from '../src/node-groups.js';
import type { NodeGroupMember } from '../src/node-groups.js';

const nodes: NodeGroupMember[] = [
  { id: 'a', center: { x: -40, y: 30 }, size: { width: 40, height: 20 } },
  { id: 'b', center: { x: 60, y: -20 }, size: { width: 20, height: 40 } },
  { id: 'external', center: { x: 900, y: 0 }, size: { width: 200, height: 200 } },
];
afterEach(() => document.body.replaceChildren());

describe('node group bounds', () => {
  it('contains exactly the selected node boxes with padding and a title band, in y-up coordinates', () => {
    expect(
      nodeGroupBounds(nodes, { id: 'platform', nodeIds: ['a', 'b'], padding: 10, label: 'Platform' }),
    ).toEqual({ minX: -70, maxX: 80, minY: -50, maxY: 74 });
  });
  it('ignores missing and repeated members and hides an empty group', () => {
    expect(nodeGroupBounds(nodes, { id: 'g', nodeIds: ['a', 'a', 'missing'], padding: 0 })).toEqual(
      { minX: -60, maxX: -20, minY: 20, maxY: 40 },
    );
    expect(nodeGroupBounds(nodes, { id: 'g', nodeIds: ['missing'] })).toBeNull();
  });
  it('rejects invalid geometry and options instead of drawing a misleading boundary', () => {
    expect(() => nodeGroupBounds(nodes, { id: 'g', nodeIds: ['a'], padding: -1 })).toThrow(
      RangeError,
    );
    expect(() => nodeGroupBounds(nodes, { id: 'g', nodeIds: ['a'], color: Infinity })).toThrow(
      RangeError,
    );
    expect(() =>
      nodeGroupBounds([{ id: 'a', center: { x: NaN, y: 0 }, size: { width: 1, height: 1 } }], {
        id: 'g',
        nodeIds: ['a'],
      }),
    ).toThrow(RangeError);
    expect(() => nodeGroupBounds([nodes[0]!, nodes[0]!], { id: 'g', nodeIds: ['a'] })).toThrow(
      RangeError,
    );
  });
});

function setup() {
  const parent = document.createElement('div');
  parent.style.position = 'relative';
  document.body.append(parent);
  const camera = new Camera2D({ viewport: { width: 640, height: 400, devicePixelRatio: 2 } });
  const layer = createNodeGroupLayer({ parent, camera });
  layer.setGroups([{ id: 'platform', nodeIds: ['a', 'b'], label: 'Platform' }]);
  layer.setNodes(nodes);
  layer.sync();
  return { parent, camera, layer, rect: parent.querySelector('rect')! };
}

describe('node group layer', () => {
  it('tracks the same camera as nodes, with fixed screen-space strokes and no pointer capture', () => {
    const { parent, camera, layer, rect } = setup();
    const width = Number(rect.getAttribute('width'));
    camera.zoomAtScreen({ x: 320, y: 200 }, 2);
    layer.sync();
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(width * 2);
    expect(rect.getAttribute('stroke-width')).toBe('1.5');
    expect(rect.getAttribute('fill')).toBe('none');
    expect(parent.querySelector('svg')?.style.pointerEvents).toBe('none');
    expect(parent.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    layer.dispose();
    expect(parent.children).toHaveLength(0);
    layer.dispose();
  });
  it('follows intermediate node movement and removes a group when its last member disappears', () => {
    const { parent, layer, rect } = setup();
    const before = Number(rect.getAttribute('width'));
    layer.setNodes(nodes.map((n) => (n.id === 'b' ? { ...n, center: { x: 100, y: -20 } } : n)));
    layer.sync();
    expect(Number(rect.getAttribute('width'))).toBe(before + 40);
    layer.setNodes([]);
    layer.sync();
    expect(parent.querySelector('g')?.getAttribute('display')).toBe('none');
  });
  it('does not inspect or retain geometry of nodes outside the groups', () => {
    const { layer, rect } = setup();
    const outside = {
      id: 'outside',
      get center(): never {
        throw new Error('unrelated geometry read');
      },
      get size(): never {
        throw new Error('unrelated geometry read');
      },
    };
    expect(() => layer.setNodes([...nodes, outside])).not.toThrow();
    layer.sync();
    expect(Number(rect.getAttribute('width'))).toBeGreaterThan(0);
  });
  it('updates group definitions atomically and treats labels as text', () => {
    const { parent, layer } = setup();
    expect(() =>
      layer.setGroups([
        { id: 'x', nodeIds: [] },
        { id: 'x', nodeIds: [] },
      ]),
    ).toThrow(RangeError);
    expect(parent.querySelector('g')?.getAttribute('data-group-id')).toBe('platform');
    layer.setGroups([{ id: 'x', nodeIds: ['a'], label: '<script>bad</script>' }]);
    layer.setNodes(nodes);
    layer.sync();
    expect(parent.querySelector('script')).toBeNull();
    expect(parent.querySelector('text')?.textContent).toBe('<script>bad</script>');
    layer.setGroups([]);
    expect(parent.querySelectorAll('g')).toHaveLength(0);
  });
});
