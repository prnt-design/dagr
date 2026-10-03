import { describe, expect, it } from 'vitest';
import { ExplorerDataError, validateView, validateViews } from '../src/index.js';
import type { ExplorerView } from '../src/index.js';

const view = (over: Partial<ExplorerView> = {}): ExplorerView => ({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b' }],
  ...over,
});

/** The code of the `ExplorerDataError` a call throws, or `'no error'`. */
function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ExplorerDataError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('validateView', () => {
  it('accepts a well-formed view', () => {
    expect(codeOf(() => validateView(view()))).toBe('no error');
  });

  it('accepts an empty view', () => {
    expect(codeOf(() => validateView(view({ nodes: [], edges: [] })))).toBe('no error');
  });

  it('accepts a self loop and parallel edges', () => {
    const edges = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'ab2', source: 'a', target: 'b' },
      { id: 'aa', source: 'a', target: 'a' },
    ];
    expect(codeOf(() => validateView(view({ edges })))).toBe('no error');
  });

  it('rejects two nodes with one id, and names it', () => {
    const nodes = [
      { id: 'a', label: 'A' },
      { id: 'a', label: 'Again' },
    ];
    expect(codeOf(() => validateView(view({ nodes, edges: [] })))).toBe('DUPLICATE_NODE_ID');
    expect(() => validateView(view({ nodes, edges: [] }))).toThrow(/"a".*view "v"/);
  });

  it('rejects two edges with one id', () => {
    const edges = [
      { id: 'e', source: 'a', target: 'b' },
      { id: 'e', source: 'b', target: 'a' },
    ];
    expect(codeOf(() => validateView(view({ edges })))).toBe('DUPLICATE_EDGE_ID');
  });

  it('rejects an edge whose endpoint is not in the view, and names both', () => {
    const edges = [{ id: 'ax', source: 'a', target: 'x' }];
    expect(codeOf(() => validateView(view({ edges })))).toBe('MISSING_EDGE_ENDPOINT');
    expect(() => validateView(view({ edges }))).toThrow(/"ax".*"x"/);
  });

  it('rejects two groups with one id', () => {
    const groups = [
      { id: 'g', label: 'One', nodeIds: ['a'] },
      { id: 'g', label: 'Two', nodeIds: ['b'] },
    ];
    expect(codeOf(() => validateView(view({ groups })))).toBe('DUPLICATE_GROUP_ID');
  });

  it('rejects a group with no members', () => {
    const groups = [{ id: 'g', label: 'Empty', nodeIds: [] }];
    expect(codeOf(() => validateView(view({ groups })))).toBe('EMPTY_GROUP');
  });

  it('rejects a group naming a node the view lacks, and names both', () => {
    const groups = [{ id: 'g', label: 'G', nodeIds: ['a', 'x'] }];
    expect(codeOf(() => validateView(view({ groups })))).toBe('MISSING_GROUP_MEMBER');
    expect(() => validateView(view({ groups }))).toThrow(/"g".*"x"/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a node whose own width is %s, and names the node',
    (width) => {
      const nodes = [{ id: 'a', label: 'A', size: { width, height: 10 } }];
      expect(codeOf(() => validateView(view({ nodes, edges: [] })))).toBe('INVALID_NODE_SIZE');
      expect(() => validateView(view({ nodes, edges: [] }))).toThrow(/"a"/);
    },
  );

  it('rejects a bad size from the view value and from the view function', () => {
    const value = view({ layout: { nodeSize: { width: 100, height: 0 } } });
    expect(codeOf(() => validateView(value))).toBe('INVALID_NODE_SIZE');
    const fn = view({ layout: { nodeSize: () => ({ width: Number.NaN, height: 10 }) } });
    expect(codeOf(() => validateView(fn))).toBe('INVALID_NODE_SIZE');
  });

  it('carries the offender and its view as fields, not only in the message', () => {
    const caught = (run: () => void): ExplorerDataError => {
      try {
        run();
      } catch (error) {
        if (error instanceof ExplorerDataError) return error;
        throw error;
      }
      throw new Error('did not throw');
    };

    const node = caught(() =>
      validateView(view({ nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }], edges: [] })),
    );
    expect([node.code, node.id, node.viewId]).toEqual(['DUPLICATE_NODE_ID', 'a', 'v']);

    // For an edge error the subject is the EDGE. The missing node is in the message.
    const edge = caught(() => validateView(view({ edges: [{ id: 'ax', source: 'a', target: 'x' }] })));
    expect([edge.code, edge.id, edge.viewId]).toEqual(['MISSING_EDGE_ENDPOINT', 'ax', 'v']);

    const group = caught(() =>
      validateView(view({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'x'] }] })),
    );
    expect([group.code, group.id, group.viewId]).toEqual(['MISSING_GROUP_MEMBER', 'g', 'v']);

    const size = caught(() =>
      validateView(view({ nodes: [{ id: 'a', label: 'A', size: { width: 0, height: 1 } }], edges: [] })),
    );
    expect([size.code, size.id, size.viewId]).toEqual(['INVALID_NODE_SIZE', 'a', 'v']);

    // A view error is about the view itself, so there is no enclosing view.
    const dup = caught(() => validateViews([view(), view()]));
    expect([dup.code, dup.id, dup.viewId]).toEqual(['DUPLICATE_VIEW_ID', 'v', undefined]);
  });

  it('throws a real Error subclass with a name', () => {
    try {
      validateView(view({ groups: [{ id: 'g', label: 'G', nodeIds: [] }] }));
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExplorerDataError);
      expect((error as ExplorerDataError).name).toBe('ExplorerDataError');
    }
  });
});

describe('validateViews', () => {
  it('rejects two views with one id', () => {
    expect(codeOf(() => validateViews([view(), view()]))).toBe('DUPLICATE_VIEW_ID');
  });

  it('lets two views reuse node and edge ids', () => {
    expect(codeOf(() => validateViews([view(), view({ id: 'w' })]))).toBe('no error');
  });

  it('validates every view, not only the first', () => {
    const bad = view({ id: 'w', edges: [{ id: 'ax', source: 'a', target: 'x' }] });
    expect(codeOf(() => validateViews([view(), bad]))).toBe('MISSING_EDGE_ENDPOINT');
  });

  it('accepts no views at all', () => {
    expect(codeOf(() => validateViews([]))).toBe('no error');
  });
});
