import { Graph } from '@dagr/graph';
import { layeredDag } from '@dagr/bench';
import { mulberry32 } from './random.js';
import type { EdgeId, NodeId } from '@dagr/graph';
import type { LayeredOptions } from '@dagr/bench';

/**
 * The mutation sessions the incremental pipeline is measured over, as data.
 *
 * WHY A SESSION AND NOT A PATCH. Every stability test in this package measures
 * ONE mutation: a node arrives, an edge is removed, and the drawing before is
 * compared with the drawing after. That is the right shape for a contract and
 * the wrong shape for the question M3.6 handed here, which is what the warm
 * start costs over a hundred patches rather than over one. A rule that gives up
 * half a point of quality per patch is invisible at one patch and is the whole
 * story over a session of them, and nothing in the suite could see it.
 *
 * WHY THE SCRIPT IS DATA AND NOT A CALLBACK. Each entry below is planned into a
 * concrete list of operations ONCE, by {@link planSession}, and that same list
 * is replayed against every configuration under test. A callback holding a
 * random number generator would be re-run per configuration, and a generator
 * that drifted by one call between two of them would compare two different
 * sessions and report the difference as a stability result. Planning once is
 * what makes the comparison a comparison. It also means a step is inspectable:
 * a golden number that moved can be traced to the ops that produced it.
 *
 * THE GRAPHS come from `@dagr/bench`'s `layeredDag`, the same generator
 * `golden-corpus.ts` draws its six from, for the reason stated there and in
 * `random.ts`: a second generator drifts, and a committed file measured against
 * a drifted generator pins numbers for graphs nobody else has.
 *
 * THEY ARE SMALLER THAN THE ORDER CORPUS ON PURPOSE. That file lays each graph
 * out once; this one lays each graph out once per step per configuration, so a
 * session is three times the step count in full pipeline runs. A few hundred
 * nodes keeps the file in the ordinary test run, and the shapes are what vary
 * rather than the scale.
 */

/**
 * What a session does to its graph, one kind per shape of edit a consumer
 * actually makes.
 *
 * The six are not a taxonomy of `PatchOp`: five of them are the shapes M3.10a's
 * entry names and the sixth is the pattern-generator shape it asks for beside
 * them, and each one exercises a different part of the pipeline. `grow` and
 * `pattern` both add, and they are not the same session: a lone node arriving
 * with its two edges is close to the smallest patch there is, while a block of
 * nodes landing at once is what a pattern generator emits and is the case where
 * the order stage has a whole cohort to place rather than one node.
 */
export type SessionKind = 'grow' | 'prune' | 'rewire' | 'reparent' | 'churn' | 'pattern';

/** One primitive edit. A step is a list of these, applied in one batch. */
export type SessionOp =
  | { readonly op: 'add-node'; readonly id: NodeId }
  | {
      readonly op: 'add-edge';
      readonly id: EdgeId;
      readonly source: NodeId;
      readonly target: NodeId;
    }
  | { readonly op: 'remove-node'; readonly id: NodeId }
  | { readonly op: 'remove-edge'; readonly id: EdgeId }
  | { readonly op: 'set-parent'; readonly id: NodeId; readonly parent: NodeId | undefined };

/** One relayout's worth of edits. The engine sees one patch per step. */
export type SessionStep = readonly SessionOp[];

/** One session of the corpus: the graph it starts from and what happens to it. */
export interface SessionEntry {
  readonly name: string;
  readonly kind: SessionKind;
  /** The `layeredDag` call, in full, so the base graph can be rebuilt from the file. */
  readonly base: LayeredOptions;
  /** How many patches the session emits. One relayout each. */
  readonly steps: number;
  /**
   * How much each step touches. What it counts is the kind's business: nodes
   * added for `grow` and `churn`, nodes removed for `prune`, edges swapped for
   * `rewire`, nodes reparented for `reparent`, and leaves per block for
   * `pattern`.
   *
   * AN UPPER BOUND rather than a count, on the three kinds that draw an id: a
   * step that draws the same node or the same edge twice skips the duplicate
   * rather than re-drawing, so that the number of draws per step is a constant
   * and one skipped op cannot shift the whole session's random stream. What
   * each session actually emitted is recorded as `built.ops` in the golden
   * file.
   */
  readonly width: number;
  /** Seeds the choices the planner makes, and nothing else. */
  readonly seed: number;
}

export const sessionCorpus: readonly SessionEntry[] = [
  {
    name: 'grow-tall',
    kind: 'grow',
    base: {
      name: 'grow-tall',
      nodeCount: 240,
      edgeCount: 620,
      layerCount: 18,
      seed: 0xb1,
      longEdgeShare: 0.25,
      backEdgeShare: 0.02,
    },
    steps: 16,
    width: 2,
    seed: 0xb101,
  },
  {
    name: 'prune-wide',
    kind: 'prune',
    base: {
      name: 'prune-wide',
      nodeCount: 320,
      edgeCount: 900,
      layerCount: 8,
      seed: 0xb2,
      longEdgeShare: 0.1,
      backEdgeShare: 0.02,
    },
    steps: 16,
    width: 2,
    seed: 0xb202,
  },
  {
    name: 'rewire-mid',
    kind: 'rewire',
    base: {
      name: 'rewire-mid',
      nodeCount: 260,
      edgeCount: 780,
      layerCount: 12,
      seed: 0xb3,
      longEdgeShare: 0.2,
      backEdgeShare: 0.04,
    },
    steps: 16,
    width: 3,
    seed: 0xb303,
  },
  {
    name: 'reparent-mid',
    kind: 'reparent',
    base: {
      name: 'reparent-mid',
      nodeCount: 200,
      edgeCount: 520,
      layerCount: 10,
      seed: 0xb4,
      longEdgeShare: 0.2,
      backEdgeShare: 0.02,
    },
    steps: 8,
    width: 4,
    seed: 0xb404,
  },
  {
    name: 'churn-balanced',
    kind: 'churn',
    base: {
      name: 'churn-balanced',
      nodeCount: 240,
      edgeCount: 640,
      layerCount: 14,
      seed: 0xb5,
      longEdgeShare: 0.25,
      backEdgeShare: 0.03,
    },
    steps: 16,
    width: 4,
    seed: 0xb505,
  },
  {
    name: 'pattern-blocks',
    kind: 'pattern',
    base: {
      name: 'pattern-blocks',
      nodeCount: 180,
      edgeCount: 460,
      layerCount: 12,
      seed: 0xb6,
      longEdgeShare: 0.3,
      backEdgeShare: 0.02,
    },
    steps: 12,
    width: 3,
    seed: 0xb606,
  },
];

/**
 * The base graph of a session, built the way `golden-corpus.ts` builds its own.
 *
 * Edge ids are the ones `Graph.addEdge` mints, which is what lets a planner name
 * an existing edge to remove: they are deterministic in insertion order, and
 * insertion order here is the generator's.
 */
export function buildSessionGraph(entry: SessionEntry): Graph {
  const spec = layeredDag(entry.base);
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/** A stable pick from a list, by a number the caller drew. */
function pick<T>(items: readonly T[], draw: number): T {
  const item = items[Math.min(items.length - 1, Math.floor(draw * items.length))];
  if (item === undefined) throw new Error('picked from an empty list');
  return item;
}

/**
 * The session's steps, planned against a throwaway copy of the base graph.
 *
 * The copy is what makes a plan possible at all: `prune` has to know which node
 * ids still exist by step twelve, and `rewire` which edge ids it has already
 * spent. Planning against a live graph and replaying the plan against a fresh
 * one is the same trick `layout.relayout.test.ts` uses when it records patches
 * from a subscription, one level up.
 *
 * The plan holds ONLY ids and never a graph, so nothing a configuration does to
 * its own copy can reach back into what the next configuration replays.
 */
export function planSession(entry: SessionEntry): readonly SessionStep[] {
  const graph = buildSessionGraph(entry);
  const random = mulberry32(entry.seed);
  const steps: SessionStep[] = [];
  for (let step = 0; step < entry.steps; step += 1) {
    const ops = planStep(entry, graph, random, step);
    for (const op of ops) applyOp(graph, op);
    steps.push(ops);
  }
  return steps;
}

/** Applies one planned op to a graph. The one place a session touches a graph. */
export function applyOp(graph: Graph, op: SessionOp): void {
  switch (op.op) {
    case 'add-node':
      graph.addNode(op.id);
      return;
    case 'add-edge':
      graph.addEdge(op.source, op.target, op.id);
      return;
    case 'remove-node':
      graph.removeNode(op.id);
      return;
    case 'remove-edge':
      graph.removeEdge(op.id);
      return;
    case 'set-parent':
      graph.setNodeParent(op.id, op.parent);
      return;
  }
}

/**
 * One step of one session.
 *
 * Every kind draws its choices from the same generator in the same order it
 * would have drawn them in, so a kind that skips a draw does not shift the
 * sequence for a later step of another kind: each entry has a generator of its
 * own, seeded by the entry.
 */
function planStep(
  entry: SessionEntry,
  graph: Graph,
  random: () => number,
  step: number,
): SessionStep {
  switch (entry.kind) {
    case 'grow':
      return growStep(graph, random, step, entry.width);
    case 'prune':
      return pruneStep(graph, random, entry.width);
    case 'rewire':
      return rewireStep(graph, random, step, entry.width);
    case 'reparent':
      return reparentStep(graph, random, entry.width);
    case 'churn':
      return churnStep(graph, random, step, entry.width);
    case 'pattern':
      return patternStep(graph, random, step, entry.width);
  }
}

/**
 * A node arrives with one edge into it and one out of it.
 *
 * Both ends rather than one, because a leaf hanging off the drawing is the
 * cheapest patch there is and a session made only of them says nothing about a
 * layering under pressure. The two ends are drawn independently and may put the
 * node anywhere, including on a back edge, which is the point: a session that
 * only ever appended to the bottom would never make the cycle breaker or the
 * ranker do anything.
 */
function growStep(
  graph: Graph,
  random: () => number,
  step: number,
  width: number,
): SessionStep {
  const ids = graph.nodes().map((node) => node.id);
  const ops: SessionOp[] = [];
  for (let index = 0; index < width; index += 1) {
    const id = `g${String(step).padStart(2, '0')}${String(index)}`;
    ops.push({ op: 'add-node', id });
    ops.push({ op: 'add-edge', id: `${id}-in`, source: pick(ids, random()), target: id });
    ops.push({ op: 'add-edge', id: `${id}-out`, source: id, target: pick(ids, random()) });
  }
  return ops;
}

/**
 * Nodes leave, and their edges leave with them.
 *
 * The ops name only the nodes: `Graph.removeNode` emits the edge removals
 * itself, so naming them here would be this file's guess at what the graph does
 * rather than what it does.
 */
function pruneStep(graph: Graph, random: () => number, width: number): SessionStep {
  const ids = graph.nodes().map((node) => node.id);
  const chosen = new Set<NodeId>();
  const ops: SessionOp[] = [];
  for (let index = 0; index < width; index += 1) {
    const id = pick(ids, random());
    if (chosen.has(id)) continue;
    chosen.add(id);
    ops.push({ op: 'remove-node', id });
  }
  return ops;
}

/**
 * An edge moves: the same node count, the same edge count, a different graph.
 *
 * This is the session the stability contract has the least room in. Nothing
 * arrives to widen the influence set and nothing leaves to shrink it, so every
 * node that moves moved because the layering moved under it.
 */
function rewireStep(
  graph: Graph,
  random: () => number,
  step: number,
  width: number,
): SessionStep {
  const nodes = graph.nodes().map((node) => node.id);
  const edges = graph.edges().map((edge) => edge.id);
  const spent = new Set<EdgeId>();
  const ops: SessionOp[] = [];
  for (let index = 0; index < width; index += 1) {
    const victim = pick(edges, random());
    const source = pick(nodes, random());
    const target = pick(nodes, random());
    if (spent.has(victim) || source === target) continue;
    spent.add(victim);
    ops.push({ op: 'remove-edge', id: victim });
    ops.push({
      op: 'add-edge',
      id: `r${String(step).padStart(2, '0')}${String(index)}`,
      source,
      target,
    });
  }
  return ops;
}

/**
 * Containment changes and nothing else does.
 *
 * The parents are drawn from the FIRST eight nodes of the roster and are never
 * themselves reparented, so no step can build a containment cycle and none can
 * be refused. That leaves the session measuring exactly one thing, which is
 * what M7 will make interesting and what today makes it the control: no stage
 * in this package reads a parent, so a correct pipeline moves nothing here.
 */
function reparentStep(graph: Graph, random: () => number, width: number): SessionStep {
  const ids = graph.nodes().map((node) => node.id);
  const containers = ids.slice(0, 8);
  const candidates = ids.slice(8);
  const chosen = new Set<NodeId>();
  const ops: SessionOp[] = [];
  for (let index = 0; index < width; index += 1) {
    const id = pick(candidates, random());
    const parent = pick(containers, random());
    if (chosen.has(id)) continue;
    chosen.add(id);
    ops.push({ op: 'set-parent', id, parent });
  }
  return ops;
}

/**
 * A cohort arrives, and on the next step the same cohort leaves.
 *
 * A BALANCED cycle: after every even step the graph is the base graph again,
 * node for node and edge for edge. That is what makes the retained state
 * assertable, which is the reason this session is in the corpus. A leak in the
 * engine's retained maps is invisible to every metric here and shows up as a
 * map that came back bigger than it went in.
 */
function churnStep(
  graph: Graph,
  random: () => number,
  step: number,
  width: number,
): SessionStep {
  const cycle = Math.floor(step / 2);
  if (step % 2 === 1) {
    const ops: SessionOp[] = [];
    for (let index = 0; index < width; index += 1) {
      ops.push({ op: 'remove-node', id: churnId(cycle, index) });
    }
    return ops;
  }
  const ids = graph.nodes().map((node) => node.id);
  const ops: SessionOp[] = [];
  for (let index = 0; index < width; index += 1) {
    const id = churnId(cycle, index);
    ops.push({ op: 'add-node', id });
    ops.push({ op: 'add-edge', id: `${id}-in`, source: pick(ids, random()), target: id });
    ops.push({ op: 'add-edge', id: `${id}-out`, source: id, target: pick(ids, random()) });
  }
  return ops;
}

/** The id one churn cycle gives one of its nodes. Minted twice, added then removed. */
function churnId(cycle: number, index: number): NodeId {
  return `c${String(cycle).padStart(2, '0')}${String(index)}`;
}

/**
 * A block lands whole: one hub attached to the drawing, and its leaves.
 *
 * This is the pattern-generator shape M3.10a's entry asks for and M6.6's first
 * reference DSL emits. What makes it different from `grow` is not the count: it
 * is that the order stage is handed a cohort with structure of its own, all of
 * it new in one patch, so where the block goes is a decision about the block
 * rather than about a node.
 */
function patternStep(
  graph: Graph,
  random: () => number,
  step: number,
  width: number,
): SessionStep {
  const ids = graph.nodes().map((node) => node.id);
  const hub = `p${String(step).padStart(2, '0')}h`;
  const ops: SessionOp[] = [
    { op: 'add-node', id: hub },
    { op: 'add-edge', id: `${hub}-in`, source: pick(ids, random()), target: hub },
  ];
  for (let index = 0; index < width; index += 1) {
    const leaf = `p${String(step).padStart(2, '0')}l${String(index)}`;
    ops.push({ op: 'add-node', id: leaf });
    ops.push({ op: 'add-edge', id: `${leaf}-in`, source: hub, target: leaf });
  }
  return ops;
}
