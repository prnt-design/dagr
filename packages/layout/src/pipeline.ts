import { resolveConfig } from './config.js';
import type { LayoutOptions, ResolvedLayoutConfig } from './config.js';
import { defaultStages } from './stages.js';
import type { LayoutStages } from './stages.js';
import { createLayoutState } from './state.js';
import type { LayoutState } from './state.js';
import type { LayoutInput, LayoutResult, PositionedNode, RoutedEdge } from './types.js';

/**
 * Read a finished state out as a {@link LayoutResult}.
 *
 * Nothing in `state` is mutated and nothing is shared with it: every node,
 * edge and point is copied, so the caller can keep using the state (that is
 * the point of a warm start) without the result changing under them.
 *
 * Only what the caller put in comes back out. Dummy nodes a stage
 * synthesized are skipped, and so are the segments an input edge was split
 * into: an input edge is reported once, whole, with its input endpoints. The
 * bounding box measures the real nodes only.
 *
 * Pair it with {@link runStages} when driving the pipeline by hand.
 * {@link runPipeline} calls it for you.
 */
export function buildResult(state: LayoutState, config: ResolvedLayoutConfig): LayoutResult {
  const nodes: PositionedNode[] = [];
  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  for (const node of state.nodes) {
    if (node.kind !== 'real') {
      continue;
    }
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    nodes.push({ id: node.id, x, y, width: node.width, height: node.height });
    minLeft = Math.min(minLeft, x - node.width / 2);
    minTop = Math.min(minTop, y - node.height / 2);
    maxRight = Math.max(maxRight, x + node.width / 2);
    maxBottom = Math.max(maxBottom, y + node.height / 2);
  }

  const empty = nodes.length === 0;
  const contentWidth = empty ? 0 : maxRight - minLeft;
  const contentHeight = empty ? 0 : maxBottom - minTop;

  const edges: RoutedEdge[] = [];
  for (const edge of state.edges) {
    if (edge.of !== undefined) {
      continue;
    }
    // A reversed edge is reported the way the caller wrote it: endpoints the
    // right way round and the route running from the input source, so the
    // cycle breaker stays an implementation detail.
    const points = edge.points.map((point) => ({ x: point.x, y: point.y }));
    if (edge.reversed) {
      points.reverse();
    }
    edges.push({
      id: edge.id,
      source: edge.reversed ? edge.target : edge.source,
      target: edge.reversed ? edge.source : edge.target,
      points,
    });
  }

  return {
    nodes,
    edges,
    // An empty graph has no content to measure, so its degenerate margin box
    // sits at the origin rather than at plus infinity.
    minX: empty ? 0 : minLeft - config.marginX,
    minY: empty ? 0 : minTop - config.marginY,
    width: contentWidth + 2 * config.marginX,
    height: contentHeight + 2 * config.marginY,
  };
}

/**
 * Run the four stages over an existing `state`: rank, then order, then
 * position, then route.
 *
 * Any stage left out of `stages` falls back to its pass-through default from
 * {@link defaultStages}. The state is mutated in place and nothing is
 * returned: read the answer off the state, or hand it to
 * {@link buildResult}.
 *
 * This is the seam incremental relayout needs. {@link runPipeline} always
 * starts from a fresh state, whereas an incremental caller (roadmap M3) wants
 * to feed the pipeline a warm state, one carrying the previous run's order
 * and coordinates, so stages that reuse them can keep the drawing stable
 * instead of recomputing it from nothing:
 *
 * ```ts
 * const config = resolveConfig(options);
 * const state = createLayoutState(input); // or a state you kept and updated
 * runStages(state, config, stages);
 * const result = buildResult(state, config);
 * ```
 */
export function runStages(state: LayoutState, config: ResolvedLayoutConfig, stages?: Partial<LayoutStages>): void {
  (stages?.rank ?? defaultStages.rank)(state, config);
  (stages?.order ?? defaultStages.order)(state, config);
  (stages?.position ?? defaultStages.position)(state, config);
  (stages?.route ?? defaultStages.route)(state, config);
}

/**
 * Run the layout pipeline over `input`: rank, then order, then position,
 * then route.
 *
 * Any stage left out of `stages` falls back to its pass-through default
 * from {@link defaultStages}, so replacing one stage keeps the other three.
 *
 * The caller's input is never mutated: it is validated and copied into
 * fresh pipeline state first, and the result is built from that state.
 *
 * This is {@link resolveConfig}, {@link createLayoutState},
 * {@link runStages} and {@link buildResult} in a row. Call those four
 * yourself when you need to hold on to the state between runs.
 *
 * @throws {LayoutError} for invalid config or invalid input.
 */
export function runPipeline(
  input: LayoutInput,
  options?: LayoutOptions,
  stages?: Partial<LayoutStages>,
): LayoutResult {
  const config = resolveConfig(options);
  const state = createLayoutState(input);
  runStages(state, config, stages);
  return buildResult(state, config);
}

/**
 * Lay out `input` with every default stage: the convenience entry point.
 *
 * Equivalent to `runPipeline(input, options)`.
 */
export function layout(input: LayoutInput, options?: LayoutOptions): LayoutResult {
  return runPipeline(input, options);
}
