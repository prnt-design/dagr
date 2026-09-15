/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '@dagr/graph';
import { createLayout } from '@dagr/layout';
import type { LayoutDelta, LayoutResult } from '@dagr/layout';
// The module `vi.mock` below is replacing, as a type. A `typeof import(...)`
// inline would be the obvious spelling and the repo's lint rule forbids it.
import type * as DagrReact from '@dagr/react';

// Only `DagrCanvas` is faked; see `fake-canvas.ts`. Everything else the
// component imports from `@dagr/react` is the real export.
vi.mock('@dagr/react', async (importOriginal) => {
  const real = await importOriginal<typeof DagrReact>();
  const { makeFakeDagrCanvas } = await import('./fake-canvas.js');
  return { ...real, DagrCanvas: makeFakeDagrCanvas(real.useDagr) };
});

import { LivingStage } from '../src/LivingStage.js';
import { AUTOPLAY_CYCLE } from '../src/edit-script.js';
import { HIGHLIGHT_GLOW } from '../src/appearance.js';
import { LIVING_LAYOUT_CONFIG } from '../src/living-graph.js';
import { lastCanvas, resetCanvases } from './fake-canvas.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';

let tree: Mounted | null = null;

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

/**
 * Mounts the stage, autoplay off unless asked, and returns the graph it built.
 *
 * Nothing drives the layout: the fake canvas holds the REAL `useDagr`, so the
 * cold run is reported on the first commit and every later edit is reported
 * from inside the `graph.batch` that caused it. See `fake-canvas.tsx`.
 */
async function mountStage(props: { autoplay?: boolean } = {}): Promise<Graph> {
  tree = await mount(<LivingStage autoplay={props.autoplay ?? false} />);
  return lastCanvas().graph;
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

  it('plays a whole lap on its own, so a visitor who never clicks still sees the feature', async () => {
    // A LAP, not a step. The first version of this advanced one interval and
    // asserted one grow, which is a weaker claim than its name and would have
    // passed over an autoplay that took one step and stopped. A lap is six, and
    // the sixth leaves the graph exactly as the first found it.
    vi.useFakeTimers();
    const graph = await mountStage({ autoplay: true });
    if (tree === null) return;
    expect(readoutText(tree.container)).toContain('nothing edited yet');
    const before = graph.nodeCount;

    const seen: string[] = [];
    for (let step = 0; step < AUTOPLAY_CYCLE.length; step += 1) {
      await flush(() => {
        vi.advanceTimersByTime(3000);
      });
      const verb = /^(grow|prune|relayout):/.exec(readoutText(tree?.container as HTMLElement));
      seen.push(verb?.[1] ?? 'nothing');
    }

    expect(seen).toEqual([...AUTOPLAY_CYCLE]);
    expect(graph.nodeCount, 'a lap is the identity').toBe(before);
    expect(stats(tree.container).get('nodes stayed put')).toBe('26 of 32');
  });

  it('stops playing the moment a visitor presses a verb, so the demo becomes theirs', async () => {
    vi.useFakeTimers();
    await mountStage({ autoplay: true });
    if (tree === null) return;

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
    await mountStage({ autoplay: true });
    if (tree === null) return;

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

  it('starts the count over for a new seed, and counts the very first edit after it', async () => {
    // THE `[graph]` RESET EFFECT, WHICH NOTHING EXERCISED. Its whole body could
    // be deleted and the suite stayed green, which matters because a review
    // round changed exactly this effect: it used to null `counted` here, and
    // because React flushes a child's effects before its parent's that threw
    // away a cold run `<DagrCanvas>` had already reported, so the first edit of
    // every mount claimed "more than one edit arrived in a single frame".
    //
    // A seed change is the one way a host can make a new graph without
    // remounting, and it is the case the effect exists for.
    tree = await mount(<LivingStage autoplay={false} seed={1} />);
    await flush(() => {
      verb(tree?.container as HTMLElement, 'grow').click();
    });
    expect(stats(tree.container).get('nodes stayed put')).toBe('26 of 35');

    await tree.rerender(<LivingStage autoplay={false} seed={99} />);

    // A new graph is a cold run, so there is nothing to have stayed put yet,
    // and the script is back at the top: prune is greyed out again.
    expect(readoutText(tree.container)).toContain('laid out cold');
    expect(readoutText(tree.container)).toContain('nothing edited yet');
    expect(verb(tree.container, 'prune').disabled).toBe(true);

    await flush(() => {
      verb(tree?.container as HTMLElement, 'grow').click();
    });

    // AND THE FIRST EDIT AFTER THE RESEED COUNTS, which is the half that would
    // go red if `counted.current = null` came back.
    const after = stats(tree.container);
    expect(after.get('nodes stayed put')).toBeDefined();
    expect(after.get('added')).toBe('3');
    expect(readoutText(tree.container)).not.toContain('More than one edit');
  });

  it('takes the controls away when the drawing fails, rather than editing nothing', async () => {
    // `onError` is `<DagrCanvas>`'s one exit for a renderer that never arrived
    // and for a layout that failed. Without this the verbs stayed live over a
    // canvas that had gone, so a visitor could keep editing a graph nothing was
    // drawing, and the message blamed the GPU for both causes.
    await mountStage();
    if (tree === null) return;
    expect(verb(tree.container, 'grow').disabled).toBe(false);

    await flush(() => {
      lastCanvas().onError?.(new Error('no adapter'));
    });

    expect(tree.container.querySelector('.living__failure')?.textContent).toContain('no adapter');
    for (const button of verbs(tree.container)) expect(button.disabled).toBe(true);
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
    // Synthesised rather than caused, because the component cannot produce it:
    // `applyStep` batches, so every edit it makes is one patch and one commit.
    // A second engine supplies a delta and a `from` of the shape a burst would
    // have had, and the component's own `counted` is the drawing on screen.
    const graph = await mountStage();
    const engine = createLayout({ config: LIVING_LAYOUT_CONFIG });
    engine.run(graph);

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
      // `from` is the drawing the SKIPPED delta produced, which never reached a
      // frame. What the component last counted is the drawing on screen, which
      // is not it.
      lastCanvas().onLayout?.(arrived.result, arrived.delta, skipped.result);
    });

    if (tree === null) return;
    expect(readoutText(tree.container)).toContain('More than one edit');
    expect(readoutText(tree.container)).not.toContain('stayed put');
  });
});
