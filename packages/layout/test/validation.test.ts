import { describe, expect, it } from 'vitest';
import { LayoutError, layout } from '../src/index.js';
import type { LayoutErrorCode, LayoutInput } from '../src/index.js';

/** Assert that laying out `input` throws a LayoutError carrying exactly `code`. */
function expectLayoutCode(input: LayoutInput, code: LayoutErrorCode): void {
  let thrown: unknown;
  try {
    layout(input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LayoutError);
  expect((thrown as LayoutError).code).toBe(code);
}

describe('input validation', () => {
  it('rejects duplicate node ids', () => {
    expectLayoutCode(
      {
        nodes: [
          { id: 'a', width: 10, height: 10 },
          { id: 'a', width: 20, height: 20 },
        ],
        edges: [],
      },
      'DUPLICATE_NODE_ID',
    );
  });

  it('rejects duplicate edge ids', () => {
    expectLayoutCode(
      {
        nodes: [
          { id: 'a', width: 10, height: 10 },
          { id: 'b', width: 10, height: 10 },
        ],
        edges: [
          { id: 'e', source: 'a', target: 'b' },
          { id: 'e', source: 'b', target: 'a' },
        ],
      },
      'DUPLICATE_EDGE_ID',
    );
  });

  it('rejects an empty node id', () => {
    expectLayoutCode({ nodes: [{ id: '', width: 10, height: 10 }], edges: [] }, 'EMPTY_NODE_ID');
  });

  it('rejects an unknown edge source', () => {
    expectLayoutCode(
      {
        nodes: [{ id: 'a', width: 10, height: 10 }],
        edges: [{ id: 'e', source: 'ghost', target: 'a' }],
      },
      'UNKNOWN_EDGE_SOURCE',
    );
  });

  it('rejects an unknown edge target', () => {
    expectLayoutCode(
      {
        nodes: [{ id: 'a', width: 10, height: 10 }],
        edges: [{ id: 'e', source: 'a', target: 'ghost' }],
      },
      'UNKNOWN_EDGE_TARGET',
    );
  });

  it('rejects negative and non-finite node sizes', () => {
    expectLayoutCode({ nodes: [{ id: 'a', width: -1, height: 10 }], edges: [] }, 'INVALID_NODE_SIZE');
    expectLayoutCode({ nodes: [{ id: 'a', width: 10, height: -1 }], edges: [] }, 'INVALID_NODE_SIZE');
    expectLayoutCode({ nodes: [{ id: 'a', width: Number.NaN, height: 10 }], edges: [] }, 'INVALID_NODE_SIZE');
    expectLayoutCode(
      { nodes: [{ id: 'a', width: 10, height: Number.POSITIVE_INFINITY }], edges: [] },
      'INVALID_NODE_SIZE',
    );
  });

  it('accepts zero-sized nodes', () => {
    expect(() => layout({ nodes: [{ id: 'a', width: 0, height: 0 }], edges: [] })).not.toThrow();
  });

  it('validates config before it validates input', () => {
    expectLayoutCodeWithOptions();
  });

  function expectLayoutCodeWithOptions(): void {
    let thrown: unknown;
    try {
      layout({ nodes: [{ id: '', width: 10, height: 10 }], edges: [] }, { nodeSpacing: -1 });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as LayoutError).code).toBe('INVALID_SPACING');
  }

  it('accepts an empty graph', () => {
    const result = layout({ nodes: [], edges: [] });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('accepts parallel edges and self loops', () => {
    expect(() =>
      layout({
        nodes: [
          { id: 'a', width: 10, height: 10 },
          { id: 'b', width: 10, height: 10 },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'a', target: 'b' },
          { id: 'loop', source: 'a', target: 'a' },
        ],
      }),
    ).not.toThrow();
  });
});
