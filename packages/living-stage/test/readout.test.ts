import { describe, expect, it } from 'vitest';
import { createLayout } from '@dagr/layout';
import type { LayoutDelta, LayoutResult, PositionedNode, RoutedEdge } from '@dagr/layout';
import { readEdit } from '../src/readout.js';
import type { CountedReadout, Readout } from '../src/readout.js';
import { createLivingGraph } from '../src/living-graph.js';

/** A result with `nodes` nodes and `edges` edges, and nothing else true about it. */
function result(nodes: number, edges = 0): LayoutResult {
  const node = (index: number): [string, PositionedNode] => [
    `n${String(index)}`,
    { id: `n${String(index)}`, x: 0, y: 0, width: 10, height: 10 },
  ];
  const edge = (index: number): [string, RoutedEdge] => [
    `e${String(index)}`,
    { id: `e${String(index)}`, source: 'n0', target: 'n0', points: [] },
  ];
  return {
    nodes: new Map(Array.from({ length: nodes }, (_, index) => node(index))),
    edges: new Map(Array.from({ length: edges }, (_, index) => edge(index))),
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  };
}

/** A delta that says only how many of each thing happened. */
function delta(counts: {
  added?: number;
  removed?: number;
  moved?: number;
  rerouted?: number;
}): LayoutDelta {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  return {
    nodes: {
      added: Array.from({ length: counts.added ?? 0 }, (_, index) => ({
        id: `a${String(index)}`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      })),
      removed: Array.from({ length: counts.removed ?? 0 }, (_, index) => `r${String(index)}`),
      moved: Array.from({ length: counts.moved ?? 0 }, (_, index) => ({
        id: `m${String(index)}`,
        from: box,
        to: box,
      })),
    },
    edges: {
      added: [],
      removed: [],
      rerouted: Array.from({ length: counts.rerouted ?? 0 }, (_, index) => ({
        id: `x${String(index)}`,
        from: [],
        to: [],
      })),
    },
    bounds: undefined,
  };
}

/** Asserts `readout` counted something, and narrows it so the counts can be read. */
function counted(readout: Readout): CountedReadout {
  expect(readout.kind).toBe('counted');
  if (readout.kind !== 'counted') throw new Error(`readout was ${readout.kind}`);
  return readout;
}

describe('the readout', () => {
  it('says nothing was compared for the first layout, because a cold run is not a difference', () => {
    const first = result(32, 47);
    const readout = readEdit(first, null, null, null);
    expect(readout.kind).toBe('initial');
    expect(readout.nodes).toBe(32);
    expect(readout.edges).toBe(47);
  });

  it('counts what an edit moved, and what it left alone', () => {
    const drawn = result(35, 53);
    const next = result(38, 60);
    const readout = readEdit(next, delta({ added: 3, moved: 6, rerouted: 18 }), drawn, drawn);
    expect(readout).toEqual({
      kind: 'counted',
      nodes: 38,
      edges: 60,
      added: 3,
      removed: 0,
      moved: 6,
      stayedPut: 29,
      rerouted: 18,
    });
  });

  it('counts a removal against the drawing that is left, not the one that is gone', () => {
    // `removed` names ids of the PREVIOUS result and `moved` and `added` name
    // the next one, so a readout that subtracted all three from the new node
    // count would undercount what stayed put by exactly the number removed.
    const drawn = result(38, 60);
    const next = result(35, 53);
    const readout = counted(readEdit(next, delta({ removed: 3, moved: 6, rerouted: 18 }), drawn, drawn));
    expect(readout.stayedPut).toBe(29);
    expect(readout.nodes).toBe(35);
  });

  it('refuses to claim a number when the delta is measured from a drawing nobody saw', () => {
    // THE LESSON M5.3a SHIPPED A BUG OVER. React renders the LATEST snapshot of
    // an external store, not every one, so two unbatched edits in one task are
    // two deltas and ONE call to `onLayout` carrying the second. Counting it
    // would report the last hop as though it were the whole edit: a wrong
    // number, silently, beside a drawing that is right. `from` is what makes
    // that detectable, and an identity comparison is the whole test.
    const onScreen = result(32, 47);
    const unseen = result(35, 53);
    const next = result(38, 60);

    const readout = readEdit(next, delta({ added: 3, moved: 6 }), unseen, onScreen);

    expect(readout.kind).toBe('coalesced');
    expect(readout).not.toHaveProperty('moved');
  });

  it('counts again on the very next edit, so one coalesced burst is not a permanent silence', () => {
    const onScreen = result(32, 47);
    const unseen = result(35, 53);
    const afterBurst = result(38, 60);
    expect(readEdit(afterBurst, delta({ moved: 1 }), unseen, onScreen).kind).toBe('coalesced');

    // The component records what it drew whatever the readout said, so the next
    // edit is a difference from the drawing on screen again.
    const next = result(38, 60);
    expect(readEdit(next, delta({ moved: 4 }), afterBurst, afterBurst).kind).toBe('counted');
  });

  it('is coalesced rather than counted through a real unbatched burst', () => {
    // The unit cases above build their results by hand. This one produces the
    // situation the way an application would: two mutating calls in one task,
    // which `Graph.subscribe` delivers as two patches and the engine turns into
    // two deltas, of which a React consumer would see only the second.
    const graph = createLivingGraph();
    const engine = createLayout();
    const drawn = engine.run(graph);

    const seen: { result: LayoutResult; delta: LayoutDelta; from: LayoutResult }[] = [];
    let previous = drawn;
    const unsubscribe = graph.subscribe((patch) => {
      const relaid = engine.relayout(patch);
      seen.push({ result: relaid.result, delta: relaid.delta, from: previous });
      previous = relaid.result;
    });

    // Deliberately NOT in a `graph.batch`, which is the whole point.
    graph.addNode({ id: 'late', attrs: { stage: 'compile' } });
    graph.addEdge({ id: 'compile-0->late', source: 'compile-0', target: 'late' });
    unsubscribe();

    expect(seen).toHaveLength(2);
    const last = seen[1];
    expect(last).toBeDefined();
    if (last === undefined) return;
    // `drawn` is what a consumer would have on screen: the second delta is a
    // difference from the first result, which never reached a frame.
    expect(readEdit(last.result, last.delta, last.from, drawn).kind).toBe('coalesced');
  });

  it('counts a real batched edit, which is the case the demo is built to hit', () => {
    const graph = createLivingGraph();
    const engine = createLayout();
    const drawn = engine.run(graph);

    // An array rather than a nullable `let`: TypeScript does not track an
    // assignment made inside a callback, so a `let landed = null` narrows to
    // `never` after the null check below and every field read is an error.
    const landed: { result: LayoutResult; delta: LayoutDelta }[] = [];
    const unsubscribe = graph.subscribe((patch) => {
      const relaid = engine.relayout(patch);
      landed.push({ result: relaid.result, delta: relaid.delta });
    });
    graph.batch(() => {
      graph.addNode({ id: 'late', attrs: { stage: 'compile' } });
      graph.addEdge({ id: 'compile-0->late', source: 'compile-0', target: 'late' });
    });
    unsubscribe();

    expect(landed).toHaveLength(1);
    const only = landed[0];
    if (only === undefined) return;
    const { result: next, delta: change } = only;
    const readout = counted(readEdit(next, change, drawn, drawn));
    expect(readout.added).toBe(1);
    expect(readout.stayedPut).toBe(next.nodes.size - 1 - change.nodes.moved.length);
  });
});
