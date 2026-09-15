/**
 * `/demos/campaign`: the campaign demo, on the docs site's own domain and under
 * its own nav.
 *
 * It used to be a second Render service on an `onrender.com` subdomain, which
 * produced a URL and nothing else: a visitor to the docs did not find it, the
 * landing page did not link to it, and following it dropped the site's chrome.
 * The site already compiles the layout engine into a visitor's browser for the
 * landing page's benchmark, so adding the renderer here was a dependency step
 * rather than an architecture change.
 *
 * A route of its own rather than a section of the landing page, because the
 * canvas wants the viewport and its own keyboard focus, and the landing page
 * has a hero, a figure and a pitch that would all sit below a canvas that ate
 * the fold. It also left the animated demo a home as a sibling page under the
 * same tab, which M5.3b took: `/demos/living` is the other one, the Demos tab
 * now points there, and the two pages link to each other rather than to a
 * `/demos/` index nobody would want a click for.
 */

import Link from '@docusaurus/Link';
import CampaignDemo from '@site/src/components/CampaignDemo';
import Layout from '@theme/Layout';
import type { ReactNode } from 'react';
import styles from './campaign.module.css';

export default function CampaignDemoPage(): ReactNode {
  return (
    <Layout
      title="Campaign demo"
      description="A mock D&D campaign of 3,010 nodes, laid out by @dagr/layout in a worker and drawn by @dagr/render on a canvas, in your browser."
    >
      <main className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>Campaign demo</h1>
          <p className={styles.lede}>
            A mock D&amp;D campaign of 3,010 nodes and 7,100 edges, generated in this page from a
            seed, cut into about a hundred tiles and laid out one tile at a time by{' '}
            <code>@dagr/layout</code> in a worker, then drawn by <code>@dagr/render</code>. Drag to
            pan, scroll to zoom, click the canvas and the arrow keys take over. The campaign is a
            generated fixture rather than part of the toolkit: arcs and chapters down to keyed
            rooms, with quests, factions, clues and countdown clocks laid across them, and the
            package that makes it{' '}
            <Link href="https://github.com/prnt-design/dagr/blob/main/packages/campaign/README.md">
              documents its schema
            </Link>
            . This demo never edits the graph: for the one that does, and a
            count of how little each edit moves, see the{' '}
            <Link to="/demos/living">living graph</Link>.
          </p>
        </header>
        <CampaignDemo />
      </main>
    </Layout>
  );
}
