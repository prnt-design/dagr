/**
 * The graph the living demo edits: a small, seeded, layered build pipeline.
 *
 * SMALL ON PURPOSE. The campaign demo is where 3,010 nodes are, and it proves
 * scale. This one proves something scale cannot show: that an edit moves the
 * part of the drawing it touches and leaves the rest alone. That claim is read
 * off a readout saying "24 of 29 nodes stayed put" beside a picture in which
 * those 24 visibly do, and neither half of that is legible at three thousand.
 *
 * SEEDED, so the demo a visitor sees is the demo a test asserts about, and so
 * two visitors comparing notes are talking about the same picture.
 *
 * The stages are named because a layered DAG of anonymous boxes is a texture.
 * A visitor who reads "compile" and sees three boxes appear in the compile
 * column knows what grew, which is the difference between an animation and a
 * demonstration.
 */

import { Graph } from '@dagr/graph';
import type { Node, NodeId } from '@dagr/graph';
import type { LayoutConfig } from '@dagr/layout';

/**
 * The config the demo lays this graph out with, which is the defaults.
 *
 * A named empty object rather than nothing, because `test/lap.test.ts` pins
 * properties of the LAID OUT drawing (its width, that no edit enlarges it) and
 * those properties are true of the default separations and not of every config.
 * A component passing one config and a test measuring another would be a test
 * that silently stopped covering the thing it is for, so both read this.
 */
export const LIVING_LAYOUT_CONFIG: LayoutConfig = Object.freeze({});

/** The columns, in pipeline order. A node's stage is its rank by construction. */
export const STAGES = ['fetch', 'parse', 'resolve', 'compile', 'bundle', 'ship'] as const;

/** One of {@link STAGES}. */
export type Stage = (typeof STAGES)[number];

/**
 * The seed the demo pins.
 *
 * Any 32-bit value would do and this one is arbitrary. What matters is that it
 * is a constant: every test in this package and every visitor to the site is
 * looking at the same graph.
 */
export const LIVING_SEED = 0x5ca1ab1e;

/**
 * How many nodes each stage starts with, and the widest entry is load-bearing.
 *
 * A LAYERED DRAWING IS AS WIDE AS ITS WIDEST LAYER, so `compile` at nine is
 * what sets the width of the picture, and it is nine so that a grow can add
 * three nodes to a six-wide column WITHOUT the drawing getting any wider. That
 * is how this demo keeps the promise the camera decision makes it: the fit
 * happens once and never again, so the graph is built such that nothing the
 * edit script does can walk out of the frame the first fit chose. The relayout
 * verb adds no rank for the same reason, and `test/bounds.test.ts` pins the
 * whole lap against the base bounds rather than trusting this comment.
 *
 * Fixed rather than seeded, and only the wiring is seeded. A seeded width is a
 * width that can come out wider than the widest, which would make the property
 * above depend on the seed being lucky.
 */
export const STAGE_WIDTHS: Readonly<Record<Stage, number>> = {
  fetch: 2,
  parse: 6,
  resolve: 6,
  compile: 9,
  bundle: 6,
  ship: 3,
};

/** The width of the widest column, which is the width of the whole drawing. */
export const WIDEST_STAGE = Math.max(...Object.values(STAGE_WIDTHS));

/**
 * How often a node gets a second parent, on top of the one every node is
 * guaranteed. Enough to give the router crossings to resolve and the ordering
 * stage something to do, and not so many that the drawing is a mesh.
 */
const SECOND_PARENT_CHANCE = 0.45;

/** What {@link createLivingGraph} takes. */
export interface LivingGraphOptions {
  /** Defaults to {@link LIVING_SEED}. A test varying it is varying the picture. */
  readonly seed?: number | undefined;
}

/**
 * `mulberry32`: thirty-two bits of state, uniform enough for choosing a parent.
 *
 * Written out rather than depended on. This package needs one reproducible
 * stream of numbers and `Math.random` is the one thing it cannot use, since a
 * demo that differs per load is not one a test can pin.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The id an edge between these two nodes always has. */
export function edgeIdFor(source: NodeId, target: NodeId): string {
  return `${source}->${target}`;
}

/**
 * The stage a node belongs to, or `undefined` for one that names no stage.
 *
 * Read off the attribute bag rather than parsed out of the id, because the id
 * is an identifier and the stage is data: a node's colour should not depend on
 * how its id happens to be spelled. `Attrs` is `Record<string, unknown>`, so
 * the guard is the price of reading one back, and it is the same guard any
 * consumer of an untyped bag writes.
 */
export function stageOf(node: Node): Stage | undefined {
  const stage = node.attrs['stage'];
  return typeof stage === 'string' && (STAGES as readonly string[]).includes(stage)
    ? (stage as Stage)
    : undefined;
}

/** Adds the edge unless it is already there, so a second parent cannot double up. */
function connect(graph: Graph, source: NodeId, target: NodeId): void {
  const id = edgeIdFor(source, target);
  if (graph.hasEdge(id)) return;
  graph.addEdge({ id, source, target });
}

/**
 * Wires one layer to the one before it.
 *
 * Three passes, in this order, and the order is the point. Every parent feeds
 * something, so no stage ends in a dead end; every child is fed by something,
 * so no stage begins from nowhere; and then some children get a second parent,
 * which is what gives the ordering stage crossings to resolve. Doing the
 * coverage passes first is what makes the third one free to be random: it can
 * add nothing and the graph is still connected.
 */
function connectLayer(
  graph: Graph,
  parents: readonly NodeId[],
  children: readonly NodeId[],
  random: () => number,
): void {
  const pick = (): NodeId => parents[Math.floor(random() * parents.length)] ?? parents[0] ?? '';

  for (const [index, parent] of parents.entries()) {
    const child = children[index % children.length];
    if (child !== undefined) connect(graph, parent, child);
  }
  for (const child of children) {
    if (graph.inDegree(child) === 0) connect(graph, pick(), child);
  }
  for (const child of children) {
    if (random() >= SECOND_PARENT_CHANCE) continue;
    connect(graph, pick(), child);
  }
}

/** A seeded build pipeline: six named stages, about thirty nodes, acyclic. */
export function createLivingGraph(options: LivingGraphOptions = {}): Graph {
  const random = seeded(options.seed ?? LIVING_SEED);
  const graph = new Graph();

  const layers: NodeId[][] = [];
  for (const stage of STAGES) {
    const layer: NodeId[] = [];
    for (let index = 0; index < STAGE_WIDTHS[stage]; index += 1) {
      const id = `${stage}-${String(index)}`;
      graph.addNode({ id, attrs: { stage } });
      layer.push(id);
    }
    layers.push(layer);
  }

  for (let rank = 1; rank < layers.length; rank += 1) {
    const parents = layers[rank - 1];
    const children = layers[rank];
    if (parents === undefined || children === undefined) continue;
    connectLayer(graph, parents, children, random);
  }

  return graph;
}
