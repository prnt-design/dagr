/**
 * The worker half of the campaign demo: one module whose whole job is to answer
 * layout runs.
 *
 * `serveLayout` decodes each request, runs the pipeline and posts the answer
 * back. The campaign is cut into about a hundred tiles and each is a separate
 * call, so a hundred Sugiyama passes run here while the page paints instead of
 * on the main thread while it does not.
 *
 * A SECOND COPY of the landing page's `LiveLayout/layout.worker.ts`, and the
 * duplication is the point rather than an oversight. `new Worker(new URL(...))`
 * is resolved by the bundler from the module that writes it, so a worker entry
 * belongs beside the component that constructs it; sharing one module across
 * two components would tie this route's chunk to the landing page's directory
 * for two lines of code. It is also why the stage itself, which lives in
 * `@dagr/campaign-stage` and is bundled by Vite for `apps/demo` as well, takes
 * a `createWorker` function instead of building one: the expression has to be
 * somewhere each bundler can see it, and there are two bundlers.
 *
 * Webpack needs the `dagr-worker-runtime` plugin in `docusaurus.config.ts` to
 * emit a loadable chunk for this. The failure it prevents is silent: a worker
 * that throws while its module evaluates never answers, and a run that is never
 * answered never settles, so the stage would sit on "laying out the campaign"
 * forever with nothing thrown.
 */

import type { LayoutPort } from '@dagr/layout';
import { serveLayout } from '@dagr/layout';

// A dedicated worker's global scope has the four members `LayoutPort` asks for,
// but the DOM lib types `self` as a `Window`, whose `postMessage` takes an
// origin where this one takes a transfer list. The cast is that difference and
// nothing more.
serveLayout(self as unknown as LayoutPort);
