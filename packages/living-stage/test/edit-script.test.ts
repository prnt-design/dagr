import { describe, expect, it } from 'vitest';
import type { Graph, Patch } from '@dagr/graph';
import {
  AUTOPLAY_CYCLE,
  EDIT_KINDS,
  INITIAL_SCRIPT_STATE,
  applyStep,
  createEditScript,
  takeStep,
} from '../src/edit-script.js';
import type { EditKind, EditScript, ScriptState } from '../src/edit-script.js';
import { createLivingGraph } from '../src/living-graph.js';

/**
 * Everything the graph holds, as two sorted lists of strings.
 *
 * Ids alone are not enough for the edges: the relayout verb rebinds an edge to
 * new endpoints under the SAME id, so a census that compared ids would call the
 * rewired graph identical to the one before it, and the cycle test below would
 * pass whether or not the script ever undid the rewire.
 */
function census(graph: Graph): { readonly nodes: string[]; readonly edges: string[] } {
  return {
    nodes: graph
      .nodes()
      .map((node) => node.id)
      .sort(),
    edges: graph
      .edges()
      .map((edge) => `${edge.id}:${edge.source}->${edge.target}`)
      .sort(),
  };
}

/**
 * Walks `kinds` from the initial state, applying each to `graph` as it goes.
 *
 * The script is a parameter rather than derived here, because a script is
 * derived from the graph as it STANDS: deriving one from a half-grown graph
 * would pick different nodes, and a test that did that would be walking a
 * different script from the one it went on to assert about.
 */
function walk(
  graph: Graph,
  script: EditScript,
  kinds: readonly EditKind[],
  onStep?: (kind: EditKind) => void,
): ScriptState {
  let state = INITIAL_SCRIPT_STATE;
  for (const kind of kinds) {
    const taken = takeStep(script, state, kind);
    if (taken === null) throw new Error(`the script refused ${kind} at ${JSON.stringify(state)}`);
    applyStep(graph, taken.step);
    state = taken.next;
    onStep?.(kind);
  }
  return state;
}

describe('the edit script', () => {
  it('emits exactly one patch per step, because an unbatched step is a cut rather than a glide', () => {
    // THE SINGLE MOST LOAD-BEARING TEST IN THIS PACKAGE. A step that mutates
    // the graph three times outside `graph.batch` is three patches, three
    // relayouts and ONE React commit holding the last, so <DagrCanvas> fails
    // its own continuity check and reseats rather than gliding. The drawing is
    // right either way, which is exactly why nothing else would catch it: the
    // demo would silently stop demonstrating the feature it exists for.
    const graph = createLivingGraph();
    const patches: Patch[] = [];
    graph.subscribe((patch) => patches.push(patch));

    walk(graph, createEditScript(graph), AUTOPLAY_CYCLE, (kind) => {
      expect(patches, `step ${kind}`).toHaveLength(1);
      patches.length = 0;
    });
  });

  it('changes something on every step, so no button is a no-op', () => {
    // A step whose ops all cancel emits NO patch, which the count above reads
    // as a failure; a step that emits one patch which changes nothing a layout
    // could see is the case this catches instead.
    const graph = createLivingGraph();
    const script = createEditScript(graph);
    let state = INITIAL_SCRIPT_STATE;

    for (const kind of AUTOPLAY_CYCLE) {
      const before = census(graph);
      const taken = takeStep(script, state, kind);
      expect(taken, `the cycle offered ${kind} and the script refused it`).not.toBeNull();
      if (taken === null) return;
      applyStep(graph, taken.step);
      state = taken.next;
      expect(census(graph), `step ${kind}`).not.toEqual(before);
    }
  });

  it('returns the graph to what it started with, so the one camera fit stays valid forever', () => {
    // The camera fits once and never refits, by a decision taken in M5.1 and
    // upheld in M4.7c and M5.3a. A script that grew without bound would walk
    // out of that first frame, and the honest answers are to bound the growth
    // or to make the visitor refit. This bounds the growth: one full cycle is
    // the identity, so the demo can autoplay forever inside the frame it was
    // fitted to.
    const graph = createLivingGraph();
    const before = census(graph);

    const state = walk(graph, createEditScript(graph), AUTOPLAY_CYCLE);

    expect(census(graph)).toEqual(before);
    expect(state.live).toEqual([]);
    expect(state.linked).toBe(false);
  });

  it('is back at the top of the cycle after one lap, so a second lap repeats the first', () => {
    const graph = createLivingGraph();
    const afterOne = walk(graph, createEditScript(graph), AUTOPLAY_CYCLE);
    expect(afterOne.cursor).toBe(INITIAL_SCRIPT_STATE.cursor);
  });

  it('runs every verb during one lap, because the demo names three', () => {
    expect([...new Set(AUTOPLAY_CYCLE)].sort()).toEqual([...EDIT_KINDS].sort());
  });

  it('never makes a cycle, so the picture stays a pipeline at every step', () => {
    // The relayout verb rebinds an edge, and an edge rebound to point backwards
    // is a cycle the layout breaks by reversing it, which draws an arrow the
    // wrong way round for no reason a visitor could guess at.
    const graph = createLivingGraph();
    expect(graph.isAcyclic()).toBe(true);

    walk(graph, createEditScript(graph), AUTOPLAY_CYCLE, () => {
      expect(graph.isAcyclic()).toBe(true);
    });
  });

  it('is the same script every time, because a demo that differs per load is not one a test can pin', () => {
    expect(createEditScript(createLivingGraph())).toEqual(createEditScript(createLivingGraph()));
  });

  it('refuses a prune with nothing grown, which is what greys the button out', () => {
    // `takeStep` returning null IS the disabled state: the component asks it
    // rather than keeping a second copy of these rules, so a button that is
    // enabled and a step that throws cannot disagree.
    const script = createEditScript(createLivingGraph());
    expect(takeStep(script, INITIAL_SCRIPT_STATE, 'prune')).toBeNull();
    expect(takeStep(script, INITIAL_SCRIPT_STATE, 'grow')).not.toBeNull();
    expect(takeStep(script, INITIAL_SCRIPT_STATE, 'relayout')).not.toBeNull();
  });

  it('refuses a grow once everything it knows how to grow is grown', () => {
    const graph = createLivingGraph();
    const script = createEditScript(graph);
    let state = INITIAL_SCRIPT_STATE;

    for (let taken = takeStep(script, state, 'grow'); taken !== null; ) {
      applyStep(graph, taken.step);
      state = taken.next;
      taken = takeStep(script, state, 'grow');
    }

    expect(state.live.length).toBe(script.clusters.length);
    expect(takeStep(script, state, 'grow')).toBeNull();
    expect(takeStep(script, state, 'prune')).not.toBeNull();
  });

  it('applies whatever it offers, for every reachable state, so no enabled button throws', () => {
    // Exhaustive rather than illustrative: three verbs over the states one lap
    // passes through, each tried against a fresh graph walked to that state.
    // A rule that `takeStep` gets right and `applyStep` does not is the shape
    // of bug a happy-path walk cannot see.
    for (let prefix = 0; prefix <= AUTOPLAY_CYCLE.length; prefix += 1) {
      for (const kind of EDIT_KINDS) {
        const graph = createLivingGraph();
        const script = createEditScript(graph);
        const state = walk(graph, script, AUTOPLAY_CYCLE.slice(0, prefix));
        const taken = takeStep(script, state, kind);
        if (taken === null) continue;
        expect(() => {
          applyStep(graph, taken.step);
        }, `${kind} after ${String(prefix)} steps`).not.toThrow();
      }
    }
  });
});
