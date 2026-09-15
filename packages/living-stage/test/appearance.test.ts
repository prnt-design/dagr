import { describe, expect, it } from 'vitest';
import { createLayout } from '@dagr/layout';
import {
  CLEAR_COLOR,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_GLOW,
  livingAppearance,
  stageColor,
  touchedBy,
} from '../src/appearance.js';
import { AUTOPLAY_CYCLE, applyStep, createEditScript, takeStep } from '../src/edit-script.js';
import { INITIAL_SCRIPT_STATE } from '../src/edit-script.js';
import { STAGES, createLivingGraph } from '../src/living-graph.js';

describe('what the drawing looks like', () => {
  it('gives every stage its own colour, so the pipeline reads left to right', () => {
    const colors = STAGES.map((stage) => stageColor(stage));
    expect(new Set(colors).size).toBe(STAGES.length);
  });

  it('highlights exactly the nodes the delta names as added or moved', () => {
    const graph = createLivingGraph();
    const script = createEditScript(graph);
    const engine = createLayout();
    engine.run(graph);

    let touched = new Set<string>();
    const unsubscribe = graph.subscribe((patch) => {
      touched = touchedBy(engine.relayout(patch).delta);
    });
    const grow = takeStep(script, INITIAL_SCRIPT_STATE, 'grow');
    expect(grow).not.toBeNull();
    if (grow === null) return;
    applyStep(graph, grow.step);
    unsubscribe();

    // Three added and six moved, which is what `lap.test.ts` measures.
    expect(touched.size).toBe(9);
    for (const node of grow.step.kind === 'grow' ? grow.step.nodes : []) {
      expect(touched.has(node.id), `${node.id} was added and is not highlighted`).toBe(true);
    }
  });

  it('does not highlight a node that went away, because it is not there to highlight', () => {
    // `removed` names ids of the PREVIOUS result. Putting them in the set would
    // be harmless today, since nothing looks them up, and wrong the moment a
    // node is removed and grown again under the same id: it would arrive
    // already lit, from an edit that was about its predecessor.
    const graph = createLivingGraph();
    const script = createEditScript(graph);
    const engine = createLayout();
    engine.run(graph);

    let touched = new Set<string>();
    const unsubscribe = graph.subscribe((patch) => {
      touched = touchedBy(engine.relayout(patch).delta);
    });
    let state = INITIAL_SCRIPT_STATE;
    let pruned: readonly string[] = [];
    for (const kind of AUTOPLAY_CYCLE) {
      const taken = takeStep(script, state, kind);
      if (taken === null) throw new Error(`the script refused ${kind}`);
      applyStep(graph, taken.step);
      state = taken.next;
      if (taken.step.kind === 'prune') {
        pruned = taken.step.nodes;
        break;
      }
    }
    unsubscribe();

    expect(pruned.length).toBe(3);
    for (const id of pruned) {
      expect(touched.has(id), `${id} was removed and is highlighted`).toBe(false);
    }
  });

  it('puts a halo on a touched node and none on one that stayed put', () => {
    const appearance = livingAppearance(new Set(['parse-0']), (id) =>
      id.startsWith('parse') ? 'parse' : 'ship',
    );
    expect(appearance('parse-0')?.glowWorld).toBe(HIGHLIGHT_GLOW);
    expect(appearance('parse-1')?.glowWorld).toBe(0);
  });

  it('colours a node by its stage whether or not it is highlighted', () => {
    const appearance = livingAppearance(new Set(['parse-0']), () => 'parse');
    expect(appearance('parse-0')?.fillColor).toBe(stageColor('parse'));
    expect(appearance('parse-1')?.fillColor).toBe(stageColor('parse'));
  });

  it('falls back rather than throwing for a node that names no stage', () => {
    const appearance = livingAppearance(new Set(), () => undefined);
    expect(appearance('mystery')).toBeDefined();
  });
});

/**
 * Relative luminance, per WCAG 2.x.
 *
 * Written out rather than depended on: it is six lines, and a colour contrast
 * package would be a production dependency for a private demo's test.
 */
function luminance(color: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((color >> 16) & 255) +
    0.7152 * channel((color >> 8) & 255) +
    0.0722 * channel(color & 255)
  );
}

/** The WCAG contrast ratio between two colours, lighter over darker. */
function contrast(a: number, b: number): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe('the palette is legible', () => {
  it('clears 3:1 against the background at every stop, which is WCAG 1.4.11', () => {
    // THE DEMO'S ARGUMENT IS COUNTING THE UNLIT NODES, so an unlit node has to
    // be visible. The first ramp ran from 1.90:1, with `parse` (one of the two
    // columns a grow lands in) at 2.78:1.
    for (const stage of STAGES) {
      const ratio = contrast(stageColor(stage), CLEAR_COLOR);
      expect(ratio, `${stage} is ${ratio.toFixed(2)}:1 against the background`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps adjacent stops far enough apart to read as a sequence', () => {
    // Legible one at a time is not the same as tellable apart in a row, and a
    // six-step ramp a reader cannot order is not saying what a ramp says.
    for (let index = 1; index < STAGES.length; index += 1) {
      const previous = STAGES[index - 1];
      const stage = STAGES[index];
      if (previous === undefined || stage === undefined) continue;
      const step = contrast(stageColor(stage), stageColor(previous));
      expect(step, `${previous} to ${stage} is only ${step.toFixed(2)}:1`).toBeGreaterThan(1.2);
    }
  });

  it('puts the halo well clear of the background it glows against', () => {
    expect(contrast(HIGHLIGHT_COLOR, CLEAR_COLOR)).toBeGreaterThanOrEqual(3);
  });
});
