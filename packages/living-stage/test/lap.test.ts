/**
 * What the engine actually says about one lap of the edit script.
 *
 * THIS IS THE FILE THAT KEEPS THE DEMO HONEST, and the two properties it pins
 * are the two the demo's whole argument rests on.
 *
 * The first is that every edit moves a SMALL part of the drawing. That is the
 * claim, it is the reason this task exists, and it is not something the script
 * can be reasoned into: two earlier shapes of the relayout verb were written,
 * looked right, and turned out to move 25 of 25 nodes and 0 of 32 respectively.
 * Neither would have failed any test in `edit-script.test.ts`, because both
 * were structurally valid edits. Only laying the graph out finds it.
 *
 * The second is that the drawing never gets bigger, which is what earns the
 * one-and-only camera fit. `<DagrCanvas>` fits once and never refits, because a
 * camera that chases every edit hides the stability it exists to reveal. A demo
 * that grew out of its own frame would have to break that rule or clip; this
 * one cannot grow, and here is where that stops being an intention.
 */

import { describe, expect, it } from 'vitest';
import { createLayout } from '@dagr/layout';
import type { LayoutDelta, LayoutResult } from '@dagr/layout';
import {
  AUTOPLAY_CYCLE,
  INITIAL_SCRIPT_STATE,
  applyStep,
  createEditScript,
  takeStep,
} from '../src/edit-script.js';
import type { EditKind } from '../src/edit-script.js';
import { LIVING_LAYOUT_CONFIG, createLivingGraph } from '../src/living-graph.js';

/** One edit, as the engine reported it. */
interface Landed {
  readonly kind: EditKind;
  readonly label: string;
  readonly result: LayoutResult;
  readonly delta: LayoutDelta;
}

/** The base layout, and what the engine said about each step of one lap. */
function runLap(): { readonly base: LayoutResult; readonly landed: Landed[] } {
  const graph = createLivingGraph();
  const script = createEditScript(graph);
  // The same config the component passes, so this measures the drawing the
  // demo actually shows. See LIVING_LAYOUT_CONFIG.
  const engine = createLayout({ config: LIVING_LAYOUT_CONFIG });
  const base = engine.run(graph);

  const landed: Landed[] = [];
  let pending: { kind: EditKind; label: string } | null = null;
  const unsubscribe = graph.subscribe((patch) => {
    const relaid = engine.relayout(patch);
    if (pending === null) throw new Error('the graph emitted a patch outside a step');
    landed.push({ ...pending, result: relaid.result, delta: relaid.delta });
  });

  let state = INITIAL_SCRIPT_STATE;
  for (const kind of AUTOPLAY_CYCLE) {
    const taken = takeStep(script, state, kind);
    if (taken === null) throw new Error(`the script refused ${kind}`);
    pending = { kind, label: taken.step.label };
    applyStep(graph, taken.step);
    pending = null;
    state = taken.next;
  }
  unsubscribe();
  return { base, landed };
}

/** How many nodes the result holds that this delta did not touch. */
function stayedPut(landed: Landed): number {
  return landed.result.nodes.size - landed.delta.nodes.moved.length - landed.delta.nodes.added.length;
}

describe('one lap, through the layout engine', () => {
  it('starts from a drawing worth animating: 32 nodes over six ranks', () => {
    const { base } = runLap();
    expect(base.nodes.size).toBe(32);
    expect(base.bounds).toEqual({ x: -650, y: 0, width: 1300, height: 490 });
  });

  it('takes six edits and reports one delta for each, because each is one batch', () => {
    const { landed } = runLap();
    expect(landed.map((one) => one.kind)).toEqual([...AUTOPLAY_CYCLE]);
  });

  it('leaves most of the drawing exactly where it was, on every single edit', () => {
    // THE CLAIM, AS A NUMBER. Two thirds is a deliberately loose floor: the
    // measured worst case over this lap is 26 of 35, and a floor at the
    // measured value would fail on any change to the graph rather than on a
    // change to the property. What this refuses is an edit that moves most of
    // the drawing, which is the failure both earlier relayout verbs had.
    const { landed } = runLap();
    for (const one of landed) {
      expect(
        stayedPut(one) / one.result.nodes.size,
        `${one.kind}: ${String(stayedPut(one))} of ${String(one.result.nodes.size)} stayed put`,
      ).toBeGreaterThan(2 / 3);
    }
  });

  it('moves something on every single edit, so no verb is a no-op a visitor reads as broken', () => {
    // The other half of the one above, and the half the same-stage rebind
    // failed: it was structurally a valid edit, it passed every test in
    // `edit-script.test.ts`, and it moved nothing at all in any of the 200
    // places it could have been applied.
    const { landed } = runLap();
    for (const one of landed) {
      const touched =
        one.delta.nodes.moved.length +
        one.delta.nodes.added.length +
        one.delta.nodes.removed.length;
      expect(touched, `${one.kind} (${one.label}) changed no node`).toBeGreaterThan(0);
      expect(one.delta.edges.rerouted.length, `${one.kind} rerouted nothing`).toBeGreaterThan(0);
    }
  });

  it('adds and removes nothing on a relayout, which is what makes it the honest verb', () => {
    const { landed } = runLap();
    const relayouts = landed.filter((one) => one.kind === 'relayout');
    expect(relayouts).toHaveLength(2);
    for (const one of relayouts) {
      expect(one.delta.nodes.added).toEqual([]);
      expect(one.delta.nodes.removed).toEqual([]);
      expect(one.delta.nodes.moved.length).toBeGreaterThan(0);
    }
  });

  it('adds and removes exactly three nodes on a grow and a prune', () => {
    const { landed } = runLap();
    for (const one of landed.filter((step) => step.kind === 'grow')) {
      expect(one.delta.nodes.added).toHaveLength(3);
      expect(one.delta.nodes.removed).toEqual([]);
    }
    for (const one of landed.filter((step) => step.kind === 'prune')) {
      expect(one.delta.nodes.removed).toHaveLength(3);
      expect(one.delta.nodes.added).toEqual([]);
    }
  });

  it('never draws outside the box the first frame was fitted to', () => {
    // THE CAMERA RULE, PINNED. The fit happens on `base.bounds` and never
    // again, so a lap that drew one pixel outside it would be a lap the visitor
    // sees clipped, and the fix for that would be the automatic refit this
    // whole demo exists to avoid. Equality rather than containment, because the
    // graph is built so the widest column cannot be widened and no edit adds a
    // rank: anything else is a change worth being told about.
    const { base, landed } = runLap();
    for (const one of landed) {
      expect(one.result.bounds, `${one.kind}: ${one.label}`).toEqual(base.bounds);
    }
  });

  it('ends on the drawing it began with, so a second lap repeats the first', () => {
    const { base, landed } = runLap();
    const last = landed.at(-1);
    expect(last).toBeDefined();
    if (last === undefined) return;
    expect(last.result.nodes.size).toBe(base.nodes.size);
    for (const [id, node] of base.nodes) {
      expect(last.result.nodes.get(id), `${id} did not come home`).toEqual(node);
    }
  });
});
