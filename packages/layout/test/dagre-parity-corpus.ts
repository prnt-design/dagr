import { Graph } from '@dagr/graph';
import type { Node, NodeId } from '@dagr/graph';
import type { Size } from '../src/types.js';

/**
 * The corpus M2.9 compares against dagre: hand-authored graphs shaped after
 * real ones, at box sizes that are not all the same.
 *
 * NOT `test/golden-corpus.ts`, WHICH IS A DIFFERENT THING WITH A SIMILAR NAME.
 * That file is six graphs from `@dagr/bench`'s `layeredDag`, generated, uniform
 * at 100 by 40, and shared by the order, transpose and route suites so that no
 * two of them pin crossing numbers for graphs nobody else has. It stays exactly
 * as it is and this file does not extend it. The two answer different
 * questions. That one asks whether the order stage got worse at its own job,
 * against its own past self, and an exact count is the strongest claim
 * available. This one asks how the whole pipeline's drawing compares to another
 * engine's drawing of the same graph, which is a comparison of two answers
 * neither of which is the reference. A generated layered graph is the wrong
 * input for that: it is drawn from the distribution this package's own stages
 * were tuned against, so it flatters both engines equally and tells a reader
 * nothing about the graphs they have.
 *
 * ## Why the sizes vary, which is the whole reason this file exists
 *
 * M2.8's algorithms review found a bug that four tables over eight graphs could
 * not see, and the reason they could not see it was not subtlety. Every corpus
 * graph in this package is laid out at one uniform 100 by 40 box, and the bug
 * was in a cap that only binds when a box is large against the separation
 * around it. `layout()` threw on four nodes at the default config with one box
 * 2000 wide, and on 664 of 3,000 random DAGs with widths from 10 to 2010, while
 * every corpus table agreed about a property that was real and was being
 * checked entirely outside the regime where the code could fail.
 *
 * So box size is a dimension the corpus varies BY CONSTRUCTION rather than a
 * row bolted onto one file. {@link SIZE_KINDS} spans three orders of magnitude
 * of area, from a 24 by 24 handle to a 1,200 by 280 preview, against a default
 * `nodeSep` and `rankSep` of 50. It is also the honest shape for the input this
 * package was written for: a node's box is its label and its ports, and no real
 * editor draws every node the same size.
 *
 * ## What the pipeline branches on, and whether this corpus varies it
 *
 * Listed because a corpus that is uniform in what the code branches on tests
 * nothing about that branch, however large it is. Every row names the graphs
 * that carry the case.
 *
 * | dimension                   | varied | where                                    |
 * | --------------------------- | ------ | ---------------------------------------- |
 * | box size against separation | yes    | every graph, cap one binds on five       |
 * | box size enough to bind CAP | yes    | `canvas-composite`, and only there       |
 * | zero-size boxes             | yes    | `scattered-suite`, and only there        |
 * | long-edge share (chains)    | yes    | none in `org-chart`, most in `module-imports` |
 * | back-edge share (cycles)    | yes    | none in the seven DAGs, many in `state-machine` |
 * | self loops                  | yes    | `state-machine`                          |
 * | parallel edges              | yes    | `service-mesh`                           |
 * | disconnected components     | yes    | `scattered-suite`, five of them          |
 * | isolated nodes              | yes    | `scattered-suite`                        |
 * | layer count                 | yes    | 3 in `etl-fanout`, 18 in `module-imports` |
 * | widest layer                | yes    | 26 in `etl-fanout`, 2 in `module-imports` |
 *
 * The second row is there because the first one is not enough, and finding that
 * out cost a measurement. M2.8's router has TWO attachment caps and the review's
 * bug was in the second. Eight of these nine graphs bind the first cap, between
 * them eight times, and bound the second one ZERO times, which is a corpus that
 * varies box size without reaching the branch the box sizes were varied for.
 * `canvas-composite` was built for that branch after the fact and is the only
 * graph here that reaches it. See the parity suite's `singleCapRouteStage`.
 *
 * Two dimensions this corpus does NOT vary, said here rather than left to be
 * discovered. Every graph is laid out at the default `nodeSep`, `rankSep` and
 * `edgeSep`, because a parity comparison wants one configuration on both sides
 * and the config sweep belongs to the suites that own each stage. And every
 * graph is small, tens of nodes rather than thousands, which is forced: the
 * crossing metric is a geometric count over emitted polylines and is quadratic
 * in segments, so it does not run at the 214,222 segments of the 10k bench
 * corpus. The benchmark half of M2.9 is measured on the bench corpora instead
 * and this corpus is not a substitute for them. See
 * `test/layout.dagre-parity.test.ts`.
 */

/**
 * The box sizes a node may take, named after what draws that shape rather than
 * after its numbers, so a graph below reads as a drawing and not as a table of
 * measurements.
 *
 * The spread against the default 50 of separation is the point. `handle` is half
 * a separation across and `preview` is twenty-four, with a half-diagonal of 616,
 * which is wider than a whole rank gap. An attachment on a box that size cannot
 * reach its own border before the router's first cap stops it, so the box sizes
 * here put the drawing inside a regime no other corpus in this package enters.
 * Where the SECOND cap binds is a separate and much narrower question that a big
 * box alone does not answer, and `canvas-composite` is the graph that answers
 * it. Both are counted in the parity suite rather than assumed here, as
 * `cappedAttachments` and `endsMovedBySecondCap`.
 */
export const SIZE_KINDS = {
  /** A drag handle or a port stub. Smaller than `nodeSep`. */
  handle: { width: 24, height: 24 },
  /** A zero-size node. Legal input, and the degenerate end of every formula. */
  point: { width: 0, height: 0 },
  /** A scalar parameter with a short label. */
  param: { width: 120, height: 32 },
  /** An operator with a name and a couple of ports. */
  op: { width: 180, height: 64 },
  /** A long-named operator. Wide and short, which stresses `nodeSep`. */
  banner: { width: 640, height: 40 },
  /** A node with many stacked ports. Narrow and tall, which stresses `rankSep`. */
  stack: { width: 80, height: 220 },
  /** A collapsed group. */
  group: { width: 260, height: 96 },
  /** A live canvas preview. The one that makes an attachment cap bind. */
  preview: { width: 1_200, height: 280 },
} as const satisfies Record<string, Size>;

/** The name of one of {@link SIZE_KINDS}. */
export type SizeKind = keyof typeof SIZE_KINDS;

/** A node of a parity graph: its id and the box it is drawn at. */
export type ParityNode = readonly [id: string, kind: SizeKind];

/** An edge of a parity graph, source first, as the author wrote it. */
export type ParityEdge = readonly [source: string, target: string];

/** One graph of the corpus, as the data that builds it. */
export interface ParityGraph {
  readonly name: string;
  /** What this graph is shaped after, in one line, for a reader of a failure. */
  readonly shapedAfter: string;
  readonly nodes: readonly ParityNode[];
  /**
   * Edges in author order. Duplicated pairs are parallel edges and are kept:
   * `Graph.addEdge` mints a distinct id for each, and the parity suite carries
   * that id across to dagre as a multigraph edge name, so the two engines are
   * compared edge for edge rather than pair for pair.
   */
  readonly edges: readonly ParityEdge[];
}

/**
 * A pattern generator, which is the graph this milestone was asked for by name
 * and the shape M6.6's first reference DSL takes.
 *
 * A generative pattern editor: parameter nodes feed operators, operators feed
 * blends, and one wide preview node sits at the end showing the result. The
 * shape that matters here is not the topology, which is an ordinary layered
 * DAG. It is the SIZES. A scalar parameter is a slider and draws small, an
 * operator carries a name and two or three ports, a collapsed group is a block,
 * and the preview is a live canvas an order of magnitude wider than anything
 * else in the drawing. That spread is what a real editor produces and what no
 * other corpus in this package has.
 *
 * It is a DAG, deliberately. `ROADMAP.md` records under M3.7 that a pattern
 * generator emits acyclic graphs, so the reversed set is empty and stays empty
 * on this input, and cycle breaking is exercised by `state-machine` and
 * `service-mesh` instead. A corpus that made every graph cyclic would misstate
 * what this consumer actually sends.
 */
const patternGenerator: ParityGraph = {
  name: 'pattern-generator',
  shapedAfter: 'a generative pattern editor, parameters into operators into a preview',
  nodes: [
    ['seed', 'param'],
    ['scale', 'param'],
    ['octaves', 'param'],
    ['rotation', 'param'],
    ['palette', 'group'],
    ['noise', 'op'],
    ['gradient', 'op'],
    ['voronoi', 'op'],
    ['stripes', 'op'],
    ['warp', 'op'],
    ['tile', 'op'],
    ['mirror', 'op'],
    ['posterize', 'op'],
    ['blend-a', 'op'],
    ['blend-b', 'op'],
    ['mask', 'stack'],
    ['colourise', 'group'],
    ['grain', 'param'],
    ['export-svg', 'banner'],
    ['preview', 'preview'],
  ],
  edges: [
    ['seed', 'noise'],
    ['seed', 'voronoi'],
    ['scale', 'noise'],
    ['scale', 'gradient'],
    ['scale', 'stripes'],
    ['octaves', 'noise'],
    ['rotation', 'stripes'],
    ['rotation', 'mirror'],
    ['noise', 'warp'],
    ['noise', 'mask'],
    ['gradient', 'warp'],
    ['gradient', 'blend-a'],
    ['voronoi', 'tile'],
    ['stripes', 'tile'],
    ['warp', 'blend-a'],
    ['tile', 'mirror'],
    ['mirror', 'blend-b'],
    ['blend-a', 'posterize'],
    ['blend-a', 'blend-b'],
    ['posterize', 'colourise'],
    ['blend-b', 'colourise'],
    ['mask', 'colourise'],
    ['palette', 'colourise'],
    ['grain', 'preview'],
    ['colourise', 'preview'],
    ['colourise', 'export-svg'],
    // Long edges: a parameter read directly by a late stage, which is what a
    // user does when they wire a slider to the last node in the chain.
    ['seed', 'grain'],
    ['scale', 'posterize'],
    ['palette', 'export-svg'],
  ],
};

const canvasComposite: ParityGraph = {
  name: 'canvas-composite',
  shapedAfter: 'a pattern editor with the canvas itself in the graph, long edges routed past it',
  nodes: [
    ['canvas', 'preview'],
    ['reference', 'preview'],
    ['crop', 'banner'],
    ['levels', 'banner'],
    ['denoise', 'banner'],
    ['sharpen', 'banner'],
    ['channel-mix', 'banner'],
    ['threshold', 'param'],
    ['dither', 'op'],
    ['halftone', 'op'],
    ['composite', 'group'],
    ['contact-sheet', 'banner'],
    ['swatch', 'handle'],
    ['export-png', 'op'],
  ],
  edges: [
    ['canvas', 'crop'],
    ['canvas', 'denoise'],
    ['reference', 'levels'],
    ['reference', 'sharpen'],
    ['crop', 'channel-mix'],
    ['levels', 'channel-mix'],
    ['denoise', 'channel-mix'],
    ['sharpen', 'channel-mix'],
    ['channel-mix', 'threshold'],
    ['threshold', 'dither'],
    ['threshold', 'halftone'],
    ['dither', 'composite'],
    ['halftone', 'composite'],
    ['composite', 'contact-sheet'],
    ['composite', 'export-png'],
    ['swatch', 'composite'],
    // The long ones, and the reason this graph is in the corpus: they leave a
    // 1,200 wide box and their first bend is a dummy pushed off to the side of
    // a rank a banner already fills, so the far endpoint is nearer than the
    // bend and the second attachment cap is the one that binds.
    ['canvas', 'channel-mix'],
    ['canvas', 'composite'],
    ['canvas', 'export-png'],
    ['reference', 'threshold'],
    ['reference', 'contact-sheet'],
  ],
};

/**
 * A CI build pipeline: checkout, install, a wide fan-out of parallel jobs, and
 * a reconvergence into a release.
 *
 * The shape it contributes is the FAN, one node with a dozen successors that
 * all rejoin two ranks later, which is where an order stage's barycenter has
 * the least to work with and where crossings are decided by the tie rule rather
 * than by the sweep. Node widths track job-name length, the way a real pipeline
 * view draws them.
 */
const buildPipeline: ParityGraph = {
  name: 'build-pipeline',
  shapedAfter: 'a CI pipeline, one checkout fanning into parallel jobs and back into a release',
  nodes: [
    ['checkout', 'op'],
    ['restore-cache', 'param'],
    ['install', 'op'],
    ['typecheck', 'param'],
    ['lint', 'param'],
    ['unit-tests', 'op'],
    ['integration-tests', 'banner'],
    ['browser-tests', 'banner'],
    ['bench', 'param'],
    ['build-graph', 'param'],
    ['build-layout', 'param'],
    ['build-render', 'param'],
    ['build-docs', 'op'],
    ['bundle-size', 'handle'],
    ['licence-scan', 'handle'],
    ['collect', 'group'],
    ['sign', 'param'],
    ['publish-docs', 'op'],
    ['release', 'group'],
  ],
  edges: [
    ['checkout', 'restore-cache'],
    ['restore-cache', 'install'],
    ['install', 'typecheck'],
    ['install', 'lint'],
    ['install', 'unit-tests'],
    ['install', 'integration-tests'],
    ['install', 'browser-tests'],
    ['install', 'bench'],
    ['install', 'build-graph'],
    ['install', 'build-layout'],
    ['install', 'build-render'],
    ['install', 'build-docs'],
    ['build-graph', 'collect'],
    ['build-layout', 'collect'],
    ['build-render', 'collect'],
    ['build-docs', 'publish-docs'],
    ['build-layout', 'bundle-size'],
    ['build-render', 'bundle-size'],
    ['install', 'licence-scan'],
    ['typecheck', 'collect'],
    ['lint', 'collect'],
    ['unit-tests', 'collect'],
    ['integration-tests', 'collect'],
    ['browser-tests', 'collect'],
    ['bench', 'collect'],
    ['bundle-size', 'collect'],
    ['licence-scan', 'sign'],
    ['collect', 'sign'],
    ['sign', 'release'],
    ['publish-docs', 'release'],
    // Long edges: the checkout is an input to the release record itself.
    ['checkout', 'sign'],
    ['checkout', 'release'],
  ],
};

/**
 * A source-file import DAG: eighteen ranks deep, never more than two nodes
 * wide, and half its edges skip ranks.
 *
 * This is the corpus's LONG-EDGE graph, and long edges are what M2.4b's dummy
 * chains exist for. A module near the bottom importing a utility near the top
 * is the ordinary case in a real dependency graph and the expensive one here:
 * every rank it skips mints a dummy, and the drawing's segment count runs well
 * ahead of its edge count. It is the graph where the two engines have the most
 * room to disagree, because both spend most of their ordering effort on nodes
 * neither graph contains.
 */
const moduleImports: ParityGraph = {
  name: 'module-imports',
  shapedAfter: 'a TypeScript package import graph, deep and full of rank-skipping edges',
  nodes: [
    ['types', 'param'],
    ['errors', 'param'],
    ['util', 'param'],
    ['config', 'op'],
    ['graph-core', 'op'],
    ['adjacency', 'param'],
    ['traversal', 'op'],
    ['cycles', 'op'],
    ['acyclic', 'op'],
    ['rank', 'op'],
    ['simplex', 'banner'],
    ['chains', 'op'],
    ['segments', 'param'],
    ['order', 'op'],
    ['transpose', 'param'],
    ['position', 'stack'],
    ['route', 'op'],
    ['stages', 'op'],
    ['pipeline', 'group'],
    ['index', 'banner'],
  ],
  edges: [
    ['types', 'errors'],
    ['types', 'util'],
    ['errors', 'config'],
    ['util', 'config'],
    ['config', 'graph-core'],
    ['graph-core', 'adjacency'],
    ['adjacency', 'traversal'],
    ['traversal', 'cycles'],
    ['cycles', 'acyclic'],
    ['acyclic', 'rank'],
    ['rank', 'simplex'],
    ['rank', 'chains'],
    ['chains', 'segments'],
    ['segments', 'order'],
    ['order', 'transpose'],
    ['transpose', 'position'],
    ['position', 'route'],
    ['route', 'stages'],
    ['stages', 'pipeline'],
    ['pipeline', 'index'],
    // The long ones: everything imports the leaf modules.
    ['types', 'graph-core'],
    ['types', 'rank'],
    ['types', 'order'],
    ['types', 'position'],
    ['types', 'route'],
    ['types', 'index'],
    ['errors', 'rank'],
    ['errors', 'order'],
    ['errors', 'pipeline'],
    ['util', 'order'],
    ['util', 'position'],
    ['config', 'position'],
    ['config', 'pipeline'],
    ['graph-core', 'route'],
    ['acyclic', 'order'],
    ['cycles', 'stages'],
    ['simplex', 'stages'],
    ['chains', 'route'],
    ['order', 'stages'],
    ['position', 'index'],
  ],
};

/**
 * An editor state machine, which is the corpus's CYCLIC graph.
 *
 * Every other graph here is a DAG, so this one carries the whole of the cycle
 * breaker's exercise: back edges in both directions between the same pair of
 * states, a three-state cycle, and self loops on the states a user can stay in.
 * A self loop spans no rank and has no direction to attach along, which is a
 * rule both engines have and state differently, so it belongs in a parity
 * corpus rather than only in the order suite.
 *
 * The two engines break cycles differently by construction, dagre with a greedy
 * feedback arc set and this package with M2.2c's least-squares vertex order, so
 * this is the graph where a rank-count difference is expected rather than
 * suspicious. That expectation is stated in the parity suite as a wider
 * tolerance for this row and not as an exemption from the metric.
 */
const stateMachine: ParityGraph = {
  name: 'state-machine',
  shapedAfter: 'an editor state machine, back edges and self loops on every resting state',
  nodes: [
    ['boot', 'param'],
    ['idle', 'op'],
    ['selecting', 'op'],
    ['dragging', 'op'],
    ['connecting', 'op'],
    ['editing', 'group'],
    ['validating', 'param'],
    ['saving', 'op'],
    ['error', 'banner'],
    ['retrying', 'param'],
    ['offline', 'stack'],
    ['closing', 'param'],
    ['closed', 'handle'],
  ],
  edges: [
    ['boot', 'idle'],
    ['idle', 'idle'],
    ['idle', 'selecting'],
    ['selecting', 'selecting'],
    ['selecting', 'dragging'],
    ['selecting', 'connecting'],
    ['selecting', 'editing'],
    ['dragging', 'selecting'],
    ['connecting', 'validating'],
    ['validating', 'connecting'],
    ['validating', 'editing'],
    ['editing', 'editing'],
    ['editing', 'validating'],
    ['editing', 'saving'],
    ['saving', 'idle'],
    ['saving', 'error'],
    ['error', 'retrying'],
    ['retrying', 'saving'],
    ['retrying', 'offline'],
    ['offline', 'offline'],
    ['offline', 'idle'],
    ['error', 'idle'],
    ['idle', 'closing'],
    ['closing', 'closed'],
    ['closing', 'idle'],
    ['editing', 'idle'],
  ],
};

/**
 * A service dependency mesh, which is the corpus's PARALLEL-EDGE graph.
 *
 * Two services talk over more than one channel, an RPC call and an event
 * subscription, and that is two edges between the same ordered pair rather than
 * one edge drawn twice. Both engines route them onto coincident polylines,
 * because neither honours an `edgeSep` fan-out yet: `LayoutConfig.edgeSep` is
 * carried and unhonoured here as of M2.8, and dagre's `edgesep` applies to its
 * own dummy nodes rather than to a bundle. So the geometric crossing counter
 * has to say what coincident segments are worth, and this graph is where that
 * answer is pinned rather than assumed. It also carries cycles, so it is the
 * second cycle-breaking graph and the only one that has both.
 */
const serviceMesh: ParityGraph = {
  name: 'service-mesh',
  shapedAfter: 'a service dependency mesh, several channels between the same pair of services',
  nodes: [
    ['gateway', 'group'],
    ['auth', 'op'],
    ['sessions', 'param'],
    ['profiles', 'op'],
    ['billing', 'op'],
    ['ledger', 'stack'],
    ['catalogue', 'op'],
    ['search', 'banner'],
    ['recommend', 'op'],
    ['inventory', 'op'],
    ['orders', 'group'],
    ['payments', 'op'],
    ['notifications', 'param'],
    ['audit', 'handle'],
    ['metrics', 'handle'],
  ],
  edges: [
    ['gateway', 'auth'],
    ['gateway', 'auth'],
    ['gateway', 'catalogue'],
    ['gateway', 'orders'],
    ['auth', 'sessions'],
    ['auth', 'profiles'],
    ['sessions', 'auth'],
    ['profiles', 'billing'],
    ['billing', 'ledger'],
    ['billing', 'ledger'],
    ['billing', 'payments'],
    ['catalogue', 'search'],
    ['catalogue', 'inventory'],
    ['search', 'recommend'],
    ['recommend', 'catalogue'],
    ['inventory', 'orders'],
    ['orders', 'payments'],
    ['orders', 'payments'],
    ['orders', 'inventory'],
    ['payments', 'ledger'],
    ['payments', 'notifications'],
    ['notifications', 'audit'],
    ['ledger', 'audit'],
    ['ledger', 'audit'],
    ['orders', 'metrics'],
    ['auth', 'metrics'],
    ['payments', 'metrics'],
  ],
};

/**
 * An org chart: a pure tree, no long edges, no cycles, nothing but fan-out.
 *
 * The corpus's control. Every other graph here carries at least one structure
 * the pipeline has a special rule about, and a comparison that only ever ran on
 * awkward input would leave the ordinary case unmeasured. A tree has exactly
 * one drawing that is good and both engines should find something near it, so a
 * parity ratio far from one on THIS graph is the strongest signal in the table:
 * there is nothing here to blame it on.
 *
 * Widths still vary, because a job title is a label and a label is a box.
 */
const orgChart: ParityGraph = {
  name: 'org-chart',
  shapedAfter: 'a company org chart, a pure tree with no long edges and no cycles',
  nodes: [
    ['founder', 'group'],
    ['eng', 'op'],
    ['design', 'op'],
    ['ops', 'op'],
    ['platform', 'param'],
    ['product-eng', 'banner'],
    ['research', 'param'],
    ['brand', 'param'],
    ['systems', 'param'],
    ['finance', 'param'],
    ['people', 'param'],
    ['infra-1', 'handle'],
    ['infra-2', 'handle'],
    ['infra-3', 'handle'],
    ['app-1', 'handle'],
    ['app-2', 'handle'],
    ['app-3', 'handle'],
    ['app-4', 'handle'],
    ['res-1', 'handle'],
    ['brand-1', 'handle'],
    ['brand-2', 'handle'],
    ['sys-1', 'handle'],
    ['fin-1', 'handle'],
    ['people-1', 'handle'],
    ['people-2', 'handle'],
  ],
  edges: [
    ['founder', 'eng'],
    ['founder', 'design'],
    ['founder', 'ops'],
    ['eng', 'platform'],
    ['eng', 'product-eng'],
    ['design', 'research'],
    ['design', 'brand'],
    ['design', 'systems'],
    ['ops', 'finance'],
    ['ops', 'people'],
    ['platform', 'infra-1'],
    ['platform', 'infra-2'],
    ['platform', 'infra-3'],
    ['product-eng', 'app-1'],
    ['product-eng', 'app-2'],
    ['product-eng', 'app-3'],
    ['product-eng', 'app-4'],
    ['research', 'res-1'],
    ['brand', 'brand-1'],
    ['brand', 'brand-2'],
    ['systems', 'sys-1'],
    ['finance', 'fin-1'],
    ['people', 'people-1'],
    ['people', 'people-2'],
  ],
};

/**
 * A dashboard's ETL fan-out: one extract, one transform, and twenty-six loads.
 *
 * Three ranks and twenty-six nodes wide, which is the opposite extreme from
 * `module-imports` and the graph that decides how wide a drawing gets. The
 * widths in that row are deliberately mixed, from a 24-wide handle to a
 * 640-wide banner, so the row's total is not the node count times a constant
 * and a stage that assumed it was would show up here.
 */
const etlFanout: ParityGraph = {
  name: 'etl-fanout',
  shapedAfter: 'a dashboard ETL job, one source loading twenty-six tables of mixed width',
  nodes: [
    ['extract', 'group'],
    ['transform', 'banner'],
    ...Array.from({ length: 26 }, (_, index): ParityNode => {
      const kinds: readonly SizeKind[] = ['handle', 'param', 'op', 'banner', 'stack', 'group'];
      const kind = kinds[index % kinds.length];
      return [`load-${String.fromCharCode(97 + index)}`, kind ?? 'param'];
    }),
  ],
  edges: [
    ['extract', 'transform'],
    ...Array.from(
      { length: 26 },
      (_, index): ParityEdge => ['transform', `load-${String.fromCharCode(97 + index)}`],
    ),
    // Four loads read the extract directly, so the rank the fan lands on is not
    // decided by the transform alone.
    ['extract', 'load-a'],
    ['extract', 'load-h'],
    ['extract', 'load-q'],
    ['extract', 'load-z'],
  ],
};

/**
 * Three unrelated components, two isolated nodes and a node of no size at all.
 *
 * The degenerate graph, and every part of it is legal input. Disconnected
 * components make a layout an arbitrary choice about where to put the second
 * one, which the two engines make differently and both make deterministically.
 * An isolated node has no edge to be placed by. And a zero-size box is the
 * degenerate end of every measurement in the router: an attachment on it has no
 * distance to travel and a border it is already on, which is a case
 * `layout.route.test.ts` reaches through `rankSep: 0` and a target of no height
 * and which no corpus in this package had at the default config.
 *
 * It is also the one graph here where dagre does not produce a whole drawing. A
 * route leaving a box of zero WIDTH travelling straight up or down makes dagre
 * 3.1.1 emit a `y` that is not a number, because its border intersection
 * computes `width * dy / dx` and both `width` and `dx` are zero. Reproduced on
 * two nodes and one edge: a 0 by 0 target fails and so does 0 by 40, while 100
 * by 0 is fine, which is what says the zero WIDTH is the cause rather than the
 * zero area. Here it costs one point, on `a4` to `a5`, since the two edges
 * arriving at `a4` come in at an angle and are fine. That is recorded as a
 * metric rather than worked around, and it is why zero-size boxes are confined
 * to this one graph: the other seven rows of the parity table are then
 * comparisons of two complete drawings.
 */
const scatteredSuite: ParityGraph = {
  name: 'scattered-suite',
  shapedAfter: 'three unrelated components, two isolated nodes, and one node of zero size',
  nodes: [
    ['a1', 'op'],
    ['a2', 'param'],
    ['a3', 'banner'],
    ['a4', 'point'],
    ['a5', 'op'],
    ['b1', 'stack'],
    ['b2', 'handle'],
    ['b3', 'handle'],
    ['b4', 'group'],
    ['c1', 'preview'],
    ['c2', 'param'],
    ['lonely', 'op'],
    ['lonelier', 'point'],
  ],
  edges: [
    ['a1', 'a2'],
    ['a1', 'a3'],
    ['a2', 'a4'],
    ['a3', 'a4'],
    ['a4', 'a5'],
    ['a1', 'a5'],
    ['b1', 'b2'],
    ['b1', 'b3'],
    ['b2', 'b4'],
    ['b3', 'b4'],
    ['c1', 'c2'],
  ],
};

/**
 * The corpus, in the order the golden file records it.
 *
 * Nine graphs, and the count is not the point: each one is here for a structure
 * named in its own docblock, and the table at the top of this file is how a
 * reader checks that between them they cover what the pipeline branches on.
 * Adding a tenth means naming what it covers and adding a row there.
 */
export const parityCorpus: readonly ParityGraph[] = [
  patternGenerator,
  canvasComposite,
  buildPipeline,
  moduleImports,
  stateMachine,
  serviceMesh,
  orgChart,
  etlFanout,
  scatteredSuite,
];

/** The graph an entry describes, built in author order so both engines agree. */
export function buildParityGraph(entry: ParityGraph): Graph {
  const graph = new Graph();
  for (const [id] of entry.nodes) graph.addNode(id);
  for (const [source, target] of entry.edges) graph.addEdge(source, target);
  return graph;
}

/**
 * The `nodeSize` callback for an entry, and the same sizes the parity suite
 * hands dagre. A node the entry does not name falls through to the config
 * default, which cannot happen for a graph built by
 * {@link buildParityGraph} and is handled rather than asserted so that a
 * caller building a subgraph gets a size instead of a throw.
 */
export function parityNodeSizes(entry: ParityGraph): (node: Node) => Size | undefined {
  const sizes = new Map<NodeId, Size>(entry.nodes.map(([id, kind]) => [id, SIZE_KINDS[kind]]));
  return (node) => sizes.get(node.id);
}
