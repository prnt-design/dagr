import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  AddEdgeOp,
  AddNodeOp,
  AddPortOp,
  AttrsPatch,
  DagrGraphErrorCode,
  DagrGraphErrorLike,
  Edge,
  EdgeDocument,
  EdgeInit,
  GraphDocument,
  NodeDocument,
  PortDocument,
  Node,
  NodeInit,
  Patch,
  PatchListener,
  PatchOp,
  Port,
  PortDirection,
  PortInit,
  ReadAttrs,
  RemoveEdgeOp,
  RemoveNodeOp,
  RemovePortOp,
  UpdateEdgeAttrsOp,
  UpdateEdgePortsOp,
  UpdateGraphAttrsOp,
  UpdateNodeAttrsOp,
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
    expect(typeof api.CycleError).toBe('function');
    expect(typeof api.InvalidDocumentError).toBe('function');
  });

  it('exports the isDagrGraphError guard', () => {
    expect(typeof api.isDagrGraphError).toBe('function');
    expect(api.isDagrGraphError(new api.NodeNotFoundError('a'))).toBe(true);
    expect(api.isDagrGraphError(new Error('plain'))).toBe(false);
  });

  it('exports PatchListenerError, which is outside the graph error family', () => {
    expect(typeof api.PatchListenerError).toBe('function');
    const failure = new api.PatchListenerError([new api.DuplicateNodeError('a')]);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(api.DagrGraphError);
    expect(api.isDagrGraphError(failure)).toBe(false);
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([
      'CycleError',
      'DagrGraphError',
      'DuplicateEdgeError',
      'DuplicateNodeError',
      'DuplicatePortError',
      'EdgeNotFoundError',
      'Graph',
      'InvalidDocumentError',
      'InvalidIdError',
      'NodeNotFoundError',
      'PatchListenerError',
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

    // Each of the ten per-op interfaces is annotated by hand rather than
    // narrowed out of the union, so the surface is pinned name by name:
    // dropping one from the export list fails the typecheck here rather than
    // going unnoticed until a consumer reaches for it.
    const port: Port = { id: 'p', direction: 'inout' };
    const addNode: AddNodeOp = { op: 'add-node', id: 'a', attrs: {}, ports: [] };
    const removeNode: RemoveNodeOp = { op: 'remove-node', id: 'a', attrs: {}, ports: [port] };
    const addEdge: AddEdgeOp = { op: 'add-edge', id: 'aa', source: 'a', target: 'a', attrs: {} };
    const removeEdge: RemoveEdgeOp = {
      op: 'remove-edge',
      id: 'aa',
      source: 'a',
      target: 'a',
      attrs: {},
    };
    const addPort: AddPortOp = { op: 'add-port', nodeId: 'a', port, index: 0 };
    const removePort: RemovePortOp = { op: 'remove-port', nodeId: 'a', port, index: 0 };
    const updateNodeAttrs: UpdateNodeAttrsOp = {
      op: 'update-node-attrs',
      id: 'a',
      after: { label: 'A' },
      before: { label: undefined },
    };
    const updateEdgeAttrs: UpdateEdgeAttrsOp = {
      op: 'update-edge-attrs',
      id: 'aa',
      after: { weight: 1 },
      before: { weight: undefined },
    };
    const updateGraphAttrs: UpdateGraphAttrsOp = {
      op: 'update-graph-attrs',
      after: { rankdir: 'TB' },
      before: { rankdir: undefined },
    };
    const updateEdgePorts: UpdateEdgePortsOp = {
      op: 'update-edge-ports',
      id: 'aa',
      after: { sourcePort: 'p' },
      before: { sourcePort: undefined },
    };

    // Every one of them is a member of `PatchOp`, so a patch built out of them
    // replays through `apply` like any other.
    const built: Patch = [
      addNode,
      addEdge,
      addPort,
      updateNodeAttrs,
      updateEdgeAttrs,
      updateGraphAttrs,
      updateEdgePorts,
      removeEdge,
      removePort,
      removeNode,
    ];
    const replay = new api.Graph();
    api.apply(replay, built);
    expect(built.map((op) => op.op)).toEqual([
      'add-node',
      'add-edge',
      'add-port',
      'update-node-attrs',
      'update-edge-attrs',
      'update-graph-attrs',
      'update-edge-ports',
      'remove-edge',
      'remove-port',
      'remove-node',
    ]);
    expect(replay.nodeCount).toBe(0);
    expect(replay.attrs).toEqual({ rankdir: 'TB' });
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
      new api.CycleError(['a', 'b']).code,
      new api.InvalidDocumentError('nodes[0]', 'expected an object').code,
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
      'CYCLE',
      'INVALID_DOCUMENT',
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

  /**
   * The document types are annotated by hand, and under all three attribute
   * type parameters, because that is the whole reason they are exported: a
   * caller holding a document in a field or passing one across a function
   * boundary needs a name for it, and the bags inside have to stay typed
   * rather than collapsing to `unknown`. Checked by `tsc --noEmit` over this
   * directory, so the assertion is the annotation, not the expectation.
   */
  it('exports the document types, under all three attribute type parameters', () => {
    type NodeAttrs = { label: string };
    type EdgeAttrs = { weight: number };
    type GraphAttrs = { rankdir: 'TB' | 'LR' };

    const graph = new api.Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    graph.updateAttrs({ rankdir: 'LR' });
    graph.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p', direction: 'out' }] });
    graph.addNode('b');
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { weight: 2 }, sourcePort: 'p' });

    const document: GraphDocument<NodeAttrs, EdgeAttrs, GraphAttrs> = graph.toJSON();
    const node: NodeDocument<NodeAttrs> | undefined = document.nodes[0];
    const port: PortDocument | undefined = node?.ports[0];
    const edge: EdgeDocument<EdgeAttrs> | undefined = document.edges[0];
    const rankdir: 'TB' | 'LR' | undefined = document.attrs.rankdir;
    const label: string | undefined = node?.attrs.label;
    const weight: number | undefined = edge?.attrs.weight;

    expect([rankdir, label, weight, port?.direction, edge?.sourcePort]).toEqual([
      'LR',
      'A',
      2,
      'out',
      'p',
    ]);

    const restored: api.Graph<NodeAttrs, EdgeAttrs, GraphAttrs> = api.Graph.fromJSON<
      NodeAttrs,
      EdgeAttrs,
      GraphAttrs
    >(JSON.parse(JSON.stringify(graph)));
    expect(restored.requireNode('a').attrs.label).toBe('A');
    expect(restored.toJSON()).toEqual(document);
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
