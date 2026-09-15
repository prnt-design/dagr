import { describe, expect, it } from 'vitest';
import type { Graph, Patch } from '@dagr/graph';
import {
  AUTOPLAY_CYCLE,
  EDIT_KINDS,
  INITIAL_SCRIPT_STATE,
  applyStep,
  createEditScript,
  takeAutoStep,
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

/**
 * Every field of {@link ScriptState}, so a new one cannot be forgotten below.
 *
 * The same guard `use-dagr.ts` puts on `LayoutConfig`, against the same failure
 * in a different costume: a field added and not put in `key` would make two
 * distinct states collide, the sweep would silently cover fewer of them, and
 * the count pinned at the end could stay 52 while the coverage shrank. The
 * declaration fails to compile the day `ScriptState` grows a field.
 */
type KeyedField = 'live' | 'linked' | 'cursor';
type UnkeyedField = Exclude<keyof ScriptState, KeyedField>;
// Fails with "Type 'true' is not assignable to type 'never'" naming the field.
const everyScriptStateFieldIsKeyed: [UnkeyedField] extends [never] ? true : never = true;
void everyScriptStateFieldIsKeyed;

/** A state as a string, so a sweep can tell two of them apart. */
function key(state: ScriptState): string {
  return `${state.live.join('.')}|${String(state.linked)}|${String(state.cursor)}`;
}

/** Every state reachable by pressing buttons in any order. */
function everyReachableState(script: EditScript): ScriptState[] {
  const seen = new Map<string, ScriptState>([[key(INITIAL_SCRIPT_STATE), INITIAL_SCRIPT_STATE]]);
  const queue: ScriptState[] = [INITIAL_SCRIPT_STATE];
  while (queue.length > 0) {
    const state = queue.shift();
    if (state === undefined) break;
    for (const kind of EDIT_KINDS) {
      const taken = takeStep(script, state, kind);
      if (taken === null || seen.has(key(taken.next))) continue;
      seen.set(key(taken.next), taken.next);
      queue.push(taken.next);
    }
  }
  return [...seen.values()];
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

  it('applies whatever it offers, from every reachable state, so no enabled button throws', () => {
    // A BREADTH-FIRST SWEEP OF THE WHOLE STATE SPACE, and the previous version
    // of this test claimed that and walked one path: the prefixes of
    // AUTOPLAY_CYCLE, which is 6 distinct states (the empty prefix and the
    // whole lap are the same one) of the 52 a visitor can reach by pressing
    // buttons in any order. A rule `takeStep` gets right and
    // `applyStep` does not is the shape of bug a happy-path walk cannot see,
    // and the state that actually mattered (both clusters grown, cursor left
    // mid-cycle) is not on that path at all.
    const reached = new Map<string, readonly EditKind[]>([[key(INITIAL_SCRIPT_STATE), []]]);
    const queue: ScriptState[] = [INITIAL_SCRIPT_STATE];

    while (queue.length > 0) {
      const state = queue.shift();
      if (state === undefined) break;
      const path = reached.get(key(state)) ?? [];
      for (const kind of EDIT_KINDS) {
        // A fresh graph walked to this state, so the step is applied to the
        // graph it was planned against rather than to a shared one.
        const graph = createLivingGraph();
        const script = createEditScript(graph);
        walk(graph, script, path);
        const taken = takeStep(script, state, kind);
        if (taken === null) continue;
        expect(() => {
          applyStep(graph, taken.step);
        }, `${kind} after [${path.join(', ')}]`).not.toThrow();
        if (reached.has(key(taken.next))) continue;
        reached.set(key(taken.next), [...path, kind]);
        queue.push(taken.next);
      }
    }

    // Pinned, so a change to the state machine that collapses or explodes the
    // space is a failure here rather than a silently narrower sweep.
    expect(reached.size).toBe(52);
  });

  it('never leaves autoplay with nothing to do, from any state a visitor can reach', () => {
    // THE BUG THIS WAS WRITTEN FOR. `nextCursor` only advances when the pressed
    // verb is the one the lap was up to, so pressing grow twice leaves the
    // cursor at `relayout` with both clusters already grown. Autoplay then took
    // the relayout, advanced to `grow`, found `takeStep` refusing it, and
    // returned null: the effect scheduled nothing more and the demo stopped
    // dead while the button still said "pause". Six of the 52 states stalled.
    //
    // `takeAutoStep` skipping forward is the fix, and this is the assertion
    // that would have caught it. It fails on every one of those six states if
    // the skip is reverted.
    const script = createEditScript(createLivingGraph());
    for (const state of everyReachableState(script)) {
      expect(takeAutoStep(script, state), `autoplay stalled at ${key(state)}`).not.toBeNull();
    }
  });

  it('keeps autoplaying forever from a state a visitor pressed it into', () => {
    // The stall's own shortest path, followed by enough ticks to be sure it is
    // not merely deferred: two grows leave the cursor mid-lap with nothing left
    // to grow.
    const graph = createLivingGraph();
    const script = createEditScript(graph);
    let state = walk(graph, script, ['grow', 'grow']);

    for (let tick = 0; tick < 3 * AUTOPLAY_CYCLE.length; tick += 1) {
      const taken = takeAutoStep(script, state);
      expect(taken, `autoplay stalled on tick ${String(tick)} at ${key(state)}`).not.toBeNull();
      if (taken === null) return;
      applyStep(graph, taken.step);
      state = taken.next;
    }
  });
});
