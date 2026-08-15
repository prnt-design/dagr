/**
 * The campaign stage, mounted in the docs site.
 *
 * Everything on the canvas is `@dagr/campaign-stage`, the same component
 * `apps/demo` mounts. This file is the two things that cannot travel with it:
 * the worker entry, which the bundler resolves from wherever the expression is
 * written, and the browser-only mount below.
 *
 * IN THE BROWSER ONLY, AND BY `require` RATHER THAN A STATIC IMPORT. Docusaurus
 * renders every page on the server at build time, and the stage reaches a GPU
 * adapter through three.js, whose WebGPU entry expects a browser. `BrowserOnly`
 * stops the component RENDERING during that build; it does nothing about a
 * top-level `import`, which is hoisted and evaluated whether or not anything
 * renders it. Requiring it inside the render function is what keeps the module
 * from being evaluated at all on the server, and it is the form Docusaurus
 * documents for exactly this.
 */

import BrowserOnly from '@docusaurus/BrowserOnly';
import type { ReactNode } from 'react';
// A TYPE-only import of the whole module, so the `require` below is typed
// rather than `any`. `import type` is erased, so this does not put the package
// in the server bundle's evaluation path, which is the whole point of the
// `require`.
import type * as CampaignStageModule from '@dagr/campaign-stage';
import '@dagr/campaign-stage/stage.css';
import styles from './CampaignDemo.module.css';

/**
 * Builds the layout worker.
 *
 * Declared at module scope so its identity is stable across renders, though the
 * stage's hook deliberately does not watch it: see `useCampaignScene`. The
 * `new URL(..., import.meta.url)` form is what webpack reads statically to emit
 * `layout.worker.ts` as its own entrypoint, and a worker loads exactly one
 * script, so that entrypoint has to be self-contained.
 */
function createWorker(): Worker {
  return new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
}

export default function CampaignDemo(): ReactNode {
  return (
    <div className={styles.frame}>
      <BrowserOnly
        fallback={
          <p className={styles.pending}>
            The campaign is drawn in your browser, so there is nothing to show until the page
            has loaded.
          </p>
        }
      >
        {() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- see the file header: a static import would evaluate the renderer during the server build.
          const { CampaignStage } = require('@dagr/campaign-stage') as typeof CampaignStageModule;
          return <CampaignStage createWorker={createWorker} />;
        }}
      </BrowserOnly>
    </div>
  );
}
