import { LayoutError } from './errors.js';
import type { LayoutInput, Point } from './types.js';

/**
 * A node as the pipeline sees it: the input fields plus the slots each
 * stage fills in.
 *
 * The slots start as `undefined` and are filled in stage order, so a stage
 * can tell "not computed yet" from "computed as zero". The built in stages
 * read an unfilled slot leniently (rank and order fall back to 0) so that a
 * partial custom stage bundle still produces a result.
 */
export interface LayoutNodeState {
  /** The input node id. Never changes. */
  readonly id: string;
  /**
   * Where the node came from: `'real'` for a node the caller supplied,
   * `'dummy'` for one a stage synthesized (the bend points of a long edge,
   * roadmap M2.4).
   *
   * Only real nodes reach the result, and only real nodes count towards the
   * bounding box, so a stage can add all the scaffolding it needs without
   * leaking it to the caller. Use {@link addDummyNode} to add one.
   */
  readonly kind: 'real' | 'dummy';
  /** Node width in layout units. */
  width: number;
  /** Node height in layout units. */
  height: number;
  /**
   * Rank index, filled in by the rank stage.
   *
   * Must be a finite integer once set. Negative ranks and gaps between
   * ranks are fine, fractions and `NaN` are not: rank tightening (roadmap
   * M2.3) reasons about integer slack, dummy-node chains (M2.4) need the
   * integers strictly between two ranks, and a `NaN` rank would make the
   * band sort an inconsistent comparator, whose result the language leaves
   * up to the engine.
   */
  rank: number | undefined;
  /** Position inside its rank, left to right, filled in by the order stage. */
  order: number | undefined;
  /** Center x, filled in by the position stage. */
  x: number | undefined;
  /** Center y, filled in by the position stage. */
  y: number | undefined;
}

/** An edge as the pipeline sees it: the input fields plus the route slot. */
export interface LayoutEdgeState {
  /** The input edge id. Never changes. */
  readonly id: string;
  /**
   * Position of this record in `state.edges` when it was created, which is
   * the order the caller listed the edges in.
   *
   * Assigned once and never renumbered, so it stays a stable sort key even
   * as edges are reversed and segments are appended. {@link reverseEdge}
   * uses it to put a moved record back in input order in constant time per
   * neighbor, instead of searching the master list.
   *
   * A stage creating an edge record by hand must set it to
   * `state.edges.length` at the moment of creation, before pushing.
   */
  readonly index: number;
  /**
   * Id of the node the edge leaves, as the pipeline currently sees it.
   *
   * Mutable because the cycle breaker (roadmap M2.2) reverses edges in place
   * to make the graph acyclic. Change it with {@link reverseEdge} rather than
   * by hand, so `reversed` and the adjacency lists stay in step.
   */
  source: string;
  /** Id of the node the edge enters, as the pipeline currently sees it. See {@link LayoutEdgeState.source}. */
  target: string;
  /**
   * True when `source` and `target` are the other way round from the input.
   *
   * The cycle breaker sets this by reversing an edge, and the result undoes
   * it: a reversed edge is still reported with its input endpoints and with
   * its route running from the input source, so reversal never escapes the
   * pipeline.
   */
  reversed: boolean;
  /**
   * The input edge this record is a piece of, or `undefined` when the record
   * IS an input edge.
   *
   * A stage that splits a long edge into per-rank segments (roadmap M2.4)
   * sets `of` to the id of the edge being split. Only records with `of`
   * undefined reach the result, so segments stay private the way dummy nodes
   * do, and the route stage can fold them back into the edge they belong to.
   */
  readonly of: string | undefined;
  /**
   * Polyline from source to target, filled in by the route stage.
   * Empty until then.
   */
  points: Point[];
}

/**
 * The mutable working state every stage reads and writes.
 *
 * Insertion order is load bearing: `nodes` and `edges` stay in input order,
 * the adjacency lists stay in input order, and the result is emitted in
 * that order. Nothing in the pipeline sorts by id or invents ids, so two
 * runs over the same input produce identical output.
 *
 * The collections themselves are mutable on purpose: later stages add
 * dummy nodes for long edges (roadmap M2.4). Use {@link addDummyNode} to
 * add one rather than pushing a record by hand, so id uniqueness and the
 * three lookup maps stay consistent. A stage that inserts an edge record
 * itself must likewise push it onto `edges`, `outEdges[source]` and
 * `inEdges[target]`, and set `of` when the record is a piece of an input
 * edge rather than an edge in its own right.
 */
export interface LayoutState {
  /** Every node, in input order. */
  readonly nodes: LayoutNodeState[];
  /** Every edge, in input order. */
  readonly edges: LayoutEdgeState[];
  /** Node lookup by id. */
  readonly nodesById: Map<string, LayoutNodeState>;
  /** Edges leaving a node, keyed by node id, in input order. Present, possibly empty, for every node. */
  readonly outEdges: Map<string, LayoutEdgeState[]>;
  /** Edges entering a node, keyed by node id, in input order. Present, possibly empty, for every node. */
  readonly inEdges: Map<string, LayoutEdgeState[]>;
}

function requireValidSize(value: number, field: string, id: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new LayoutError(
      'INVALID_NODE_SIZE',
      `node ${JSON.stringify(id)} has ${field} ${String(value)}, expected a finite non-negative number`,
    );
  }
  return value;
}

/**
 * Validate `input` and copy it into fresh mutable state.
 *
 * The input is only read: every node and edge record is copied, so a stage
 * mutating state can never write through to the caller's objects.
 *
 * @throws {LayoutError} `EMPTY_NODE_ID`, `INVALID_NODE_SIZE`,
 * `DUPLICATE_NODE_ID`, `DUPLICATE_EDGE_ID`, `UNKNOWN_EDGE_SOURCE` or
 * `UNKNOWN_EDGE_TARGET`.
 */
export function createLayoutState(input: LayoutInput): LayoutState {
  const nodes: LayoutNodeState[] = [];
  const nodesById = new Map<string, LayoutNodeState>();
  const outEdges = new Map<string, LayoutEdgeState[]>();
  const inEdges = new Map<string, LayoutEdgeState[]>();

  for (const node of input.nodes) {
    if (node.id === '') {
      throw new LayoutError('EMPTY_NODE_ID', 'node id must not be empty');
    }
    if (nodesById.has(node.id)) {
      throw new LayoutError('DUPLICATE_NODE_ID', `duplicate node id ${JSON.stringify(node.id)}`);
    }
    const record: LayoutNodeState = {
      id: node.id,
      kind: 'real',
      width: requireValidSize(node.width, 'width', node.id),
      height: requireValidSize(node.height, 'height', node.id),
      rank: undefined,
      order: undefined,
      x: undefined,
      y: undefined,
    };
    nodes.push(record);
    nodesById.set(record.id, record);
    outEdges.set(record.id, []);
    inEdges.set(record.id, []);
  }

  const edges: LayoutEdgeState[] = [];
  const edgeIds = new Set<string>();

  for (const edge of input.edges) {
    if (edgeIds.has(edge.id)) {
      throw new LayoutError('DUPLICATE_EDGE_ID', `duplicate edge id ${JSON.stringify(edge.id)}`);
    }
    const out = outEdges.get(edge.source);
    if (out === undefined) {
      throw new LayoutError(
        'UNKNOWN_EDGE_SOURCE',
        `edge ${JSON.stringify(edge.id)} has unknown source ${JSON.stringify(edge.source)}`,
      );
    }
    const into = inEdges.get(edge.target);
    if (into === undefined) {
      throw new LayoutError(
        'UNKNOWN_EDGE_TARGET',
        `edge ${JSON.stringify(edge.id)} has unknown target ${JSON.stringify(edge.target)}`,
      );
    }
    const record: LayoutEdgeState = {
      id: edge.id,
      index: edges.length,
      source: edge.source,
      target: edge.target,
      of: undefined,
      reversed: false,
      points: [],
    };
    edges.push(record);
    edgeIds.add(record.id);
    out.push(record);
    into.push(record);
  }

  return { nodes, edges, nodesById, outEdges, inEdges };
}

/** Drop `edge` from `list`, if it is there. */
function removeEdge(list: LayoutEdgeState[] | undefined, edge: LayoutEdgeState): void {
  if (list === undefined) {
    return;
  }
  const at = list.indexOf(edge);
  if (at !== -1) {
    list.splice(at, 1);
  }
}

/**
 * Put `edge` back into `list` at the spot that keeps `list` in input order.
 *
 * Appending would be simpler but would make adjacency order depend on which
 * edges happened to be reversed, so two runs that reverse different edges of
 * the same graph would order the lists differently. Since `list` is already
 * sorted by `index`, the spot is the first member with a higher `index`,
 * which costs one scan of that one list and nothing else: reversing every
 * edge of a graph stays linear in the total degree.
 */
function insertEdgeInInputOrder(list: LayoutEdgeState[], edge: LayoutEdgeState): void {
  let at = list.length;
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[i];
    if (candidate !== undefined && candidate.index > edge.index) {
      at = i;
      break;
    }
  }
  list.splice(at, 0, edge);
}

/**
 * Reverse `edge` in place, keeping `state` consistent.
 *
 * Swaps `source` and `target`, toggles `reversed`, and moves the record from
 * the adjacency lists it used to sit in to the ones it now belongs to, still
 * in input order. Reversing the same edge twice restores the state exactly,
 * and a self loop is a no-op beyond the `reversed` flag.
 *
 * This is how the cycle breaker (roadmap M2.2) makes the graph acyclic. The
 * reversal is private to the pipeline: the result reports the edge with its
 * input endpoints and its route running from the input source.
 *
 * Costs the degree of the two nodes involved, not the size of the graph, so
 * breaking the cycles of a whole graph stays linear in the total degree.
 */
export function reverseEdge(state: LayoutState, edge: LayoutEdgeState): void {
  removeEdge(state.outEdges.get(edge.source), edge);
  removeEdge(state.inEdges.get(edge.target), edge);

  const source = edge.source;
  edge.source = edge.target;
  edge.target = source;
  edge.reversed = !edge.reversed;

  const out = state.outEdges.get(edge.source);
  if (out !== undefined) {
    insertEdgeInInputOrder(out, edge);
  }
  const into = state.inEdges.get(edge.target);
  if (into !== undefined) {
    insertEdgeInInputOrder(into, edge);
  }
}

/** What a stage wants a synthesized node to look like. Everything is optional. */
export interface DummyNodeOptions {
  /** Width in layout units. Finite and non-negative. Default `0`. */
  readonly width?: number;
  /** Height in layout units. Finite and non-negative. Default `0`. */
  readonly height?: number;
  /** Rank to place it on. Default `undefined`, meaning the rank stage has not decided yet. */
  readonly rank?: number;
}

/** Prefix of every synthesized node id. */
const DUMMY_ID_PREFIX = 'dummy:';

/**
 * Where the id search should start for a given state, remembered between
 * calls.
 *
 * Kept outside {@link LayoutState} so the public shape stays what a stage
 * author has to understand, and weak so a state that goes out of scope takes
 * its counter with it.
 */
const nextDummyNumber = new WeakMap<LayoutState, number>();

/**
 * Pick a node id that no node in `state` uses.
 *
 * The search resumes where the last one stopped rather than restarting, so a
 * caller who happens to have named a block of nodes `dummy:<integer>` is
 * walked past once for the whole run instead of once per dummy added. The
 * exact number is an implementation detail: only "this id is free" is
 * promised. Caller ids are never overwritten, however they are spelled.
 */
function freeNodeId(state: LayoutState): string {
  let n = nextDummyNumber.get(state) ?? state.nodes.length;
  let candidate = `${DUMMY_ID_PREFIX}${n}`;
  while (state.nodesById.has(candidate)) {
    n += 1;
    candidate = `${DUMMY_ID_PREFIX}${n}`;
  }
  nextDummyNumber.set(state, n + 1);
  return candidate;
}

/**
 * Add a synthesized node to `state` and hand back the record.
 *
 * This is the only supported way to grow the node list: it invents an id that
 * cannot collide with a caller id, marks the node `'dummy'`, appends it to
 * `state.nodes`, and registers it in `nodesById`, `outEdges` and `inEdges`, so
 * the state stays internally consistent. Dummy nodes are private to the
 * pipeline: they never appear in the result and never widen the bounding box.
 *
 * The returned record is live state, so a stage can fill in `rank`, `order`,
 * `x` and `y` on it later, and `record.id` is the id to hang segment edges on.
 *
 * @throws {LayoutError} `INVALID_NODE_SIZE` when a given width or height is
 * negative, `NaN` or infinite.
 */
export function addDummyNode(state: LayoutState, options: DummyNodeOptions): LayoutNodeState {
  const id = freeNodeId(state);
  const record: LayoutNodeState = {
    id,
    kind: 'dummy',
    width: requireValidSize(options.width ?? 0, 'width', id),
    height: requireValidSize(options.height ?? 0, 'height', id),
    rank: options.rank,
    order: undefined,
    x: undefined,
    y: undefined,
  };
  state.nodes.push(record);
  state.nodesById.set(id, record);
  state.outEdges.set(id, []);
  state.inEdges.set(id, []);
  return record;
}
