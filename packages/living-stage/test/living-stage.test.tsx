/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '@dagr/graph';
import { createLayout } from '@dagr/layout';
import type { LayoutDelta, LayoutResult } from '@dagr/layout';

// Only `DagrCanvas` is faked; see `fake-canvas.ts`. Everything else the
// component imports from `@dagr/react` is the real export.
vi.mock('@dagr/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DagrCanvas: (await import('./fake-canvas.js')).FakeDagrCanvas,
}));

import { LivingStage } from '../src/LivingStage.js';
import { HIGHLIGHT_GLOW } from '../src/appearance.js';
import { LIVING_LAYOUT_CONFIG } from '../src/living-graph.js';
import { lastCanvas, resetCanvases } from './fake-canvas.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';

let tree: Mounted | null = null;

/**
 * Lays the component's own graph out and reports it the way `<DagrCanvas>`
 * does: in the graph listener, once per patch, with the drawing each delta is
 * a difference from.
 *
 * This is the one part of the real component the fake canvas does not bring
 * with it, so it is reproduced here rather than stubbed with invented numbers:
 * every count these tests assert is one the layout engine actually produced for
 * the edit the button actually made.
 */
function driveLayout(graph: Graph): void {
  const engine = createLayout({ config: LIVING_LAYOUT_CONFIG });
  const cold = engine.run(graph);
  let previous: LayoutResult = cold;
  lastCanvas().onLayout?.(cold, null, null);
  graph.subscribe((patch) => {
    const relaid = engine.relayout(patch);
    // Read at call time: the props are a new object on every render.
    lastCanvas().onLayout?.(relaid.result, relaid.delta, previous);
    previous = relaid.result;
  });
}

/** The verb buttons, in the order they are rendered. */
function verbs(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.living__verb')];
}

/** The verb button whose label is `name`. */
function verb(container: HTMLElement, name: string): HTMLButtonElement {
  const found = verbs(container).find((button) => button.textContent === name);
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

/** Everything the readout panel says, whitespace squashed. */
function readoutText(container: HTMLElement): string {
  return (container.querySelector('.living__readout')?.textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * The stat tiles, as label to value.
 *
 * Read per tile rather than off the panel's `textContent`, because adjacent
 * elements concatenate with no separator there and "26 of 35" beside "nodes
 * stayed put" comes out as one run-on string. A map also makes the assertion
 * name the number it means rather than a substring that happens to appear.
 */
function stats(container: HTMLElement): Map<string, string> {
  const tiles = container.querySelectorAll('.living__stat');
  return new Map(
    [...tiles].map((tile) => [
      tile.querySelector('.living__statLabel')?.textContent ?? '',
      tile.querySelector('.living__statValue')?.textContent ?? '',
    ]),
  );
}

/** Mounts the stage with autoplay off and the layout driven, and returns the graph. */
async function mountStage(props: { autoplay?: boolean } = {}): Promise<Graph> {
  tree = await mount(<LivingStage autoplay={props.autoplay ?? false} />);
  const graph = lastCanvas().graph;
  await flush(() => {
    driveLayout(graph);
  });
  return graph;
}

beforeEach(() => {
  resetCanvases();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('<LivingStage>', () => {
  it('says how big the graph is and claims nothing about movement before an edit', async () => {
    await mountStage();
    if (tree === null) return;
    expect(readoutText(tree.container)).toContain('nothing edited yet');
    expect(readoutText(tree.container)).toContain('32 nodes and 47 edges');
    expect(readoutText(tree.container)).not.toContain('stayed put');
  });

  it('counts what one grow moved, and what it left alone', async () => {
    await mountStage();
    if (tree === null) return;

    await flush(() => {
      verb(tree?.container as HTMLElement, 'grow').click();
    });

    // The numbers `lap.test.ts` measures for the first grow: three added, six
    // moved, and 26 of the 35 nodes now on screen exactly where they were.
    expect(stats(tree.container)).toEqual(
      new Map([
        ['nodes stayed put', '26 of 35'],
        ['moved', '6'],
        ['added', '3'],
        ['removed', '0'],
        ['edges rerouted', '17 of 53'],
      ]),
    );
    expect(readoutText(tree.container)).toContain('grow: three parse tasks');
  });

  it('greys out prune until there is something to prune, and back out when there is not', async () => {
    await mountStage();
    if (tree === null) return;
    expect(verb(tree.container, 'prune').disabled).toBe(true);
    expect(verb(tree.container, 'grow').disabled).toBe(false);

    await flush(() => {
      verb(tree?.container as HTMLElement, 'grow').click();
    });
    expect(verb(tree.container, 'prune').disabled).toBe(false);

    await flush(() => {
      verb(tree?.container as HTMLElement, 'prune').click();
    });
    expect(verb(tree.container, 'prune').disabled).toBe(true);
  });

  it('haloes exactly the nodes the last edit touched, and nothing else', async () => {
    await mountStage();
    if (tree === null) return;
    const graph = lastCanvas().graph;
    const before = graph.nodes().map((node) => node.id);

    await flush(() => {
      verb(tree?.container as HTMLElement, 'grow').click();
    });

    const appearance = lastCanvas().nodeAppearance;
    expect(appearance).toBeDefined();
    if (appearance === undefined) return;
    const lit = graph
      .nodes()
      .map((node) => node.id)
      .filter((id) => appearance(id)?.glowWorld === HIGHLIGHT_GLOW);

    // Three added and six moved is nine, and every added node is among them.
    expect(lit).toHaveLength(9);
    for (const id of graph.nodes().map((node) => node.id)) {
      if (before.includes(id)) continue;
      expect(lit, `${id} was added and is not lit`).toContain(id);
    }
  });

  it('plays a lap on its own, so a visitor who never clicks still sees the feature', async () => {
    vi.useFakeTimers();
    tree = await mount(<LivingStage autoplay />);
    const graph = lastCanvas().graph;
    await flush(() => {
      driveLayout(graph);
    });
    expect(readoutText(tree.container)).toContain('nothing edited yet');

    await flush(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(readoutText(tree.container)).toContain('grow:');
    expect(stats(tree.container).get('nodes stayed put')).toBe('26 of 35');
  });

  it('stops playing the moment a visitor presses a verb, so the demo becomes theirs', async () => {
    vi.useFakeTimers();
    tree = await mount(<LivingStage autoplay />);
    const graph = lastCanvas().graph;
    await flush(() => {
      driveLayout(graph);
    });

    await flush(() => {
      verb(tree?.container as HTMLElement, 'relayout').click();
    });
    const afterPress = readoutText(tree.container);
    expect(afterPress).toContain('relayout:');

    // Three intervals with nobody watching. Autoplay would have taken three
    // more steps by now and the readout would name a different verb.
    await flush(() => {
      vi.advanceTimersByTime(3000 * 3);
    });
    expect(readoutText(tree.container)).toBe(afterPress);
  });

  it('neither animates nor autoplays for a visitor who asked for reduced motion', async () => {
    // The case `<DagrCanvas>`'s `animate?: T | undefined` exists for: passing
    // `undefined` has to be expressible, and it has to mean off.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.useFakeTimers();
    tree = await mount(<LivingStage autoplay />);
    const graph = lastCanvas().graph;
    await flush(() => {
      driveLayout(graph);
    });

    expect(lastCanvas().animate).toBeUndefined();
    expect(tree.container.querySelector('.living__play')).toBeNull();

    await flush(() => {
      vi.advanceTimersByTime(3000 * 3);
    });
    expect(readoutText(tree.container)).toContain('nothing edited yet');
  });

  it('animates by default, because the glide is the whole point', async () => {
    await mountStage();
    expect(lastCanvas().animate).toEqual({ halfLifeSeconds: 0.2 });
  });

  it('refuses to claim a number when two edits arrive between two drawings', async () => {
    // THE M5.3a LESSON, AT THE COMPONENT LEVEL. Every edit the buttons make is
    // batched, so this drives the canvas by hand instead: two mutating calls in
    // one task are two patches and two deltas, and React renders the LATEST
    // snapshot of an external store rather than every one, so `<DagrCanvas>`
    // makes ONE `onLayout` call carrying the second. The readout must not count
    // it, because that delta is a difference from a drawing that never reached
    // a frame.
    //
    // Mounted without `mountStage`, whose `driveLayout` would report every
    // patch as its own commit and so never produce the case.
    tree = await mount(<LivingStage autoplay={false} />);
    const graph = lastCanvas().graph;
    const engine = createLayout({ config: LIVING_LAYOUT_CONFIG });
    const onScreen = engine.run(graph);
    await flush(() => {
      lastCanvas().onLayout?.(onScreen, null, null);
    });

    const seen: { result: LayoutResult; delta: LayoutDelta }[] = [];
    const unsubscribe = graph.subscribe((patch) => {
      const relaid = engine.relayout(patch);
      seen.push({ result: relaid.result, delta: relaid.delta });
    });
    graph.addNode({ id: 'first', attrs: { stage: 'compile' } });
    graph.addNode({ id: 'second', attrs: { stage: 'compile' } });
    unsubscribe();

    const skipped = seen[0];
    const arrived = seen[1];
    expect(seen).toHaveLength(2);
    if (skipped === undefined || arrived === undefined) return;

    await flush(() => {
      // `from` is the drawing the SKIPPED delta produced. The component last
      // counted against `onScreen`, which is not it.
      lastCanvas().onLayout?.(arrived.result, arrived.delta, skipped.result);
    });

    if (tree === null) return;
    expect(readoutText(tree.container)).toContain('More than one edit');
    expect(readoutText(tree.container)).not.toContain('stayed put');
  });
});
