import { describe, expect, it } from 'vitest';
import { ExplorerDataError, layoutView } from '../src/index.js';
// `layoutKey` is internal: the package entry does not export it.
import { layoutKey } from '../src/layout.js';
import type {
  ExplorerBox,
  ExplorerEdge,
  ExplorerLayout,
  ExplorerNode,
  ExplorerView,
  Vec2,
} from '../src/index.js';

const n = (id: string, extra: Partial<ExplorerNode> = {}): ExplorerNode => ({
  id,
  label: id.toUpperCase(),
  ...extra,
});
const e = (id: string, source: string, target: string): ExplorerEdge => ({ id, source, target });

/** a -> b -> c, default sizes, default direction. */
const chain = (over: Partial<ExplorerView> = {}): ExplorerView => ({
  id: 'v',
  label: 'View',
  nodes: [n('a'), n('b'), n('c')],
  edges: [e('ab', 'a', 'b'), e('bc', 'b', 'c')],
  ...over,
});

/** a and b only, with whatever edges the test wants between them. */
const pair = (edges: ExplorerEdge[], over: Partial<ExplorerView> = {}): ExplorerView => ({
  id: 'v',
  label: 'View',
  nodes: [n('a'), n('b')],
  edges,
  ...over,
});

function box(layout: ExplorerLayout, id: string): ExplorerBox {
  const found = layout.boxes.get(id);
  if (found === undefined) throw new Error(`no box for ${id}`);
  return found;
}

function route(layout: ExplorerLayout, id: string): readonly Vec2[] {
  const found = layout.routes.get(id);
  if (found === undefined) throw new Error(`no route for ${id}`);
  return found;
}

function ends(points: readonly Vec2[]): [Vec2, Vec2] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) throw new Error('empty route');
  return [first, last];
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ExplorerDataError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('layoutView, flowing right (the default)', () => {
  it('lays a chain out left to right, padded 40 off the origin', () => {
    const layout = layoutView(chain());
    expect(box(layout, 'a')).toEqual({ x: 40, y: 40, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 400, y: 40, width: 240, height: 120 });
    expect(box(layout, 'c')).toEqual({ x: 760, y: 40, width: 240, height: 120 });
    expect(layout.width).toBe(1040);
    expect(layout.height).toBe(200);
  });

  it('routes each edge from the source box edge to the target box edge', () => {
    const layout = layoutView(chain());
    expect(route(layout, 'ab')).toEqual([
      { x: 280, y: 100 },
      { x: 400, y: 100 },
    ]);
    expect(route(layout, 'bc')).toEqual([
      { x: 640, y: 100 },
      { x: 760, y: 100 },
    ]);
  });

  it('keeps boxes and routes in the order the data gave them', () => {
    const layout = layoutView(chain());
    expect([...layout.boxes.keys()]).toEqual(['a', 'b', 'c']);
    expect([...layout.routes.keys()]).toEqual(['ab', 'bc']);
  });

  it("honors a node's own size", () => {
    const layout = layoutView(
      pair([e('ab', 'a', 'b')], { nodes: [n('a', { size: { width: 400, height: 100 } }), n('b')] }),
    );
    expect(box(layout, 'a')).toEqual({ x: 40, y: 50, width: 400, height: 100 });
    expect(box(layout, 'b')).toEqual({ x: 560, y: 40, width: 240, height: 120 });
    expect(layout.width).toBe(840);
    expect(layout.height).toBe(200);
  });

  it("honors the view's nodeSize", () => {
    const layout = layoutView({
      id: 'v',
      label: 'View',
      nodes: [n('only')],
      edges: [],
      layout: { nodeSize: { width: 100, height: 50 } },
    });
    expect(box(layout, 'only')).toEqual({ x: 40, y: 40, width: 100, height: 50 });
    expect(layout.width).toBe(180);
    expect(layout.height).toBe(130);
  });

  it('spreads a fan across the flow', () => {
    const layout = layoutView(chain({ edges: [e('ab', 'a', 'b'), e('ac', 'a', 'c')] }));
    expect(box(layout, 'a')).toEqual({ x: 40, y: 120, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 400, y: 40, width: 240, height: 120 });
    expect(box(layout, 'c')).toEqual({ x: 400, y: 200, width: 240, height: 120 });
    expect(layout.width).toBe(680);
    expect(layout.height).toBe(360);
    const [start, end] = ends(route(layout, 'ab'));
    expect(start.x).toBe(280);
    expect(start.y).toBeCloseTo(153.33, 1);
    expect(end.x).toBe(400);
    expect(end.y).toBeCloseTo(126.67, 1);
  });
});

describe('layoutView, flowing down', () => {
  it('lays a chain out top to bottom', () => {
    const layout = layoutView(chain({ layout: { direction: 'down' } }));
    expect(box(layout, 'a')).toEqual({ x: 40, y: 40, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 40, y: 280, width: 240, height: 120 });
    expect(box(layout, 'c')).toEqual({ x: 40, y: 520, width: 240, height: 120 });
    expect(layout.width).toBe(320);
    expect(layout.height).toBe(680);
    expect(route(layout, 'ab')).toEqual([
      { x: 160, y: 160 },
      { x: 160, y: 280 },
    ]);
  });
});

describe('layoutView, parallel edges', () => {
  it('bows two edges between one pair apart, 16 between them, ends unmoved', () => {
    const layout = layoutView(pair([e('ab', 'a', 'b'), e('ab2', 'a', 'b')]));
    for (const id of ['ab', 'ab2']) {
      const [start, end] = ends(route(layout, id));
      expect(start).toEqual({ x: 280, y: 100 });
      expect(end).toEqual({ x: 400, y: 100 });
    }
    expect(route(layout, 'ab')).toContainEqual({ x: 340, y: 92 });
    expect(route(layout, 'ab2')).toContainEqual({ x: 340, y: 108 });
  });

  it('separates a cycle: two edges one way and one back', () => {
    const layout = layoutView(pair([e('ab', 'a', 'b'), e('ab2', 'a', 'b'), e('ba', 'b', 'a')]));
    expect(route(layout, 'ab')).toContainEqual({ x: 340, y: 84 });
    // The middle of three keeps the routed line.
    expect(route(layout, 'ab2')).toEqual([
      { x: 280, y: 100 },
      { x: 400, y: 100 },
    ]);
    // The reversed edge still runs from its own source, b, to its own target.
    const [start, end] = ends(route(layout, 'ba'));
    expect(start).toEqual({ x: 400, y: 100 });
    expect(end).toEqual({ x: 280, y: 100 });
    expect(route(layout, 'ba')).toContainEqual({ x: 340, y: 116 });
  });

  it('bows across the flow when flowing down', () => {
    const layout = layoutView(
      pair([e('ab', 'a', 'b'), e('ab2', 'a', 'b')], { layout: { direction: 'down' } }),
    );
    expect(route(layout, 'ab')).toContainEqual({ x: 152, y: 220 });
    expect(route(layout, 'ab2')).toContainEqual({ x: 168, y: 220 });
    for (const id of ['ab', 'ab2']) {
      const [start, end] = ends(route(layout, id));
      expect(start).toEqual({ x: 160, y: 160 });
      expect(end).toEqual({ x: 160, y: 280 });
    }
  });

  it('does not mistake ids containing a comma for one pair', () => {
    // Joined with a comma, 'a,b' + 'c' and 'a' + 'b,c' are the same string.
    // These two edges share no node, so neither may be bowed.
    const layout = layoutView({
      id: 'v',
      label: 'View',
      nodes: [n('a,b'), n('c'), n('a'), n('b,c')],
      edges: [e('e1', 'a,b', 'c'), e('e2', 'a', 'b,c')],
    });
    expect(route(layout, 'e1')).toHaveLength(2);
    expect(route(layout, 'e2')).toHaveLength(2);
  });
});

describe('layoutView, self loops', () => {
  it('keeps a self loop in the routes, empty, and lets it move nothing', () => {
    const plain = layoutView(pair([e('ab', 'a', 'b')]));
    const looped = layoutView(pair([e('ab', 'a', 'b'), e('aa', 'a', 'a')]));
    expect(route(looped, 'aa')).toEqual([]);
    expect([...looped.boxes]).toEqual([...plain.boxes]);
    expect(route(looped, 'ab')).toEqual(route(plain, 'ab'));
    expect(looped.width).toBe(plain.width);
    expect(looped.height).toBe(plain.height);
  });
});

describe('layoutView, groups', () => {
  it('outlines its members with 24 of padding and a 24 label band above', () => {
    const layout = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['b'] }] }));
    expect(layout.groups).toEqual([{ id: 'g', x: 376, y: 40, width: 288, height: 192 }]);
    expect(box(layout, 'a')).toEqual({ x: 40, y: 88, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 400, y: 88, width: 240, height: 120 });
    expect(layout.width).toBe(1040);
    expect(layout.height).toBe(272);
  });

  it('draws an outline that encloses a non-member unless strict', () => {
    const layout = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'c'] }] }));
    expect(layout.groups).toEqual([{ id: 'g', x: 40, y: 40, width: 1008, height: 192 }]);
    expect(box(layout, 'a')).toEqual({ x: 64, y: 88, width: 240, height: 120 });
    expect(layout.width).toBe(1088);
    expect(layout.height).toBe(272);
  });

  it('throws under strictGroups when an outline would enclose a non-member', () => {
    const view = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'c'] }] });
    expect(codeOf(() => layoutView(view, { strictGroups: true }))).toBe('GROUP_ENCLOSES_NON_MEMBER');
    expect(() => layoutView(view, { strictGroups: true })).toThrow(/"g".*"b"/);
    try {
      layoutView(view, { strictGroups: true });
    } catch (error) {
      // The subject is the group. The enclosed node is in the message.
      expect(error).toBeInstanceOf(ExplorerDataError);
      expect((error as ExplorerDataError).id).toBe('g');
      expect((error as ExplorerDataError).viewId).toBe('v');
    }
  });

  it('passes strictGroups when the outline is clear', () => {
    const view = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a'] }] });
    expect(codeOf(() => layoutView(view, { strictGroups: true }))).toBe('no error');
  });

  it('treats a member listed twice as listed once', () => {
    const once = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['b'] }] }));
    const twice = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['b', 'b'] }] }));
    expect(twice.groups).toEqual(once.groups);
  });
});

describe('layoutView, edges of the input', () => {
  it('gives an empty view an empty, zero-size layout', () => {
    const layout = layoutView({ id: 'v', label: 'View', nodes: [], edges: [] });
    expect(layout.boxes.size).toBe(0);
    expect(layout.routes.size).toBe(0);
    expect(layout.groups).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it('lays out a single node with no edges', () => {
    const layout = layoutView({ id: 'v', label: 'View', nodes: [n('only')], edges: [] });
    expect(box(layout, 'only')).toEqual({ x: 40, y: 40, width: 240, height: 120 });
    expect(layout.width).toBe(320);
    expect(layout.height).toBe(200);
  });

  it('validates before it lays out', () => {
    const view = chain({ edges: [e('ax', 'a', 'x')] });
    expect(codeOf(() => layoutView(view))).toBe('MISSING_EDGE_ENDPOINT');
  });

  it('draws orthogonal edges as axis-aligned segments', () => {
    const layout = layoutView(
      chain({ edges: [e('ab', 'a', 'b'), e('ac', 'a', 'c')], layout: { edgeStyle: 'orthogonal' } }),
    );
    const points = route(layout, 'ab');
    expect(points.length).toBeGreaterThan(2);
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) throw new Error('hole in route');
      expect(from.x === to.x || from.y === to.y).toBe(true);
    }
  });
});

describe('layoutKey', () => {
  it('is equal for data re-created with the same shape', () => {
    expect(layoutKey(chain())).toBe(layoutKey(chain()));
  });

  it('ignores labels, colors and descriptions', () => {
    const relabeled = chain({
      label: 'Renamed',
      description: 'Now with words',
      nodes: [n('a', { label: 'Alpha', color: 'red' }), n('b'), n('c')],
      edges: [{ ...e('ab', 'a', 'b'), label: 'calls', color: 'blue', dash: true }, e('bc', 'b', 'c')],
    });
    expect(layoutKey(relabeled)).toBe(layoutKey(chain()));
  });

  it('changes with anything that moves the layout', () => {
    const base = layoutKey(chain());
    const changed = [
      chain({ nodes: [n('a', { size: { width: 10, height: 10 } }), n('b'), n('c')] }),
      chain({ edges: [e('ab', 'a', 'b'), e('bc', 'c', 'b')] }),
      chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a'] }] }),
      chain({ layout: { direction: 'down' } }),
      chain({ layout: { nodeSep: 41 } }),
      chain({ layout: { rankSep: 121 } }),
      chain({ layout: { edgeStyle: 'orthogonal' } }),
      chain({ layout: { nodeSize: { width: 100, height: 50 } } }),
    ];
    for (const view of changed) expect(layoutKey(view)).not.toBe(base);
  });

  it('changes when only group membership changes', () => {
    const one = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a'] }] });
    const two = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'b'] }] });
    expect(layoutKey(one)).not.toBe(layoutKey(two));
  });

  it('does not collide for ids containing a comma', () => {
    const left = chain({ nodes: [n('a,b'), n('c')], edges: [] });
    const right = chain({ nodes: [n('a'), n('b,c')], edges: [] });
    expect(layoutKey(left)).not.toBe(layoutKey(right));
  });
});
