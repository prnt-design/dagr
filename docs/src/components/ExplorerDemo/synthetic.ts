/**
 * The large demo's graph: 2,000 nodes, generated, never stored.
 *
 * Shaped like a layered system so the layout reads one way: 40 layers of 50
 * nodes, each layer a role (ingress, routing, services, stores and so on,
 * cycling), every edge running forward. Most edges join a node to a near
 * neighbor in the layer before it, which keeps the drawing a braid rather
 * than a hairball; a few skip a layer or two.
 *
 * Seeded and deterministic, so every visitor and every browser check sees
 * the same graph. The generator is mulberry32, written out here so the docs
 * site needs nothing from the bench kit.
 */

import type { ExplorerEdge, ExplorerNode, ExplorerView } from '@prnt/dagr-explorer';

export const LARGE_NODE_COUNT = 2_000;
const LAYERS = 40;
const PER_LAYER = LARGE_NODE_COUNT / LAYERS;
const ROLES = [
  'Ingress',
  'Router',
  'Gateway',
  'Session',
  'Catalog',
  'Pricing',
  'Ledger',
  'Notifier',
  'Indexer',
  'Archive',
] as const;

export interface SyntheticNode extends ExplorerNode {
  /** The node's layer, 0 first. Every edge runs to a higher layer. */
  readonly layer: number;
  readonly role: (typeof ROLES)[number];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const idOf = (layer: number, slot: number): string =>
  `n${String(layer).padStart(2, '0')}-${String(slot).padStart(2, '0')}`;

/** A slot in `layer` near `slot`, within `spread` either side, clamped. */
function near(random: () => number, slot: number, spread: number): number {
  const offset = Math.floor(random() * (spread * 2 + 1)) - spread;
  return Math.min(PER_LAYER - 1, Math.max(0, slot + offset));
}

export function syntheticView(seed = 2026): ExplorerView<SyntheticNode> {
  const random = mulberry32(seed);
  const nodes: SyntheticNode[] = [];
  const edges: ExplorerEdge[] = [];
  const seen = new Set<string>();
  const link = (source: string, target: string, dash: boolean): void => {
    const id = `${source}>${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push(dash ? { id, source, target, dash } : { id, source, target });
  };

  for (let layer = 0; layer < LAYERS; layer += 1) {
    const role = ROLES[layer % ROLES.length]!;
    for (let slot = 0; slot < PER_LAYER; slot += 1) {
      const id = idOf(layer, slot);
      nodes.push({ id, label: `${role} ${String(layer * PER_LAYER + slot + 1)}`, layer, role });
      if (layer === 0) continue;
      // One way in from a near neighbor in the layer before, always.
      link(idOf(layer - 1, near(random, slot, 2)), id, false);
      // Sometimes a second.
      if (random() < 0.35) link(idOf(layer - 1, near(random, slot, 4)), id, false);
      // Rarely, an asynchronous edge that skips a layer or two, drawn dashed.
      if (layer >= 3 && random() < 0.06) {
        const back = 2 + Math.floor(random() * 2);
        link(idOf(layer - back, near(random, slot, 6)), id, true);
      }
    }
  }

  return {
    id: 'large',
    label: 'Synthetic system',
    nodes,
    edges,
    layout: { direction: 'right', nodeSize: { width: 160, height: 56 }, nodeSep: 24, rankSep: 96 },
  };
}
