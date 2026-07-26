import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type { DagrGraphErrorCode, Edge, Node } from '../src/index.js';

describe('@dagr/graph public surface', () => {
  it('exports the Graph class', () => {
    expect(typeof api.Graph).toBe('function');
    const graph = new api.Graph();
    expect(graph.nodeCount).toBe(0);
  });

  it('exports every error class', () => {
    expect(typeof api.DagrGraphError).toBe('function');
    expect(typeof api.InvalidIdError).toBe('function');
    expect(typeof api.DuplicateNodeError).toBe('function');
    expect(typeof api.NodeNotFoundError).toBe('function');
    expect(typeof api.DuplicateEdgeError).toBe('function');
    expect(typeof api.EdgeNotFoundError).toBe('function');
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DagrGraphError',
      'DuplicateEdgeError',
      'DuplicateNodeError',
      'EdgeNotFoundError',
      'Graph',
      'InvalidIdError',
      'NodeNotFoundError',
    ]);
  });

  it('exports the DagrGraphErrorCode type, and every code is a member of it', () => {
    const codes: DagrGraphErrorCode[] = [
      new api.InvalidIdError('node', '').code,
      new api.DuplicateNodeError('a').code,
      new api.NodeNotFoundError('a').code,
      new api.DuplicateEdgeError('e1').code,
      new api.EdgeNotFoundError('e1').code,
    ];
    expect(codes).toEqual([
      'INVALID_ID',
      'DUPLICATE_NODE',
      'NODE_NOT_FOUND',
      'DUPLICATE_EDGE',
      'EDGE_NOT_FOUND',
    ]);
  });

  it('exports the Node and Edge types', () => {
    const graph = new api.Graph();
    const node: Node = graph.addNode('a');
    graph.addNode('b');
    const edge: Edge = graph.addEdge('a', 'b', 'ab');
    expect(node.id).toBe('a');
    expect(edge.source).toBe('a');
  });
});
