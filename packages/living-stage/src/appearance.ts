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

/**
 * The ramp, in stage order, dark to light.
 *
 * EVERY STOP CLEARS 3:1 AGAINST {@link CLEAR_COLOR}, which is WCAG 1.4.11's
 * minimum for a graphical object, and the dark end of this ramp did not: the
 * first version ran from `#2f4858` at 1.90:1, with `parse` at 2.78:1. That is
 * not a box a visitor is asked to read, it is a box they are asked to COUNT,
 * and the demo's entire argument is counting the unlit ones. `parse` is also
 * one of the two columns a grow lands in, so the three boxes the demo asks
 * you to watch appear were arriving in the second-murkiest column on the page.
 *
 * Measured against `#11161b`: 3.22, 4.21, 5.46, 7.19, 9.56, 12.66. Adjacent
 * stops stay about 1.31:1 apart, which is what keeps six of them tellable
 * apart as a sequence rather than merely legible one at a time.
 */
const STAGE_COLORS: Readonly<Record<Stage, number>> = {
  fetch: 0x3d6d83,
  parse: 0x3f8299,
  resolve: 0x3f98ad,
  compile: 0x4fb0c0,
  bundle: 0x74c9d3,
  ship: 0xa6e2e4,
};

/**
 * A node whose stage nothing recorded. Grey, so it cannot be read as a stage.
 *
 * Grey and LIGHT ENOUGH: at `#555b66` it was 2.66:1 against the background,
 * which failed the same rule the ramp did, and an unrecognised node is exactly
 * the one a reader most needs to be able to see.
 */
const UNKNOWN_COLOR = 0x6b7280;

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
