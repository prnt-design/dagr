import type { NodeId } from '@dagr/graph';
import { acyclicView, longestPathRanks } from './acyclic.js';
import type { AcyclicView } from './acyclic.js';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError, InvalidConfigError } from './errors.js';
import type { RankStage } from './types.js';

/**
 * The rank stage that minimises total edge length: Gansner, Koutsofios, North
 * and Vo, "A Technique for Drawing Directed Graphs" (1993), section 2.
 */

/** The iteration budget a stage built with no `maxIterations` runs to. */
const DEFAULT_MAX_ITERATIONS = 20_000;

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node or edge number `acyclicView` minted. Absence is a bug
 * here rather than in the caller, so it fails loudly instead of reading as
 * `undefined` through arithmetic that would quietly produce `NaN`.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/** What a caller may say about a network simplex run. */
export interface NetworkSimplexOptions {
  /**
   * How many pivots the solver may take before returning what it has. Shared
   * across the whole graph rather than granted per connected component.
   * Defaults to 20,000, which converges every graph the test corpus and the 1k
   * bench corpus contain.
   *
   * The budget is a safety valve rather than a quality knob. Whatever it stops,
   * the ranking returned is feasible, and it is never worse than the ranking
   * the stage started from.
   *
   * @throws {InvalidConfigError} when it is not a finite number that is zero or
   * greater. Checked when the stage is built rather than when it runs, so a bad
   * budget fails at the call that named it.
   */
  readonly maxIterations?: number;

  /**
   * A previous ranking to start from. A HINT, never trusted: see the warm start
   * section of {@link networkSimplexRank}.
   */
  readonly initialRanks?: ReadonlyMap<NodeId, number>;
}

/**
 * The floor per node number that a hint asks for, or `undefined` for no hint.
 *
 * Everything unusable is dropped rather than repaired into something else, and
 * dropping is safe because a floor is only ever a preference: the sweep in
 * `longestPathRanks` pushes a node below its predecessors whatever its floor
 * said, so a node with no floor lands exactly where the cold run would have put
 * it. Three things are dropped, all for the same reason, which is that they
 * carry no information a feasible ranking of THIS graph could use.
 *
 * An id the graph does not hold has no node to be a floor for. A value that is
 * not an integer is not a rank. And a value outside `[-count, count]` is wider
 * than any ranking of `count` nodes needs to be, so honouring one would not
 * express a preference between two optima, it would hand the solver a ranking
 * stretched over a window it then has to pivot back closed, one unit of
 * nonsense per pivot. That is the case that turns a stale hint from a tie-break
 * into a denial of service.
 */
function floorFrom(
  hint: ReadonlyMap<NodeId, number> | undefined,
  view: AcyclicView,
): Int32Array | undefined {
  if (hint === undefined || hint.size === 0) return undefined;
  const count = view.nodes.length;
  const floor = new Int32Array(count);
  for (const [id, value] of hint) {
    const number = view.numbers.get(id);
    if (number === undefined) continue;
    if (!Number.isInteger(value) || value < -count || value > count) continue;
    floor[number] = value;
  }
  return floor;
}

/** The budget, checked at the call that named it. */
function resolveBudget(maxIterations: number | undefined): number {
  if (maxIterations === undefined) return DEFAULT_MAX_ITERATIONS;
  if (!Number.isFinite(maxIterations) || maxIterations < 0) {
    throw new InvalidConfigError('maxIterations', maxIterations);
  }
  return maxIterations;
}

/**
 * Moves a feasible ranking to one of minimum total edge length, in place.
 *
 * The ranking handed in has to be feasible already, which is what
 * `longestPathRanks` guarantees whatever floor it was given. Everything here is
 * a rank shift of one side of a cut, and every shift preserves feasibility, so
 * the array is a feasible ranking at every point in the run and the caller can
 * stop it anywhere.
 *
 * ## The cut value, and why there is no leaf elimination here
 *
 * The textbook computes a tree edge's cut value by eliminating leaves. There is
 * a shorter route. For a tree edge `f` joining `p` to its child `c`, let `S` be
 * the node set of `c`'s subtree, and give every node `v` the weight
 * `netInflow(v) = indegree(v) - outdegree(v)` over the view's edges. Then
 *
 *     sum over v in S of netInflow(v) = (edges entering S) - (edges leaving S)
 *
 * because an edge with both endpoints in `S` is counted once each way and
 * cancels, an edge entering `S` is counted once as an in-degree, and an edge
 * leaving `S` once as an out-degree. The cut value of `f` is defined as the
 * edges running from `f`'s tail side to its head side minus those running back,
 * so it is that sum when `f` runs `p -> c` (the tail side is then everything
 * outside `S`) and its negation when `f` runs `c -> p`. One postorder
 * accumulation therefore gives every cut value in the tree, and the sign
 * depends only on which way `f` points, which is the part worth reading twice:
 * a sign error here does not produce a wrong answer, it produces a confident
 * pessimiser, and `test/layout.simplex.test.ts` compares these numbers against
 * cut values counted edge by edge for exactly that reason.
 *
 * ## Cost per pivot
 *
 * A pivot exchanges `f` for a non-tree edge crossing the same cut the other
 * way, and the PARTITION into `S` and the rest does not change: only the edge
 * joining the two sides, and how `S` is rooted inside itself. So the work is
 * proportional to `S` and to the edges incident to it, not to the graph:
 * `S` is walked to mark it, the entering candidates are enumerated from `S`'s
 * own nodes rather than by scanning every edge, `S` alone is shifted, and `S`
 * alone is re-rooted. Outside `S` only the two paths from the old and the new
 * attachment point up to their common ancestor change, by plus or minus the one
 * subtree sum, which is why the tree is kept rooted at a node that is never in
 * `S`: the root is the component's first node, and `S` is always a subtree of
 * one of its descendants.
 *
 * What that leaves O(V) per pivot is the search for a tree edge with a negative
 * cut value, which is the paper's own weak spot too. It resumes where the last
 * one left off and wraps rather than restarting at the first node, which is
 * what the paper recommends, but the bound is the bound: a structure that keeps
 * the candidates is the next thing to try if a measurement asks for it.
 *
 * ## Determinism
 *
 * Same graph, same ranks, always, and every tie is broken by the graph's own
 * iteration order. Components are visited in node insertion order and each is
 * rooted at its first node. The leave-edge search walks the component's nodes
 * in insertion order, resuming after the last edge it found. The entering edge
 * is the one of minimum slack, and among equal slacks the one added to the
 * graph first, compared by edge number rather than by the order the incidence
 * lists happen to reach it, so the answer does not depend on the shape of the
 * tree at the time.
 */
function tighten(view: AcyclicView, rank: Int32Array, budget: number): void {
  const { from, to } = view;
  const count = view.nodes.length;
  const edgeCount = from.length;
  if (count === 0) return;

  // Undirected incidence as CSR: every edge appears under both endpoints. The
  // simplex walks a SPANNING TREE, which ignores direction, and rebuilding an
  // adjacency per pivot is what the whole cost argument above is about.
  const start = new Int32Array(count + 1);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    start[at(from, edge) + 1] = at(start, at(from, edge) + 1) + 1;
    start[at(to, edge) + 1] = at(start, at(to, edge) + 1) + 1;
  }
  for (let node = 0; node < count; node += 1) {
    start[node + 1] = at(start, node + 1) + at(start, node);
  }
  const cursor = start.slice(0, count);
  const incident = new Int32Array(edgeCount * 2);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = at(from, edge);
    incident[at(cursor, source)] = edge;
    cursor[source] = at(cursor, source) + 1;
    const target = at(to, edge);
    incident[at(cursor, target)] = edge;
    cursor[target] = at(cursor, target) + 1;
  }
  const other = (edge: number, node: number): number =>
    at(from, edge) === node ? at(to, edge) : at(from, edge);
  const slackOf = (edge: number): number =>
    at(rank, at(to, edge)) - at(rank, at(from, edge)) - 1;

  // indegree - outdegree per node, which is every cut value in the tree once it
  // has been summed over a subtree. See the identity above.
  const netInflow = new Int32Array(count);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    netInflow[at(to, edge)] = at(netInflow, at(to, edge)) + 1;
    netInflow[at(from, edge)] = at(netInflow, at(from, edge)) - 1;
  }

  // Every walk below is a depth-first one over distinct nodes, so one array of
  // node numbers with a top index serves them all, and no `pop` returns
  // `undefined` for a defensive branch to have an opinion about.
  const stack = new Int32Array(count);
  let top = 0;

  // Connected components of the UNDIRECTED view. Two nodes with no path between
  // them constrain each other not at all, so each component is its own problem
  // and its own ranking, normalised to start at rank 0 like every other.
  const componentOf = new Int32Array(count).fill(-1);
  let componentCount = 0;
  for (let seed = 0; seed < count; seed += 1) {
    if (at(componentOf, seed) >= 0) continue;
    componentOf[seed] = componentCount;
    stack[0] = seed;
    top = 1;
    while (top > 0) {
      top -= 1;
      const node = at(stack, top);
      for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
        const next = other(at(incident, slot), node);
        if (at(componentOf, next) >= 0) continue;
        componentOf[next] = componentCount;
        stack[top] = next;
        top += 1;
      }
    }
    componentCount += 1;
  }
  // The components as one array of node numbers grouped by component, each
  // group in node insertion order, with a start index per group. An array of
  // arrays would allocate a row per component, and a graph of isolated nodes
  // has as many components as nodes.
  const componentStart = new Int32Array(componentCount + 1);
  for (let node = 0; node < count; node += 1) {
    const group = at(componentOf, node) + 1;
    componentStart[group] = at(componentStart, group) + 1;
  }
  for (let group = 0; group < componentCount; group += 1) {
    componentStart[group + 1] = at(componentStart, group + 1) + at(componentStart, group);
  }
  const grouped = new Int32Array(count);
  const groupCursor = componentStart.slice(0, componentCount);
  for (let node = 0; node < count; node += 1) {
    const group = at(componentOf, node);
    grouped[at(groupCursor, group)] = node;
    groupCursor[group] = at(groupCursor, group) + 1;
  }

  const treeEdge = new Uint8Array(edgeCount);
  const inTree = new Uint8Array(count);
  const parent = new Int32Array(count).fill(-1);
  const parentEdge = new Int32Array(count).fill(-1);
  const depth = new Int32Array(count);
  const subtree = new Int32Array(count);
  // 0 outside the region being re-rooted, 1 inside it, 2 inside and already
  // walked. One array rather than two because the walk that assigns parents is
  // confined to the region the walk before it marked, and reusing the mark as
  // the visited flag saves clearing a second array per pivot.
  const region = new Uint8Array(count);
  const marked = new Int32Array(count);
  let markedCount = 0;
  const order = new Int32Array(count);
  const treeNodes = new Int32Array(count);
  const saved = new Int32Array(count);

  /**
   * What a component's edges cost as the ranks stand. Each edge is priced once,
   * from its source, and both its endpoints are in one component because the
   * components are the components of the undirected view.
   */
  const componentTotal = (base: number, size: number): number => {
    let total = 0;
    for (let index = 0; index < size; index += 1) {
      const node = at(grouped, base + index);
      for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
        const edge = at(incident, slot);
        if (at(from, edge) !== node) continue;
        total += at(rank, at(to, edge)) - at(rank, node);
      }
    }
    return total;
  };

  /**
   * Roots the region marked 1 at `entry`, hanging it under `above` by
   * `edgeAbove`, and accumulates the subtree sums over it. Every node it
   * reaches is marked 2, so the walk consumes the marks it walks on.
   */
  const rootRegion = (entry: number, above: number, edgeAbove: number): void => {
    let ordered = 0;
    parent[entry] = above;
    parentEdge[entry] = edgeAbove;
    depth[entry] = above < 0 ? 0 : at(depth, above) + 1;
    region[entry] = 2;
    order[ordered] = entry;
    ordered += 1;
    stack[0] = entry;
    top = 1;
    while (top > 0) {
      top -= 1;
      const node = at(stack, top);
      for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
        const edge = at(incident, slot);
        if (at(treeEdge, edge) !== 1 || at(region, other(edge, node)) !== 1) continue;
        const next = other(edge, node);
        region[next] = 2;
        parent[next] = node;
        parentEdge[next] = edge;
        depth[next] = at(depth, node) + 1;
        order[ordered] = next;
        ordered += 1;
        stack[top] = next;
        top += 1;
      }
    }
    // Children always follow their parent in preorder, so one reverse sweep is
    // a valid postorder accumulation, without a second traversal to produce it.
    for (let index = 0; index < ordered; index += 1) {
      const node = at(order, index);
      subtree[node] = at(netInflow, node);
    }
    for (let index = ordered - 1; index >= 1; index -= 1) {
      const node = at(order, index);
      const holder = at(parent, node);
      subtree[holder] = at(subtree, holder) + at(subtree, node);
    }
  };

  let iterations = 0;

  for (let group = 0; group < componentCount; group += 1) {
    const base = at(componentStart, group);
    const size = at(componentStart, group + 1) - base;
    const root = at(grouped, base);
    // What the component started at, kept so that the run can be abandoned for
    // it. See the restore below.
    let startedAt = 0;
    if (size > 1) {
      for (let index = 0; index < size; index += 1) {
        const node = at(grouped, base + index);
        saved[node] = at(rank, node);
      }
      startedAt = componentTotal(base, size);

      // A tight tree: a spanning tree of the component using only edges with no
      // slack. Grown from the root over tight edges, and when it stalls, the
      // minimum-slack edge with exactly one endpoint in it is made tight by
      // shifting everything already in the tree. That shift moves both ends of
      // every edge inside the tree, so the tree stays tight, and it preserves
      // feasibility because the edge it closes is the tightest one crossing.
      let treeSize = 0;
      for (let index = 0; index < size; index += 1) inTree[at(grouped, base + index)] = 0;
      inTree[root] = 1;
      treeNodes[0] = root;
      treeSize = 1;
      stack[0] = root;
      top = 1;
      for (;;) {
        while (top > 0) {
          top -= 1;
          const node = at(stack, top);
          for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
            const edge = at(incident, slot);
            const next = other(edge, node);
            if (at(inTree, next) === 1 || slackOf(edge) !== 0) continue;
            inTree[next] = 1;
            treeEdge[edge] = 1;
            treeNodes[treeSize] = next;
            treeSize += 1;
            stack[top] = next;
            top += 1;
          }
        }
        if (treeSize >= size) break;
        let closing = -1;
        let closingSlack = Number.POSITIVE_INFINITY;
        for (let index = 0; index < treeSize; index += 1) {
          const node = at(treeNodes, index);
          for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
            const edge = at(incident, slot);
            if (at(inTree, other(edge, node)) === 1) continue;
            const slack = slackOf(edge);
            if (slack < closingSlack || (slack === closingSlack && edge < closing)) {
              closingSlack = slack;
              closing = edge;
            }
          }
        }
        // Unreachable: the component is connected in the undirected view, so a
        // tree that does not span it has an edge leaving it. Throwing rather
        // than breaking out, because breaking out would leave a tree that is
        // not spanning and every pivot after it would read a parent pointer
        // that was never set.
        if (closing < 0) {
          throw new InternalLayoutError(
            `no edge leaves the tight tree of ${String(treeSize)} of ` +
              `${String(size)} nodes, so the component is not connected after all`,
          );
        }
        const shift = at(inTree, at(to, closing)) === 1 ? -closingSlack : closingSlack;
        for (let index = 0; index < treeSize; index += 1) {
          const node = at(treeNodes, index);
          rank[node] = at(rank, node) + shift;
          // Everything in the tree may have gained a tight edge, not just the
          // endpoint of the one just closed, so the whole tree is rescanned.
          // The scan is what the stall already costs, so this is free.
          stack[top] = node;
          top += 1;
        }
      }

      for (let index = 0; index < size; index += 1) region[at(grouped, base + index)] = 1;
      rootRegion(root, -1, -1);
      for (let index = 0; index < size; index += 1) region[at(grouped, base + index)] = 0;
    }

    // Pivots. A tree edge with a negative cut value is one the ranking would be
    // shorter without, so it leaves, and the tightest non-tree edge crossing
    // the same cut the other way takes its place.
    let scan = 0;
    while (size > 1 && iterations < budget) {
      let leave = -1;
      let leaveIsDown = false;
      for (let step = 0; step < size; step += 1) {
        const index = (scan + step) % size;
        const node = at(grouped, base + index);
        const edge = at(parentEdge, node);
        if (edge < 0) continue;
        const down = at(from, edge) !== node;
        const cut = down ? at(subtree, node) : -at(subtree, node);
        if (cut < 0) {
          leave = node;
          leaveIsDown = down;
          scan = (index + 1) % size;
          break;
        }
      }
      if (leave < 0) break;

      // The subtree below the leaving edge, which is one side of the cut. Found
      // by walking the tree from `leave` without crossing the edge above it.
      const leaveEdge = at(parentEdge, leave);
      markedCount = 0;
      region[leave] = 1;
      marked[markedCount] = leave;
      markedCount += 1;
      stack[0] = leave;
      top = 1;
      while (top > 0) {
        top -= 1;
        const node = at(stack, top);
        for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
          const edge = at(incident, slot);
          if (at(treeEdge, edge) !== 1 || edge === leaveEdge) continue;
          const next = other(edge, node);
          if (at(region, next) !== 0) continue;
          region[next] = 1;
          marked[markedCount] = next;
          markedCount += 1;
          stack[top] = next;
          top += 1;
        }
      }

      // The entering edge: minimum slack among the non-tree edges crossing the
      // cut the other way from the one leaving. Enumerated from the marked
      // side's own nodes, so a pivot never looks at an edge both of whose
      // endpoints are somewhere else entirely.
      let enter = -1;
      let enterSlack = Number.POSITIVE_INFINITY;
      for (let index = 0; index < markedCount; index += 1) {
        const node = at(marked, index);
        for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
          const edge = at(incident, slot);
          if (at(treeEdge, edge) === 1 || at(region, other(edge, node)) !== 0) continue;
          // `leaveIsDown` means the leaving edge runs into the marked side, so
          // what replaces it has to run out of it, and the other way round.
          if ((at(from, edge) === node) !== leaveIsDown) continue;
          const slack = slackOf(edge);
          if (slack < enterSlack || (slack === enterSlack && edge < enter)) {
            enterSlack = slack;
            enter = edge;
          }
        }
      }
      // Unreachable: a negative cut value counts strictly more edges crossing
      // the cut against the leaving edge than with it, and the leaving edge is
      // the only tree edge crossing at all, so at least one non-tree edge runs
      // the way this search wants. Throwing rather than breaking, because
      // breaking here is an infinite loop: nothing about the tree would have
      // changed, and the next pass would pick the same leaving edge again.
      if (enter < 0) {
        throw new InternalLayoutError(
          `the cut below node ${String(leave)} has a negative cut value and no edge ` +
            'crossing it the other way, which the cut value says cannot happen',
        );
      }

      const shift = leaveIsDown ? enterSlack : -enterSlack;
      if (shift !== 0) {
        for (let index = 0; index < markedCount; index += 1) {
          const node = at(marked, index);
          rank[node] = at(rank, node) + shift;
        }
      }
      treeEdge[leaveEdge] = 0;
      treeEdge[enter] = 1;

      // The marked side keeps its nodes and loses its attachment point, so
      // every subtree sum strictly above the old attachment loses it and every
      // one above the new attachment gains it. The two paths meet at a common
      // ancestor and cancel from there up, which is what the depths are for.
      const sum = at(subtree, leave);
      const inside = at(region, at(from, enter)) === 1 ? at(from, enter) : at(to, enter);
      const outside = other(enter, inside);
      let losing = at(parent, leave);
      let gaining = outside;
      while (losing !== gaining) {
        if (at(depth, losing) >= at(depth, gaining)) {
          subtree[losing] = at(subtree, losing) - sum;
          losing = at(parent, losing);
        } else {
          subtree[gaining] = at(subtree, gaining) + sum;
          gaining = at(parent, gaining);
        }
      }

      rootRegion(inside, outside, enter);
      for (let index = 0; index < markedCount; index += 1) region[at(marked, index)] = 0;
      iterations += 1;
    }

    // A run cut short by the budget can be worse than the ranking it was given,
    // and the culprit is the tight tree rather than any pivot. Growing it
    // shifts a partly grown tree to close its tightest crossing edge, which
    // lengthens every edge running into the tree while it shortens every edge
    // running out, and the arithmetic can come out against it. Every pivot
    // after that only shortens, so a run with pivots left to take wins it back
    // and this restore never fires; a run with none is why the promise is
    // checked here rather than argued for. `test/layout.simplex.test.ts` holds
    // the eight-node graph that reaches it.
    if (size > 1 && componentTotal(base, size) > startedAt) {
      for (let index = 0; index < size; index += 1) {
        const node = at(grouped, base + index);
        rank[node] = at(saved, node);
      }
    }

    let lowest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < size; index += 1) {
      lowest = Math.min(lowest, at(rank, at(grouped, base + index)));
    }
    for (let index = 0; index < size; index += 1) {
      const node = at(grouped, base + index);
      rank[node] = at(rank, node) - lowest;
    }
  }
}

/**
 * Builds a rank stage that minimises the TOTAL EDGE LENGTH: the sum, over the
 * edges of the acyclic view, of how many ranks each edge crosses.
 *
 * `networkSimplexRankStage` is this with no options, and is what to reach for
 * unless a run needs a warm start or a budget.
 *
 * ## What it optimises, and what it costs
 *
 * Total edge length minus the edge count is exactly the number of dummy nodes
 * M2.4b's splitter will mint, so it is the quantity that decides how much of
 * the drawing is chains of stand-in nodes rather than the caller's own. On the
 * 1k bench corpus it takes the default ranker's 40,430 dummies down to 17,285,
 * a 57% cut, in about 20ms. On the 10k corpus it reaches 405,709 from
 * 1,414,263 inside the default budget, and 221,975 given ten times it.
 *
 * **It cannot make the drawing shorter, and it can make it taller.** Every
 * feasible ranking sends each edge down at least one rank, so along a path of L
 * edges the ranks differ by at least L, the maximum rank is at least the longest
 * path in the acyclic view, and `longestPathRankStage` hits that bound exactly.
 * Nothing here can beat that bound and nothing here defends it either: six
 * nodes are enough to lose a rank of height for a unit of length. With
 * `v8 -> v4 -> v5`, `v6 -> v5`, `v6 -> v9 -> v0`, longest path draws three
 * layers and pays 6; pulling `v6` down one rank tightens `v6 -> v5` and pays 5,
 * and it drags `v9` and `v0` down into a fourth layer to do it. Minimum total
 * edge length and minimum height are DIFFERENT OBJECTIVES and this stage
 * optimises the first. Pick the default stage if a short drawing is what
 * matters. (Both corpora happen to come out the same height either way, 61
 * ranks and 153 ranks, so this is a real risk rather than a certainty.)
 *
 * Ranks come out contiguous from zero per connected component, as the default
 * stage's do, but as a consequence rather than a construction: a ranking with an
 * empty rank between two occupied ones is never optimal, because sliding
 * everything below the gap up by one shortens every edge that crossed it and
 * breaks none. An exhausted budget can therefore leave a gap, and nothing
 * downstream minds: the order stage sorts the distinct ranks it finds.
 *
 * ## How
 *
 * Cycles are broken exactly as the default stage breaks them, with the greedy
 * feedback arc set of `cycles.ts`, and the ranking runs over the same acyclic
 * view. Then: a longest-path ranking to start from, a spanning tree of
 * zero-slack edges, and a sequence of pivots, each of which finds a tree edge
 * the ranking would be shorter without and swaps it for the tightest edge
 * crossing the same cut the other way. It stops when no tree edge has a
 * negative cut value, which is the optimality condition for this LP. See
 * {@link tighten}, which is where the cut-value identity and the per-pivot cost
 * are argued.
 *
 * ## The budget
 *
 * `maxIterations` bounds the pivots, and defaults to 20,000, which is a safety
 * valve and not a quality knob. It is ten times what the 1k bench corpus needs
 * to converge (which is between 1,000 and 2,000 pivots: the answer stops moving
 * there and a budget of 200,000 returns the same ranking), and it is what
 * bounds the 10k corpus, which does not converge inside any budget worth
 * spending, to about three seconds. Give it more if a run is worth it: the 10k
 * corpus takes 41 seconds and is still improving at 200,000 pivots.
 *
 * Whatever stops it, the ranking returned is feasible, and never worse than the
 * ranking it started from. Feasible because every step here is a rank shift of
 * one side of a cut, which preserves every edge's descent. Never worse because
 * it is CHECKED, and not because it is obvious: growing the first tight tree
 * can shift a partly grown tree in a direction that lengthens more edges than
 * it shortens, and with no pivots left to win that back the run would return
 * something worse than it was given. Each component therefore keeps the better
 * of the ranking it started with and the ranking it ended with. Eight nodes are
 * enough to reach it, and the graph that does is in the test suite.
 *
 * ## The warm start
 *
 * `initialRanks` is a previous ranking to start from, and it exists because the
 * ranking LP is DEGENERATE: many different spanning trees reach the same total
 * edge length, and which optimum a cold run lands on depends on the tree it
 * started from. Without a warm start, a one-edge patch can move the solver to a
 * different optimum of equal cost, churning ranks across a region that did not
 * change and improving nothing. M3 re-runs layout on every patch, so that is
 * not a hypothetical.
 *
 * A supplied ranking is a HINT and never a starting point taken on trust. It is
 * used as a floor for the longest-path sweep, which pushes any node the hint put
 * too high back down below its predecessors, so the ranking the solver actually
 * starts from is feasible whatever the hint said. Three kinds of entry are
 * dropped: an id the graph does not hold, a value that is not an integer, and a
 * value outside `[-count, count]`, which is wider than any ranking of `count`
 * nodes needs. A hint therefore cannot make the result infeasible, and cannot
 * make it non-optimal either as long as the budget holds; all it can do is
 * choose between optima, which is the whole point.
 *
 * ## Determinism
 *
 * Same graph, same ranks, always. Every tie-break is the graph's own iteration
 * order and every intermediate structure is an array indexed by node or edge
 * number: see {@link tighten}. What is NOT claimed is invariance to the order
 * the graph was built in. Cycle breaking is order-sensitive before ranking
 * starts, and among two optima of equal cost this stage returns whichever its
 * tie-breaks reach first, so the same graph assembled in another order may rank
 * differently. On a graph with a unique optimum it may not, and the test suite
 * pins that narrower claim rather than the one it would be nice to make.
 *
 * @throws {InvalidConfigError} when `maxIterations` is not a finite number that
 * is zero or greater.
 */
export function networkSimplexRank(options?: NetworkSimplexOptions): RankStage {
  const budget = resolveBudget(options?.maxIterations);
  const hint = options?.initialRanks;
  return {
    name: 'network-simplex-rank',
    run(input) {
      const { graph } = input;
      const reversedEdges = feedbackArcSet(graph);
      const view = acyclicView(graph, reversedEdges);
      const rank = longestPathRanks(view, floorFrom(hint, view));
      tighten(view, rank, budget);

      const ranks = new Map<NodeId, number>();
      for (const [number, node] of view.nodes.entries()) ranks.set(node.id, at(rank, number));
      return { ranks, reversedEdges };
    },
  };
}

/**
 * The network simplex rank stage with no options: a 20,000 pivot budget and no
 * warm start. See {@link networkSimplexRank}, which is where all of it is
 * argued, including why this is not the default stage.
 */
export const networkSimplexRankStage: RankStage = networkSimplexRank();
