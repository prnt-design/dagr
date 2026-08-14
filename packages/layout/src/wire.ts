/**
 * The messages a layout run is made of when it crosses a worker boundary, and
 * the four functions that turn a run into them and back.
 *
 * Three decisions shape every type below, and they are all the same decision
 * seen from different sides: WHAT CROSSES IS THE LAYOUT'S VIEW OF A RUN, NOT
 * THE CALLER'S OBJECTS.
 *
 * The graph crosses as ids and endpoints. `Graph.toJSON` is right there and is
 * deliberately not used: a document carries attribute bags and ports, and
 * layout reads neither. Sending them would cost a copy of every bag on a graph
 * the far side has no use for, and worse, it would make a run FAIL for a reason
 * that has nothing to do with layout, because an attribute holding a function
 * or a DOM node is legal in `@dagr/graph` (it never reads one) and is not
 * structured-cloneable. So a caller who keeps a React element or a callback in
 * a node's bag can still lay that graph out in a worker, and the failure mode
 * this avoids is the kind that shows up only in production and only for some
 * graphs.
 *
 * The config crosses resolved, and the sizes cross measured. `nodeSize` is a
 * function, so it cannot cross at all, which is exactly what M2.1 kept
 * functions out of `LayoutInput` for. Preparing on the calling side is what
 * makes that a non-problem rather than a limitation: measuring is where a
 * callback that reads the DOM has to run anyway, and once it has run, what is
 * left of a run is numbers and ids. It also decides where a bad config is
 * reported. `InvalidConfigError` is thrown by the caller's own stack, before
 * anything is posted, rather than arriving later as a rejected promise from
 * across a boundary.
 *
 * The stages never cross. They are functions, and the far side has its own set,
 * which is the shape of the whole protocol: the worker owns the algorithms, the
 * request owns the data.
 *
 * NUMBERS TRAVEL IN BUFFERS AND ARE TRANSFERRED, NOT COPIED. Every part of a
 * message whose size grows with the graph is a typed array: the sizes going
 * out, the node boxes and the route points coming back. Each encoder hands back
 * the transfer list to post them with, so the buffers move rather than being
 * cloned, and the sender's copy is detached. What is left cloned is the ids,
 * which are strings and cannot be transferred, and `bounds`, which is four
 * numbers: a buffer of its own would cost more in overhead than the copy it
 * saves.
 *
 * The response carries no ids at all, and that is the other half of the same
 * idea. The request already fixed an order (the graph's own insertion order,
 * which is the order a `LayoutResult` iterates in anyway), the calling side
 * still holds the graph it sent, and the response is matched to it by request
 * id. So a result is three buffers and a rectangle, and rebuilding it is a walk
 * over the graph the caller already has.
 */

import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { InternalLayoutError, StageContractError, WorkerTransportError } from './errors.js';
import type { DagrLayoutError } from './errors.js';
import type {
  LayoutResult,
  PositionedNode,
  PreparedState,
  Point,
  Rect,
  ResolvedLayoutConfig,
  RoutedEdge,
  Size,
} from './types.js';

/** A run on its way to a worker: the graph as ids, the config, the sizes. */
export interface LayoutRunMessage {
  readonly dagr: 'layout-run';
  readonly id: number;

  /** Node ids in graph insertion order. Fixes the order of everything else. */
  readonly nodes: readonly NodeId[];

  /** Edge ids in graph insertion order, with their endpoints alongside. */
  readonly edges: readonly EdgeId[];
  readonly sources: readonly NodeId[];
  readonly targets: readonly NodeId[];

  /** The config already resolved, so both sides read the same numbers. */
  readonly config: ResolvedLayoutConfig;

  /** Two entries per node, width then height, in `nodes` order. */
  readonly sizes: Float64Array;
}

/**
 * A finished layout on its way back, as numbers alone. See the note at the top
 * of this file for why there are no ids here.
 */
export interface LayoutResultMessage {
  readonly dagr: 'layout-result';
  readonly id: number;

  /** Four entries per node, centre x, centre y, width, height. */
  readonly boxes: Float64Array;

  /** One entry per edge: how many points of {@link points} that edge owns. */
  readonly counts: Uint32Array;

  /** Two entries per point, x then y, edges concatenated in request order. */
  readonly points: Float64Array;

  /** Four numbers, so cloned rather than given a buffer to be transferred in. */
  readonly bounds: Rect;
}

/**
 * A run that threw, described by which member of the error family it was.
 *
 * Split three ways rather than carrying a serialised `Error`, because the two
 * members that CAN cross carry nothing but strings and so can be rebuilt as
 * themselves. Anything else is quoted by name and message and becomes a
 * {@link WorkerTransportError} on arrival, which loses the class and says so.
 * See that error's docstring for why `InvalidConfigError` is not a case here.
 *
 * `subject` rather than `id` on the stage case: a `StageContractError`'s own
 * field is called `id`, and the message already has an `id` meaning which
 * request this is. Two fields named `id` in one object, meaning different
 * things, is a mistake waiting to be made by whoever reads this next.
 */
export type LayoutFailureMessage =
  | {
      readonly dagr: 'layout-failure';
      readonly id: number;
      readonly kind: 'stage';
      readonly stage: string;
      readonly subject: string;
      readonly detail: string;
    }
  | {
      readonly dagr: 'layout-failure';
      readonly id: number;
      readonly kind: 'internal';
      readonly detail: string;
    }
  | {
      readonly dagr: 'layout-failure';
      readonly id: number;
      readonly kind: 'foreign';
      readonly name: string;
      readonly message: string;
    };

/** Every message this protocol defines. */
export type LayoutMessage = LayoutRunMessage | LayoutResultMessage | LayoutFailureMessage;

/**
 * A message and the buffers to post it with. Passing the transfer list back
 * beside the message rather than deriving it at the call site is what keeps
 * "these arrays are transferred" a property of the encoding rather than of
 * whoever remembered to list them.
 */
export interface Encoded<Message> {
  readonly message: Message;
  readonly transfer: ArrayBuffer[];
}

/**
 * Recognises this protocol's own messages and nothing else.
 *
 * A port may carry other traffic: a caller who already has a worker for their
 * own purposes should be able to serve layout on it rather than starting a
 * second one. So both ends ignore what they do not recognise instead of
 * treating it as a protocol violation, and the `dagr` tag is what makes that
 * possible.
 */
export function isLayoutMessage(value: unknown): value is LayoutMessage {
  if (typeof value !== 'object' || value === null) return false;
  const tag = (value as { dagr?: unknown }).dagr;
  return tag === 'layout-run' || tag === 'layout-result' || tag === 'layout-failure';
}

/** A value the wire format says is there. Absence is a malformed message. */
function at<T>(values: ArrayLike<T>, index: number, what: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new WorkerTransportError(`${what} ran off the end of the message at index ${String(index)}`);
  }
  return value;
}

/** Encodes a prepared run. The sizes buffer is transferred, so it is fresh. */
export function encodeRun(id: number, prepared: PreparedState): Encoded<LayoutRunMessage> {
  const { graph } = prepared;
  const nodes: NodeId[] = [];
  const sizes = new Float64Array(graph.nodeCount * 2);
  let measure = 0;
  for (const node of graph.nodes()) {
    const size = prepared.sizes.get(node.id);
    // Unreachable through `prepare`, which sizes every node in the graph. A
    // hand-built `PreparedState` can still get here, and a missing size would
    // otherwise cross as a silent zero.
    if (size === undefined) {
      throw new WorkerTransportError(`node "${node.id}" was never sized, so the run cannot be sent`);
    }
    sizes[measure] = size.width;
    sizes[measure + 1] = size.height;
    measure += 2;
    nodes.push(node.id);
  }
  const edges: EdgeId[] = [];
  const sources: NodeId[] = [];
  const targets: NodeId[] = [];
  for (const edge of graph.edges()) {
    edges.push(edge.id);
    sources.push(edge.source);
    targets.push(edge.target);
  }
  return {
    message: {
      dagr: 'layout-run',
      id,
      nodes,
      edges,
      sources,
      targets,
      config: prepared.config,
      sizes,
    },
    transfer: [sizes.buffer],
  };
}

/**
 * Rebuilds the run on the far side: a `Graph` of the ids that crossed, and the
 * prepared record the pipeline reads.
 *
 * The graph is built through the same public constructors any caller would use,
 * so a request naming an edge endpoint that is not there, or the same id twice,
 * comes back as the `@dagr/graph` error that call always throws rather than as
 * a half-built graph. That is `Graph.fromJSON`'s argument, made here without
 * the document: a document is a format to validate and this is a message this
 * package wrote.
 */
export function decodeRun(message: LayoutRunMessage): PreparedState {
  const graph = new Graph();
  const sizes = new Map<NodeId, Size>();
  if (message.sizes.length !== message.nodes.length * 2) {
    throw new WorkerTransportError(
      `a run for ${String(message.nodes.length)} nodes arrived with ` +
        `${String(message.sizes.length)} size numbers, and there are two per node`,
    );
  }
  for (const [index, id] of message.nodes.entries()) {
    graph.addNode(id);
    sizes.set(id, {
      width: at(message.sizes, index * 2, 'a node size'),
      height: at(message.sizes, index * 2 + 1, 'a node size'),
    });
  }
  for (const [index, id] of message.edges.entries()) {
    graph.addEdge(at(message.sources, index, 'an edge source'), at(message.targets, index, 'an edge target'), id);
  }
  return { graph, config: message.config, sizes };
}

/** Encodes a finished layout. All three buffers are fresh, so all three move. */
export function encodeResult(id: number, result: LayoutResult): Encoded<LayoutResultMessage> {
  const boxes = new Float64Array(result.nodes.size * 4);
  let box = 0;
  for (const node of result.nodes.values()) {
    boxes[box] = node.x;
    boxes[box + 1] = node.y;
    boxes[box + 2] = node.width;
    boxes[box + 3] = node.height;
    box += 4;
  }
  const counts = new Uint32Array(result.edges.size);
  let total = 0;
  for (const edge of result.edges.values()) total += edge.points.length;
  const points = new Float64Array(total * 2);
  let edgeIndex = 0;
  let point = 0;
  for (const edge of result.edges.values()) {
    counts[edgeIndex] = edge.points.length;
    edgeIndex += 1;
    for (const { x, y } of edge.points) {
      points[point] = x;
      points[point + 1] = y;
      point += 2;
    }
  }
  return {
    message: { dagr: 'layout-result', id, boxes, counts, points, bounds: result.bounds },
    transfer: [boxes.buffer, counts.buffer, points.buffer],
  };
}

/**
 * Rebuilds a {@link LayoutResult} from the numbers, against the graph the run
 * was sent for.
 *
 * Every count is checked against that graph rather than trusted, because the
 * failure this catches is two ends built from different versions of this
 * package, and the symptom without the check is a layout whose coordinates
 * belong to other nodes: every id present, every number finite, everything in
 * the wrong place.
 */
export function decodeResult(message: LayoutResultMessage, graph: Graph): LayoutResult {
  if (message.boxes.length !== graph.nodeCount * 4) {
    throw new WorkerTransportError(
      `a result for ${String(graph.nodeCount)} nodes arrived with ` +
        `${String(message.boxes.length)} box numbers, and there are four per node`,
    );
  }
  if (message.counts.length !== graph.edgeCount) {
    throw new WorkerTransportError(
      `a result for ${String(graph.edgeCount)} edges arrived with ` +
        `${String(message.counts.length)} point counts, and there is one per edge`,
    );
  }
  const nodes = new Map<NodeId, PositionedNode>();
  let box = 0;
  for (const node of graph.nodes()) {
    nodes.set(node.id, {
      id: node.id,
      x: at(message.boxes, box, 'a node box'),
      y: at(message.boxes, box + 1, 'a node box'),
      width: at(message.boxes, box + 2, 'a node box'),
      height: at(message.boxes, box + 3, 'a node box'),
    });
    box += 4;
  }
  const edges = new Map<EdgeId, RoutedEdge>();
  let point = 0;
  for (const [index, edge] of [...graph.edges()].entries()) {
    const count = at(message.counts, index, 'a point count');
    const route: Point[] = [];
    for (let step = 0; step < count; step += 1) {
      route.push({
        x: at(message.points, point, 'a route point'),
        y: at(message.points, point + 1, 'a route point'),
      });
      point += 2;
    }
    edges.set(edge.id, { id: edge.id, source: edge.source, target: edge.target, points: route });
  }
  if (point !== message.points.length) {
    throw new WorkerTransportError(
      `a result carried ${String(message.points.length / 2)} route points but its counts ` +
        `account for ${String(point / 2)}`,
    );
  }
  return { nodes, edges, bounds: message.bounds };
}

/**
 * Describes a thrown value for the trip back. See {@link LayoutFailureMessage}.
 *
 * Encoded like the other two even though a failure has nothing to transfer, so
 * that every post in this package hands its transfer list back from the encoder
 * rather than having one written at the call site.
 */
export function encodeFailure(id: number, error: unknown): Encoded<LayoutFailureMessage> {
  if (error instanceof StageContractError) {
    return {
      message: {
        dagr: 'layout-failure',
        id,
        kind: 'stage',
        stage: error.stage,
        subject: error.id,
        detail: error.detail,
      },
      transfer: [],
    };
  }
  if (error instanceof InternalLayoutError) {
    return {
      message: { dagr: 'layout-failure', id, kind: 'internal', detail: error.detail },
      transfer: [],
    };
  }
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return { message: { dagr: 'layout-failure', id, kind: 'foreign', name, message }, transfer: [] };
}

/** Turns a failure message back into the error to reject a run with. */
export function decodeFailure(message: LayoutFailureMessage): DagrLayoutError {
  switch (message.kind) {
    case 'stage':
      return new StageContractError(message.stage, message.subject, message.detail);
    case 'internal':
      return new InternalLayoutError(message.detail);
    case 'foreign':
      return new WorkerTransportError(
        `the run threw ${message.name}: ${message.message}. Structured cloning does not ` +
          'carry a class, so the original error is quoted rather than rethrown',
      );
  }
}
