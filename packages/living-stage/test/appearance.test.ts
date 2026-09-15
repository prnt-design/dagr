import { describe, expect, it } from 'vitest';
import { createLayout } from '@dagr/layout';
import { HIGHLIGHT_GLOW, livingAppearance, stageColor, touchedBy } from '../src/appearance.js';
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
