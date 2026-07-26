import type { Node, NodeId } from '@dagr/graph';
import { InvalidConfigError } from './errors.js';
import type { LayoutConfig, PreparedState, ResolvedLayoutConfig, Size } from './types.js';

/**
 * The config a run uses when the caller says nothing. Exported so callers and
 * docs can read the numbers rather than repeat them, and frozen so reading them
 * cannot turn into changing them for every later run in the process.
 */
export const DEFAULT_LAYOUT_CONFIG: ResolvedLayoutConfig = Object.freeze({
  nodeSep: 50,
  rankSep: 50,
  edgeSep: 10,
  defaultNodeSize: Object.freeze({ width: 100, height: 40 }),
});

/**
 * Every measurement in this package has to be a finite number that is not
 * negative. `NaN` and `Infinity` are rejected here rather than tolerated,
 * because they do not fail: they propagate through every sum and comparison
 * downstream and surface much later as a scene that will not draw, with no
 * trace of which input caused it.
 */
function requireMeasure(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidConfigError(field, value);
  }
  return value;
}

/** Validates a size, naming the offending component in the error. */
function requireSize(size: Size, field: string): Size {
  if (typeof size !== 'object' || size === null) throw new InvalidConfigError(field, size);
  requireMeasure(size.width, `${field}.width`);
  requireMeasure(size.height, `${field}.height`);
  return { width: size.width, height: size.height };
}

/**
 * Fills in every default and rejects every unusable measurement, once, before
 * the first stage runs. Doing it here rather than in each stage is what lets
 * {@link ResolvedLayoutConfig} be the single stage context: there is one answer
 * for what `nodeSep` meant on this run and every stage reads the same one.
 *
 * @throws {InvalidConfigError} when a separation or a size is not a finite
 * number that is zero or greater.
 */
export function resolveConfig(config: LayoutConfig | undefined): ResolvedLayoutConfig {
  const defaults = DEFAULT_LAYOUT_CONFIG;
  return {
    nodeSep: requireMeasure(config?.nodeSep ?? defaults.nodeSep, 'nodeSep'),
    rankSep: requireMeasure(config?.rankSep ?? defaults.rankSep, 'rankSep'),
    edgeSep: requireMeasure(config?.edgeSep ?? defaults.edgeSep, 'edgeSep'),
    defaultNodeSize: requireSize(
      config?.defaultNodeSize ?? defaults.defaultNodeSize,
      'defaultNodeSize',
    ),
  };
}

/**
 * Sizes every node exactly once, so a `nodeSize` callback that measures text or
 * reads the DOM is called n times per run and never again mid-pipeline. A
 * callback that returns `undefined` falls back to `defaultNodeSize`, which
 * keeps "size these few nodes specially" a one-line callback.
 *
 * The returned map iterates in graph insertion order, like everything else
 * here, because a later stage may walk it and the run has to be reproducible.
 *
 * @throws {InvalidConfigError} when the callback returns a size that is not
 * usable, naming the node it came from.
 */
export function measureNodes(
  graph: PreparedState['graph'],
  config: ResolvedLayoutConfig,
  nodeSize: ((node: Node) => Size | undefined) | undefined,
): ReadonlyMap<NodeId, Size> {
  const sizes = new Map<NodeId, Size>();
  for (const node of graph.nodes()) {
    if (nodeSize === undefined) {
      sizes.set(node.id, config.defaultNodeSize);
      continue;
    }
    const measured = nodeSize(node);
    sizes.set(
      node.id,
      measured === undefined
        ? config.defaultNodeSize
        : requireSize(measured, `nodeSize(${JSON.stringify(node.id)})`),
    );
  }
  return sizes;
}
