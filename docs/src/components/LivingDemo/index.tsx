/**
 * The living stage, mounted in the docs site.
 *
 * Everything on the canvas is `@dagr/living-stage`, the same component
 * `apps/demo` mounts. This file is the one thing that cannot travel with it:
 * the browser-only mount below.
 *
 * IN THE BROWSER ONLY, AND BY `require` RATHER THAN A STATIC IMPORT. Docusaurus
 * renders every page on the server at build time, and the stage reaches a GPU
 * adapter through three.js, whose WebGPU entry expects a browser. `BrowserOnly`
 * stops the component RENDERING during that build; it does nothing about a
 * top-level `import`, which is hoisted and evaluated whether or not anything
 * renders it. Requiring it inside the render function is what keeps the module
 * from being evaluated at all on the server, and it is the form Docusaurus
 * documents for exactly this. `CampaignDemo` next door does the same, for the
 * same reason.
 *
 * No worker here, unlike the campaign. This graph is 32 nodes: laying it out
 * takes less than a frame, and a worker would add a round trip per edit to a
 * demo whose whole subject is how little work an edit is.
 */

import BrowserOnly from '@docusaurus/BrowserOnly';
import type { ReactNode } from 'react';
// A TYPE-only import of the whole module, so the `require` below is typed
// rather than `any`. `import type` is erased, so this does not put the package
// in the server bundle's evaluation path, which is the whole point of the
// `require`.
import type * as LivingStageModule from '@dagr/living-stage';
import '@dagr/living-stage/living.css';
import styles from './LivingDemo.module.css';
import GraphViewport from '../GraphViewport';
import type RendererAdapterModule from '../GraphViewport/RendererAdapter';

export default function LivingDemo(): ReactNode {
  return (
    <div className={styles.frame}>
      <BrowserOnly
        fallback={
          <p className={styles.pending}>
            The graph is laid out and drawn in your browser, so there is nothing
            to show until the page has loaded.
          </p>
        }
      >
        {() => {
          const { LivingStage } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- browser-only renderer boundary.
            require('@dagr/living-stage') as typeof LivingStageModule;
          const { default: RendererAdapter } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- browser-only renderer boundary.
            require('../GraphViewport/RendererAdapter') as {
              default: typeof RendererAdapterModule;
            };
          return (
            <LivingStage
              autoplay={false}
              canvasChildren={<RendererAdapter />}
              renderCanvas={(canvas) => (
                <GraphViewport label="Live edit graph" native>
                  {canvas}
                </GraphViewport>
              )}
            />
          );
        }}
      </BrowserOnly>
    </div>
  );
}
