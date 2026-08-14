/**
 * The worker half of the landing page's live demo.
 *
 * This is the whole of it: `serveLayout` decodes each request, runs the
 * pipeline, and posts the answer back. The stages are not named here, so the
 * worker runs the same defaults the engine on the page would have run, which is
 * the condition under which the two agree (see the engine's docstring in
 * `packages/layout/src/engine.ts`).
 *
 * The demo runs here rather than on the page's own thread because a 1,000 node
 * run is on the order of a hundred milliseconds, and a hundred milliseconds on
 * the main thread is a page that stops answering the scrollbar. The component
 * falls back to running on the main thread behind `requestIdleCallback` where a
 * worker cannot be constructed, which is the same `runAsync` call either way.
 */

import type { LayoutPort } from '@dagr/layout';
import { serveLayout } from '@dagr/layout';

// A dedicated worker's global scope has the four members `LayoutPort` asks for,
// but the DOM lib types `self` as a `Window`, whose `postMessage` takes an
// origin where this one takes a transfer list. The cast is that difference and
// nothing more.
serveLayout(self as unknown as LayoutPort);
