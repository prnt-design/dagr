/**
 * The explorer over a generated 2,000 node graph, mounted in the docs, with a
 * readout of how many node elements are on the page.
 *
 * BROWSER-ONLY FOR WEIGHT, NOT FOR SAFETY. The explorer renders on a server,
 * but rendering this one there would put 2,000 marks and every routed edge
 * into the page's HTML for a graph nobody has scrolled to yet. So the graph
 * is generated and laid out in the browser. The import is static, unlike the
 * site's WebGPU demos, because evaluating the explorer on a server is safe.
 *
 * THE READOUT IS A CONTRACT. It counts the elements matching
 * `[data-dagr-explorer="node"]` inside this demo, and the browser checks read
 * it (and its `data-mounted` attribute) to show the overlay stays near
 * `maxOverlayNodes` while the graph is panned. Keep the attribute names.
 */

import BrowserOnly from '@docusaurus/BrowserOnly';
import { DagrExplorer } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './ExplorerDemo.module.css';
import { syntheticView } from './synthetic';
import type { SyntheticNode } from './synthetic';

/** The overlay cap, passed explicitly so the readout can name it. The default is also 200. */
const MAX_OVERLAY_NODES = 200;

const searchText = (node: SyntheticNode): string => `${node.id} ${node.label} ${node.role}`;
const count = (value: number): string => value.toLocaleString('en-US');

/** How many node elements are mounted under `root`, kept current as the explorer mounts and unmounts them. */
function useMountedNodeCount(root: HTMLElement | null): number {
  const [mounted, setMounted] = useState(0);
  useEffect(() => {
    if (root === null) return undefined;
    let frame = 0;
    const read = (): void => {
      frame = 0;
      setMounted(root.querySelectorAll('[data-dagr-explorer="node"]').length);
    };
    read();
    // Coalesced to one read per frame: a zoom can mount and unmount many
    // elements in one commit.
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(read);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [root]);
  return mounted;
}

function LargeGraph(): ReactNode {
  const view = useMemo(() => syntheticView(), []);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const mounted = useMountedNodeCount(root);
  return (
    <>
      <div ref={setRoot}>
        <DagrExplorer
          label="Synthetic system"
          nodes={view.nodes}
          edges={view.edges}
          layout={view.layout}
          searchText={searchText}
          maxOverlayNodes={MAX_OVERLAY_NODES}
          renderNode={(node, { tier }) =>
            tier === 'rich' ? (
              <>
                <span className={styles.nodeKind}>
                  {node.role}, layer {node.layer + 1}
                </span>
                <span className={styles.nodeLabel}>{node.label}</span>
              </>
            ) : (
              node.label
            )
          }
        />
      </div>
      <p className={styles.readout} data-readout="large">
        <strong>{count(view.nodes.length)}</strong> nodes, <strong>{count(view.edges.length)}</strong> edges.
        Node elements mounted:{' '}
        <strong data-mounted={mounted}>{count(mounted)}</strong>, against a cap of{' '}
        <strong data-cap={MAX_OVERLAY_NODES}>{MAX_OVERLAY_NODES}</strong> plus the pinned nodes.
      </p>
    </>
  );
}

export default function LargeGraphDemo(): ReactNode {
  return (
    <div className={`${styles.theme} ${styles.large}`} data-demo="large">
      <BrowserOnly
        fallback={
          <p className={styles.pending}>
            This graph is generated and laid out in your browser, so there is nothing to show until the
            page has loaded.
          </p>
        }
      >
        {() => <LargeGraph />}
      </BrowserOnly>
    </div>
  );
}
