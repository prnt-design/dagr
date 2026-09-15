/**
 * What the living graph looks like: a colour per stage, and a halo on whatever
 * the last edit touched.
 *
 * THE HALO IS THE OTHER HALF OF THE READOUT. "6 moved, 29 stayed put" is a
 * claim; six lit nodes beside twenty-nine unlit ones is the evidence for it, on
 * the same screen, requiring no trust. It is also what makes the number
 * checkable by a visitor who does not believe it: they can count.
 *
 * It persists until the NEXT edit rather than fading on a timer. A halo on a
 * timer would be a second animation competing with the one the page is about,
 * and it would mean the picture and the readout disagree for as long as the
 * readout outlived it.
 *
 * A SEQUENTIAL RAMP, because a stage is an ordered thing. The six stages are a
 * pipeline from first to last, so the palette runs one way along one hue rather
 * than picking six unrelated colours: a reader can see which end is the start
 * without reading anything.
 */

import type { NodeAppearance, NodeAppearanceOf } from '@dagr/react';
import { STAGES } from './living-graph.js';
import type { Stage } from './living-graph.js';

/** The ramp, in stage order, dark to light. */
const STAGE_COLORS: Readonly<Record<Stage, number>> = {
  fetch: 0x2f4858,
  parse: 0x33637a,
  resolve: 0x33809a,
  compile: 0x2e9eb5,
  bundle: 0x4ebdc4,
  ship: 0x86d9cf,
};

/** A node whose stage nothing recorded. Grey, so it cannot be read as a stage. */
const UNKNOWN_COLOR = 0x555b66;

/** The halo colour: warm, so a touched node reads against the cool ramp. */
export const HIGHLIGHT_COLOR = 0xffb454;

/** How far the halo reaches, in world units. A node is 100 by 40. */
export const HIGHLIGHT_GLOW = 9;

/** The colour of `stage` on the canvas. */
export function stageColor(stage: Stage): number {
  return STAGE_COLORS[stage];
}

/** The background the ramp above was chosen against. */
export const CLEAR_COLOR = 0x11161b;

/** What a node in the drawing now is, for a caller that has a stage for it. */
export type StageOfId = (id: string) => Stage | undefined;

/**
 * The ids a delta names as being in the drawing now and changed by this edit.
 *
 * `added` and `moved` and NOT `removed`. A removed id is not in the result
 * being drawn, so highlighting it would light nothing today; it would light the
 * wrong thing the moment a node is pruned and grown again under the same id,
 * which this demo does on every lap.
 */
export function touchedBy(delta: {
  readonly nodes: {
    readonly added: readonly { readonly id: string }[];
    readonly moved: readonly { readonly id: string }[];
  };
}): Set<string> {
  const touched = new Set<string>();
  for (const node of delta.nodes.added) touched.add(node.id);
  for (const node of delta.nodes.moved) touched.add(node.id);
  return touched;
}

/**
 * The appearance callback for a drawing whose last edit touched `touched`.
 *
 * MEMOISE THE RESULT. `<DagrCanvas>` compares `nodeAppearance` by identity, on
 * the argument that a new callback means a new picture and there is no way to
 * tell one from an identical one an unlucky render re-created. A new one per
 * render would rebuild the scene array every time this component re-renders,
 * which it does on every frame of nothing in particular.
 */
export function livingAppearance(
  touched: ReadonlySet<string>,
  stageOfId: StageOfId,
): NodeAppearanceOf {
  return (id: string): NodeAppearance => {
    const stage = stageOfId(id);
    const lit = touched.has(id);
    return {
      shape: 'roundedRect',
      cornerRadius: 6,
      fillColor: stage === undefined ? UNKNOWN_COLOR : stageColor(stage),
      glowColor: HIGHLIGHT_COLOR,
      // Zero rather than an absent field: `DEFAULT_NODE_APPEARANCE` fills a
      // missing one per field, so leaving it out would mean "the default",
      // which is the same zero today and is not the thing being said.
      glowWorld: lit ? HIGHLIGHT_GLOW : 0,
    };
  };
}

/** Every stage, for a caller building a legend. */
export const STAGE_LEGEND: readonly { readonly stage: Stage; readonly color: number }[] =
  STAGES.map((stage) => ({ stage, color: stageColor(stage) }));
