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
 * canvas, what it does with each `onLayout`, when a button is disabled, and
 * when autoplay stops. What it does NOT cover is that `<DagrCanvas>` calls
 * `onLayout` once per commit with a `from` that means what this package thinks
 * it means, or that one batched edit glides rather than reseating. Both of
 * those are `@dagr/react`'s own claims about its own component and are tested
 * in `packages/react/test/dagr-canvas-animate.test.tsx`, against the real
 * springs. Re-testing them here would be testing `@dagr/react` badly.
 *
 * The recorded props are the fake's whole surface: a test drives an edit by
 * calling `lastCanvas().onLayout?.(...)` with whatever a layout would have
 * said, which is how a delta the real engine would take a graph mutation to
 * produce can be stated directly instead.
 *
 * INSTALLED BY THE TEST FILE, not by a function here. `vi.mock` is hoisted
 * above the imports by vitest's transform, so it has to appear literally in the
 * file that wants it; a helper that called it would run after the module under
 * test had already been imported for real. The spread form is the one
 * `packages/react/test/dagr-canvas-animate.test.tsx` uses:
 *
 * ```ts
 * vi.mock('@dagr/react', async (importOriginal) => ({
 *   ...(await importOriginal<Record<string, unknown>>()),
 *   DagrCanvas: (await import('./fake-canvas.js')).FakeDagrCanvas,
 * }));
 * ```
 */

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { DagrCanvasProps } from '@dagr/react';

/** Every `<DagrCanvas>` rendered since the last {@link resetCanvases}, in order. */
const rendered: DagrCanvasProps[] = [];

/** Clears the record. Call it per test. */
export function resetCanvases(): void {
  rendered.length = 0;
}

/** How many times the fake canvas has rendered. */
export function canvasRenders(): number {
  return rendered.length;
}

/** The props of the most recent render, which is the canvas currently on screen. */
export function lastCanvas(): DagrCanvasProps {
  const last = rendered.at(-1);
  if (last === undefined) throw new Error('no DagrCanvas has been rendered');
  return last;
}

/**
 * The stand-in itself.
 *
 * Renders a plain div and NOT its children. `LivingStage` puts `<RefitButton>`
 * inside, and that reads `useDagrCanvas`, which throws without a provider: the
 * real component deliberately withholds its context until the renderer, the
 * overlay and the layout all exist, so a fake that rendered children eagerly
 * would put the component in a state the real one never produces.
 */
export function FakeDagrCanvas(props: DagrCanvasProps): ReactElement {
  rendered.push(props);
  return createElement('div', { 'data-testid': 'fake-canvas' });
}
