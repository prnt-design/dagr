import { serveLayout } from '@dagr/layout';
import type { LayoutPort } from '@dagr/layout';

/**
 * The worker end of `@dagr/layout`'s M2.10 protocol: one module whose whole job
 * is to answer layout runs.
 *
 * The campaign is cut into about a hundred tiles and each is a separate layout
 * call (see `campaign-scene.ts`), so a hundred Sugiyama passes run here while
 * the page paints instead of on the main thread while it does not. The engine
 * prepares each run on the calling side, which is what lets the node sizes cross
 * as measured numbers: `nodeSize` is a function and a function does not
 * structured-clone.
 *
 * `self` is a `DedicatedWorkerGlobalScope`, which has the four members
 * {@link LayoutPort} names and none of the rest of a `Worker`. The cast is to
 * the port interface rather than to `Worker`, so it claims exactly what is used.
 *
 * Its own module, and imported nowhere, because a bundler discovers it through
 * the `new URL(..., import.meta.url)` in `App.tsx` and emits it as a separate
 * chunk. A worker loads exactly one script, so that chunk has to be
 * self-contained: Vite does that by default for a module worker, and the docs
 * site needs a webpack plugin to get the same thing, which is exactly why this
 * entry stayed with the app instead of moving into `@dagr/campaign-stage` with
 * the rest of the stage. Each host owns the expression its own bundler reads.
 */
serveLayout(self as unknown as LayoutPort);
