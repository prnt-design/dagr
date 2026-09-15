/**
 * Whether the visitor has asked their system not to animate things.
 *
 * THIS DEMO IS AN ANIMATION, so the setting is not a detail it can wave past. A
 * visitor who has asked for less motion still gets the demonstration: the edits
 * still happen and the readout still counts them, the drawing just cuts to each
 * new layout instead of gliding, and it waits for them to press a button rather
 * than playing on its own. That is `animate` left off and autoplay left off,
 * which is exactly the two-line shape `<DagrCanvas>` was given for it: `animate`
 * is `?: T | undefined`, so `animate={reduced ? undefined : feel}` compiles.
 *
 * `useSyncExternalStore` rather than an effect, because Docusaurus renders every
 * page on the server at build time and `matchMedia` is not there. The server
 * snapshot is `false`, which is the right answer for a page nobody is looking
 * at, and the subscription corrects it on the client before the first paint the
 * visitor sees.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** The media query list, or `null` where there is no `matchMedia` to ask. */
function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  if (list === null) return () => undefined;
  list.addEventListener('change', onChange);
  return () => {
    list.removeEventListener('change', onChange);
  };
}

function snapshot(): boolean {
  return query()?.matches ?? false;
}

function serverSnapshot(): boolean {
  return false;
}

/** `true` when the visitor prefers reduced motion. `false` anywhere it cannot be asked. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
