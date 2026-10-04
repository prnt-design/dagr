/**
 * The explorer over a small architecture graph, mounted in the docs.
 *
 * NOT BROWSER-ONLY, unlike the site's other demos. Every part of
 * @prnt/dagr-explorer renders on a server, so Docusaurus renders this one at
 * build time: the HTML carries the shell and every node as a mark, and the
 * node elements arrive once the client has measured the graph. The page's
 * server rendering section points here.
 *
 * Only the public entry and the stylesheet are imported.
 */

import { DagrExplorer } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';
import type { ReactNode } from 'react';
import styles from './ExplorerDemo.module.css';
import { architectureViews } from './architecture';
import type { ArchitectureNode } from './architecture';

const searchText = (node: ArchitectureNode): string => `${node.id} ${node.label} ${node.kind}`;

export default function ArchitectureDemo(): ReactNode {
  return (
    <div className={styles.theme} data-demo="architecture">
      <DagrExplorer
        label="Tidewater architecture"
        views={architectureViews}
        searchText={searchText}
        renderNode={(node, { tier }) =>
          tier === 'rich' ? (
            <>
              <span className={styles.nodeKind}>{node.kind}</span>
              <span className={styles.nodeLabel}>{node.label}</span>
              <span className={styles.nodeSummary}>{node.summary}</span>
            </>
          ) : (
            node.label
          )
        }
        renderDetails={({ node, connections, inspect }) => (
          <>
            <p className={styles.detailsTitle}>{node.label}</p>
            <dl className={styles.facts}>
              <dt>Kind</dt>
              <dd>{node.kind}</dd>
              <dt>Owner</dt>
              <dd>{node.owner}</dd>
              <dt>Edges</dt>
              <dd>{connections.length}</dd>
            </dl>
            <p className={styles.detailsSummary}>{node.summary}</p>
            <ul className={styles.connections} aria-label={`Connections of ${node.label}`}>
              {connections.map(({ edge, node: other }) => (
                <li key={edge.id}>
                  <button type="button" onClick={() => inspect(other.id)}>
                    {edge.source === node.id ? 'To' : 'From'} {other.label}
                    <span className={styles.connectionLabel}>{edge.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      />
    </div>
  );
}
