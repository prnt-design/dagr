/**
 * The three verbs the living demo offers, as data rather than as three
 * handlers.
 *
 * WHY A SCRIPT AND NOT THREE BUTTONS THAT CALL THE GRAPH. Three things have to
 * agree about an edit and only one of them is the mutation: the button has to
 * know whether the edit is available (a prune with nothing grown is a throw),
 * the readout has to name what the edit was, and a test has to be able to run
 * the whole sequence without a DOM. Splitting a step into a plan and an
 * application is what lets all three read the same object. {@link takeStep}
 * returning `null` IS the disabled state, so an enabled button and a step that
 * throws cannot disagree.
 *
 * EVERY STEP IS ONE `graph.batch`, AND THAT IS THE LOAD-BEARING DETAIL. A grow
 * is three nodes and six edges. Unbatched that is nine patches, nine relayouts
 * and ONE React commit holding the last, so `<DagrCanvas>` finds the delta it
 * is handed is a difference from a drawing it never drew, fails its continuity
 * check, and RESEATS rather than gliding. The picture is correct either way,
 * which is exactly why nothing but a test would catch it: the demo would
 * quietly stop demonstrating the one thing it exists to demonstrate.
 * `test/edit-script.test.ts` counts the patches.
 *
 * THE CYCLE IS THE IDENTITY, and that is how this file obeys the camera rule.
 * `<DagrCanvas>` fits once and never refits, because a camera that chases every
 * edit hides the stability it is supposed to reveal: a drawing that stays put
 * while the camera moves is indistinguishable from a drawing that moves. So the
 * demo cannot be allowed to grow out of the frame it was fitted to, and
 * {@link AUTOPLAY_CYCLE} returns the graph to exactly the node and edge sets it
 * started with. It can then autoplay forever inside that first fit.
 */

import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { STAGES, STAGE_WIDTHS, WIDEST_STAGE, edgeIdFor, stageOf } from './living-graph.js';
import type { Stage } from './living-graph.js';

/** The three verbs, in the order the controls show them. */
export const EDIT_KINDS = ['grow', 'prune', 'relayout'] as const;

/** One of {@link EDIT_KINDS}. */
export type EditKind = (typeof EDIT_KINDS)[number];

/**
 * The lap autoplay walks, chosen so that every position offers the verb at it
 * and the lap as a whole changes nothing.
 *
 * Two grows before the first prune, so a visitor watching without clicking sees
 * the graph get bigger before it gets smaller, and a relayout between them, so
 * the verb that adds and removes nothing gets seen against a graph that is
 * mid-change rather than only against the base.
 */
export const AUTOPLAY_CYCLE = [
  'grow',
  'relayout',
  'grow',
  'prune',
  'relayout',
  'prune',
] as const satisfies readonly EditKind[];

/** A node a grow adds. */
export interface PlannedNode {
  readonly id: NodeId;
  readonly stage: Stage;
}

/** An edge a grow adds. */
export interface PlannedEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
}

/** A cluster the demo can grow and then prune, as one batch each way. */
export interface ClusterPlan {
  readonly stage: Stage;
  /** The node in the stage before, which the new nodes hang off. */
  readonly parent: NodeId;
  /** The node in the stage after, which the new nodes feed. */
  readonly child: NodeId;
  readonly nodes: readonly PlannedNode[];
  readonly edges: readonly PlannedEdge[];
}

/**
 * The one edge the relayout verb adds and takes away again.
 *
 * A NEW DEPENDENCY BETWEEN TWO TASKS THAT WERE ALREADY THERE. No node appears
 * and none goes away, so the readout reads `0 added, 0 removed` and the moved
 * count is the whole story of the edit. That makes this the most honest of the
 * three verbs and the one to watch: the picture changes, and the number beside
 * it says how little of the picture changed.
 *
 * THE STAGES ARE MEASURED RATHER THAN CHOSEN. Two earlier shapes of this verb
 * were tried against the engine and both were wrong, in opposite directions.
 * Moving an edge's source a stage FORWARD changes the target's rank, which
 * inserts a rank, which shifts every layer below it: the delta said 25 of 25
 * nodes moved, beside a readout whose purpose is to say how few do. Swapping an
 * edge's source for another node in the SAME stage moves nothing at all, in all
 * 200 candidate swaps this graph offers, because `gridPositionStage` places a
 * node by its rank and its index within the rank and a same-rank swap changes
 * neither. A dependency that skips two ranks is the one that lands in between:
 * it bends through virtual nodes in the ranks it crosses, and those nudge the
 * six nodes nearest them and nothing else.
 */
export interface LinkPlan {
  readonly edge: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
}

/** Everything the three verbs can do to one graph, worked out up front. */
export interface EditScript {
  readonly clusters: readonly ClusterPlan[];
  readonly link: LinkPlan;
}

/** Three nodes and their wiring appear. */
export interface GrowStep {
  readonly kind: 'grow';
  readonly label: string;
  readonly cluster: number;
  readonly nodes: readonly PlannedNode[];
  readonly edges: readonly PlannedEdge[];
}

/** Three nodes go away, and `removeNode` takes their edges with them. */
export interface PruneStep {
  readonly kind: 'prune';
  readonly label: string;
  readonly cluster: number;
  readonly nodes: readonly NodeId[];
}

/** One edge between two existing nodes appears, or goes away again. */
export interface RelayoutStep {
  readonly kind: 'relayout';
  readonly label: string;
  readonly edge: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  /** Whether this step adds the edge. The other direction removes it. */
  readonly present: boolean;
}

/** What {@link applyStep} applies. */
export type EditStep = GrowStep | PruneStep | RelayoutStep;

/**
 * Where the demo is: which clusters are in the graph, whether the edge is
 * moved, and how far through the lap autoplay has got.
 *
 * Held by the component and threaded through {@link takeStep}, which is pure.
 * A demo whose availability rules lived in component state would have a second
 * copy of them for a test to drift from.
 */
export interface ScriptState {
  /** Cluster indices currently in the graph, oldest first. Prune takes the first. */
  readonly live: readonly number[];
  /** Whether {@link LinkPlan.edge} is currently in the graph. */
  readonly linked: boolean;
  /** The position in {@link AUTOPLAY_CYCLE} autoplay will take next. */
  readonly cursor: number;
}

/** Nothing grown, nothing moved, autoplay at the top of the lap. */
export const INITIAL_SCRIPT_STATE: ScriptState = Object.freeze({
  live: Object.freeze([]),
  linked: false,
  cursor: 0,
});

/** A step, and the state that taking it leaves behind. */
export interface TakenStep {
  readonly step: EditStep;
  readonly next: ScriptState;
}

/** How many nodes a grow adds. Three: enough to see, few enough to count. */
const CLUSTER_SIZE = 3;

/** Nodes by stage, in insertion order, which is left-to-right in the drawing. */
function byStage(graph: Graph): Map<Stage, NodeId[]> {
  const grouped = new Map<Stage, NodeId[]>();
  for (const stage of STAGES) grouped.set(stage, []);
  for (const node of graph.nodes()) {
    const stage = stageOf(node);
    if (stage === undefined) continue;
    grouped.get(stage)?.push(node.id);
  }
  return grouped;
}

/**
 * The `index`th node of `stage`, wrapped.
 *
 * Wrapped rather than asserted, because the stage widths are seeded: a script
 * that named a fixed index would break on a seed that happened to produce a
 * narrow column, and a demo whose script depends on the seed being lucky is one
 * nobody can change the seed of.
 */
function nth(layers: ReadonlyMap<Stage, readonly NodeId[]>, stage: Stage, index: number): NodeId {
  const layer = layers.get(stage) ?? [];
  const id = layer[index % Math.max(layer.length, 1)];
  if (id === undefined) throw new Error(`the living graph has no ${stage} nodes to build on`);
  return id;
}

/** A cluster of {@link CLUSTER_SIZE} nodes in `stage`, between two existing ones. */
function planCluster(
  layers: ReadonlyMap<Stage, readonly NodeId[]>,
  rank: number,
  parentIndex: number,
  childIndex: number,
): ClusterPlan {
  const stage = STAGES[rank];
  const before = STAGES[rank - 1];
  const after = STAGES[rank + 1];
  if (stage === undefined || before === undefined || after === undefined) {
    throw new Error(`stage rank ${String(rank)} has no stage on both sides of it`);
  }
  // The camera fits once, so a cluster that made its column the widest in the
  // drawing would make the drawing wider and walk out of that fit. See
  // STAGE_WIDTHS: `compile` is nine so that a six-wide column plus three still
  // fits inside the width the first frame was measured at.
  if (STAGE_WIDTHS[stage] + CLUSTER_SIZE > WIDEST_STAGE) {
    throw new Error(`growing ${stage} by ${String(CLUSTER_SIZE)} would widen the drawing`);
  }
  const parent = nth(layers, before, parentIndex);
  const child = nth(layers, after, childIndex);

  const nodes: PlannedNode[] = [];
  const edges: PlannedEdge[] = [];
  for (let index = 0; index < CLUSTER_SIZE; index += 1) {
    // `-new-` keeps these out of the base graph's `stage-index` namespace, so a
    // cluster grown a second time reuses ids that are genuinely free.
    const id = `${stage}-new-${String(index)}`;
    nodes.push({ id, stage });
    edges.push({ id: edgeIdFor(parent, id), source: parent, target: id });
    edges.push({ id: edgeIdFor(id, child), source: id, target: child });
  }
  return { stage, parent, child, nodes, edges };
}

/**
 * The two stages the relayout verb draws a new dependency between.
 *
 * Ranks one and three: a dependency that skips exactly two ranks. The reason is
 * measured and is written out on {@link LinkPlan}. Named as a pair rather than
 * searched for across the whole graph, because the thing that makes one
 * candidate right and another wrong is not a property this file could test for
 * without laying the graph out, and `test/bounds.test.ts` is where that is
 * checked instead.
 */
const LINK_STAGES = [1, 3] as const;

/** The first pair of nodes in {@link LINK_STAGES} with no edge between them. */
function planLink(graph: Graph, layers: ReadonlyMap<Stage, readonly NodeId[]>): LinkPlan {
  const [fromRank, toRank] = LINK_STAGES;
  const from = STAGES[fromRank];
  const to = STAGES[toRank];
  if (from === undefined || to === undefined) {
    throw new Error('the pipeline is too short to skip two ranks');
  }
  for (const source of layers.get(from) ?? []) {
    for (const target of layers.get(to) ?? []) {
      const edge = edgeIdFor(source, target);
      if (graph.hasEdge(edge)) continue;
      return { edge, source, target };
    }
  }
  throw new Error(`every ${from} node already feeds every ${to} node`);
}

/** Works out everything the three verbs can do, from the graph as it stands. */
export function createEditScript(graph: Graph): EditScript {
  const layers = byStage(graph);
  return {
    // `parse` and `bundle`: two six-wide columns, so growing either to nine
    // leaves the drawing exactly as wide as `compile` already makes it, and two
    // different ones, so a visitor who watches a whole lap sees a grow land in
    // two different parts of the drawing rather than twice in the same place.
    //
    // NEITHER OF THEM IS `resolve`, AND THAT IS NOT A FREE CHOICE. The relayout
    // verb's dependency skips the `resolve` rank, so the router bends it
    // through a virtual node that sits in that rank and takes a node's worth of
    // separation with it. Growing `resolve` to nine and then linking across it
    // made the column ten wide and the whole drawing 50 units wider than the
    // frame the camera had already been fitted to. `test/lap.test.ts` caught
    // that rather than a reader, which is the argument for having it.
    clusters: [planCluster(layers, 1, 0, 0), planCluster(layers, 4, 1, 0)],
    link: planLink(graph, layers),
  };
}

/** The lowest cluster index that is not in the graph. */
function nextCluster(script: EditScript, state: ScriptState): number | null {
  for (let index = 0; index < script.clusters.length; index += 1) {
    if (!state.live.includes(index)) return index;
  }
  return null;
}

/**
 * The cursor after taking `kind`, which moves only when `kind` is the verb the
 * lap was up to.
 *
 * The cursor is autoplay's place in {@link AUTOPLAY_CYCLE}, and a manual press
 * that happens to be the next verb of the lap IS progress through it. A press
 * that is not leaves the cursor alone rather than desynchronising the lap, so
 * "one lap returns to the top" holds however the lap was driven.
 */
function nextCursor(state: ScriptState, kind: EditKind): number {
  if (AUTOPLAY_CYCLE[state.cursor] !== kind) return state.cursor;
  return (state.cursor + 1) % AUTOPLAY_CYCLE.length;
}

/**
 * The step `kind` would take from `state`, or `null` when it cannot be taken.
 *
 * Pure. `null` is what the component reads as "disable this button", which is
 * why the availability rules live here and nowhere else.
 */
export function takeStep(
  script: EditScript,
  state: ScriptState,
  kind: EditKind,
): TakenStep | null {
  const cursor = nextCursor(state, kind);

  if (kind === 'grow') {
    const index = nextCluster(script, state);
    if (index === null) return null;
    const cluster = script.clusters[index];
    if (cluster === undefined) return null;
    return {
      step: {
        kind: 'grow',
        label: `three ${cluster.stage} tasks appear under ${cluster.parent}`,
        cluster: index,
        nodes: cluster.nodes,
        edges: cluster.edges,
      },
      next: { live: [...state.live, index], linked: state.linked, cursor },
    };
  }

  if (kind === 'prune') {
    const [index, ...rest] = state.live;
    if (index === undefined) return null;
    const cluster = script.clusters[index];
    if (cluster === undefined) return null;
    return {
      step: {
        kind: 'prune',
        label: `the three ${cluster.stage} tasks under ${cluster.parent} go away`,
        cluster: index,
        nodes: cluster.nodes.map((node) => node.id),
      },
      next: { live: rest, linked: state.linked, cursor },
    };
  }

  const { link } = script;
  const present = !state.linked;
  return {
    step: {
      kind: 'relayout',
      label: present
        ? `${link.target} now waits on ${link.source} as well`
        : `${link.target} stops waiting on ${link.source}`,
      edge: link.edge,
      source: link.source,
      target: link.target,
      present,
    },
    next: { live: state.live, linked: present, cursor },
  };
}

/** The verb autoplay takes next, and the step it would be. */
export function takeAutoStep(script: EditScript, state: ScriptState): TakenStep | null {
  const kind = AUTOPLAY_CYCLE[state.cursor];
  return kind === undefined ? null : takeStep(script, state, kind);
}

/**
 * Applies `step` to `graph` as ONE patch.
 *
 * The `graph.batch` is the whole function and it is not a tidiness measure: see
 * the file docstring, and `test/edit-script.test.ts`, which counts.
 */
export function applyStep(graph: Graph, step: EditStep): void {
  graph.batch(() => {
    switch (step.kind) {
      case 'grow': {
        for (const node of step.nodes) graph.addNode({ id: node.id, attrs: { stage: node.stage } });
        for (const edge of step.edges) {
          graph.addEdge({ id: edge.id, source: edge.source, target: edge.target });
        }
        return;
      }
      case 'prune': {
        // `removeNode` takes the node's edges with it, which is why a prune
        // names no edges: the cluster's wiring exists only because the cluster
        // does, so cascading it back out is exactly the inverse of the grow.
        for (const id of step.nodes) graph.removeNode(id);
        return;
      }
      case 'relayout': {
        // One edge, so the batch here buys nothing and is kept anyway: what a
        // step IS must not depend on how many ops it happens to make, or a
        // later edit that gives this arm a second op reintroduces the reseat
        // silently. Batching a single op costs one array.
        if (step.present) {
          graph.addEdge({ id: step.edge, source: step.source, target: step.target });
        } else {
          graph.removeEdge(step.edge);
        }
        return;
      }
    }
  });
}
