/**
 * A stand-in for `<DagrCanvas>`, so this package's component can be mounted
 * without a GPU.
 *
 * A NON-TEST helper. It replaces `DagrCanvas` and NOTHING ELSE: the mock
 * spreads this file over the real `@dagr/react`, so `toWorldBounds`,
 * `useDagrCanvas` and every other export a component reaches for is the real
 * one. That is the shape `packages/react/test/fake-render.ts` settled on and it
 * is settled here for the same reason: fake the thing that needs a device, and
 * nothing else, or a test ends up asserting that the component calls an API
 * rather than that it does the right thing with the answer.
 *
 * WHAT IS AND IS NOT COVERED BY FAKING AT THIS LEVEL, said rather than assumed.
 * What this covers is everything `LivingStage` owns: which props it hands the
 * canvas, what it does with each real `onLayout`, when a button is disabled,
 * and when autoplay stops. What it does NOT cover is anything about DRAWING:
 * that one batched edit glides rather than reseating, that a removed node
 * leaves on the frame its spring settles, that the camera fits once. Those are
 * `@dagr/react`'s own claims about its own component and are tested in
 * `packages/react/test/dagr-canvas-animate.test.tsx`, against the real springs.
 * Re-testing them here would be testing `@dagr/react` badly.
 *
 * A test drives an edit by EDITING THE GRAPH, exactly as a visitor does. The
 * `onLayout` calls that follow are produced by the real hook from the real
 * patch, so every count a test asserts is one the layout engine actually
 * computed for the edit the button actually made. `lastCanvas()` is there for
 * the props (`animate`, `nodeAppearance`) and for the rare test that needs to
 * synthesise a call the component cannot be made to produce on its own.
 *
 * INSTALLED BY THE TEST FILE, not by a function here. `vi.mock` is hoisted
 * above the imports by vitest's transform, so it has to appear literally in the
 * file that wants it; a helper that called it would run after the module under
 * test had already been imported for real:
 *
 * ```ts
 * vi.mock('@dagr/react', async (importOriginal) => {
 *   const real = await importOriginal<typeof import('@dagr/react')>();
 *   const { makeFakeDagrCanvas } = await import('./fake-canvas.js');
 *   return { ...real, DagrCanvas: makeFakeDagrCanvas(real.useDagr) };
 * });
 * ```
 *
 * `useDagr` IS HANDED IN RATHER THAN IMPORTED HERE, and that is not a style
 * choice: this file is loaded BY the factory that is mocking `@dagr/react`, so
 * an `import { useDagr } from '@dagr/react'` here waits on a module whose
 * initialisation is waiting on this one. The suite deadlocks with no output at
 * all, which is a worse symptom than a failure. The factory already holds the
 * real module, so it passes the hook in. Type-only imports are fine, because
 * they are erased.
 */

import { createElement, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { DagrCanvasProps, useDagr as UseDagr } from '@dagr/react';

/** Every `<DagrCanvas>` rendered since the last {@link resetCanvases}, in order. */
const rendered: DagrCanvasProps[] = [];

/** Clears the record. Call it per test. */
export function resetCanvases(): void {
  rendered.length = 0;
}

/** The props of the most recent render, which is the canvas currently on screen. */
export function lastCanvas(): DagrCanvasProps {
  const last = rendered.at(-1);
  if (last === undefined) throw new Error('no DagrCanvas has been rendered');
  return last;
}

/**
 * The stand-in itself, over the real `useDagr`.
 *
 * Renders a plain div and NOT its children. `LivingStage` puts `<RefitButton>`
 * inside, and that reads `useDagrCanvas`, which throws without a provider: the
 * real component deliberately withholds its context until the renderer, the
 * overlay and the layout all exist, so a fake that rendered children eagerly
 * would put the component in a state the real one never produces.
 */
export function makeFakeDagrCanvas(useDagr: typeof UseDagr) {
  return function FakeDagrCanvas(props: DagrCanvasProps): ReactElement {
    rendered.push(props);
    // The props as of the newest render, read from effects and never depended
    // on, exactly as `DagrCanvas` does it.
    const latest = useRef(props);

    // THE REAL HOOK AND THE REAL `onLayout` EFFECT, COPIED FROM
    // `DagrCanvas.tsx`. These four lines are the whole reason this fake is not
    // a stub that records props: `onLayout`'s TIMING is part of its contract.
    // The hook lays the graph out during render and reports it from an effect
    // keyed on the layout, so a cold run reaches the host on the FIRST COMMIT,
    // before the host's own mount effects, and an edit reaches it from inside
    // the `graph.batch` that caused it. A test that called `onLayout` itself
    // after `mount()` resolved would report the cold run LAST, which is not an
    // ordering the real component can produce, and a host that reset state in a
    // `[graph]` effect would look correct when it was not. That is exactly the
    // defect this harness shipped and a review found.
    const layout = useDagr(props.graph, { config: props.config });
    latest.current = props;
    // `[layout]` alone, which is the real component's dependency list. Reading
    // the callback out of a ref rather than depending on it is what stops an
    // unstable `onLayout` from re-firing for the SAME layout: the second fire
    // would find `counted` already set to this result and render a spurious
    // `coalesced` readout that the real component cannot produce, so a fake
    // that depended on it would be able to fail a test the real one passes.
    useEffect(() => {
      if (layout.result === null) return;
      latest.current.onLayout?.(layout.result, layout.delta, layout.from);
    }, [layout]);

    // A layout that failed is reported, not thrown, and `LivingStage` takes the
    // canvas down when it is. Without this the component's whole failure arm is
    // unreachable from a test. `DagrCanvas` folds a renderer that never arrived
    // in here too; a test that wants that one calls `onError` directly.
    useEffect(() => {
      if (layout.error !== null) latest.current.onError?.(layout.error);
    }, [layout.error]);

    return createElement('div', { 'data-testid': 'fake-canvas' });
  };
}
