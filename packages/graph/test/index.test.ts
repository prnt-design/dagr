import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  AttrsPatch,
  DagrGraphErrorCode,
  DagrGraphErrorLike,
  Edge,
  EdgeInit,
  Node,
  NodeInit,
  Patch,
  PatchListener,
  PatchOp,
  Port,
  PortDirection,
  PortInit,
  ReadAttrs,
} from '../src/index.js';

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
    expect(typeof api.DuplicatePortError).toBe('function');
    expect(typeof api.PortNotFoundError).toBe('function');
    expect(typeof api.PortInUseError).toBe('function');
    expect(typeof api.PortDirectionError).toBe('function');
  });

  it('exports the isDagrGraphError guard', () => {
    expect(typeof api.isDagrGraphError).toBe('function');
    expect(api.isDagrGraphError(new api.NodeNotFoundError('a'))).toBe(true);
    expect(api.isDagrGraphError(new Error('plain'))).toBe(false);
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DagrGraphError',
      'DuplicateEdgeError',
      'DuplicateNodeError',
      'DuplicatePortError',
      'EdgeNotFoundError',
      'Graph',
      'InvalidIdError',
      'NodeNotFoundError',
      'PortDirectionError',
      'PortInUseError',
      'PortNotFoundError',
      'apply',
      'invert',
      'isDagrGraphError',
    ]);
  });

  it('exports the patch functions and types', () => {
    expect(typeof api.apply).toBe('function');
    expect(typeof api.invert).toBe('function');

    const source = new api.Graph();
    const mirror = new api.Graph();
    const log: Patch[] = [];
    const listener: PatchListener = (patch) => {
      log.push(patch);
      api.apply(mirror, patch);
    };
    const unsubscribe = source.subscribe(listener);
    source.addNode('a');
    unsubscribe();

    const ops: PatchOp[] = [...(log[0] ?? [])];
    expect(ops.map((op) => op.op)).toEqual(['add-node']);
    expect(mirror.hasNode('a')).toBe(true);
    api.apply(mirror, api.invert(log[0] ?? []));
    expect(mirror.hasNode('a')).toBe(false);
  });

  it('exports the DagrGraphErrorCode type, and every code is a member of it', () => {
    const codes: DagrGraphErrorCode[] = [
      new api.InvalidIdError('node', '').code,
      new api.DuplicateNodeError('a').code,
      new api.NodeNotFoundError('a').code,
      new api.DuplicateEdgeError('e1').code,
      new api.EdgeNotFoundError('e1').code,
      new api.DuplicatePortError('a', 'p').code,
      new api.PortNotFoundError('a', 'p').code,
      new api.PortInUseError('a', 'p', ['e1']).code,
      new api.PortDirectionError('a', 'p', 'in', 'source').code,
    ];
    expect(codes).toEqual([
      'INVALID_ID',
      'DUPLICATE_NODE',
      'NODE_NOT_FOUND',
      'DUPLICATE_EDGE',
      'EDGE_NOT_FOUND',
      'DUPLICATE_PORT',
      'PORT_NOT_FOUND',
      'PORT_IN_USE',
      'PORT_DIRECTION',
    ]);
  });

  it('exports the attribute and port types', () => {
    type NodeAttrs = { label: string };
    const graph = new api.Graph<NodeAttrs>();
    const nodeInit: NodeInit<NodeAttrs> = {
      id: 'a',
      attrs: { label: 'A' },
      ports: [{ id: 'p', direction: 'out' } satisfies PortInit],
    };
    const node = graph.addNode(nodeInit);
    graph.addNode('b');
    const edgeInit: EdgeInit = { source: 'a', target: 'b', id: 'ab', sourcePort: 'p' };
    const edge = graph.addEdge(edgeInit);

    const attrs: ReadAttrs<NodeAttrs> = node.attrs;
    const patch: AttrsPatch<NodeAttrs> = { label: undefined };
    const port: Port | undefined = graph.getPort('a', 'p');
    const direction: PortDirection | undefined = port?.direction;
    const family: DagrGraphErrorLike[] = [new api.PortNotFoundError('a', 'p')];

    expect(attrs.label).toBe('A');
    expect(Object.keys(graph.updateNodeAttrs('a', patch).attrs)).toEqual([]);
    expect(direction).toBe('out');
    expect(edge.sourcePort).toBe('p');
    expect(family[0]?.code).toBe('PORT_NOT_FOUND');
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
