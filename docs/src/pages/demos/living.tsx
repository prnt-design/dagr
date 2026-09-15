/**
 * `/demos/living`: the animated demo, on the site that makes the claim it
 * illustrates.
 *
 * A SIBLING ROUTE TO `/demos/campaign`, which is the home its own file reserved
 * for exactly this: "it also leaves the animated demos on the roadmap a home as
 * sibling pages under the same tab". A route rather than a section of the
 * landing page, because the canvas wants room and the landing page already has
 * a hero, a live benchmark and a pitch that would all sit below a canvas that
 * ate the fold.
 *
 * THIS IS THE PAGE THE PROJECT'S HEADLINE CLAIM NEEDED. The landing page says
 * layout is designed for animation and that untouched nodes stay put; the
 * incremental-layout doc publishes the corpus measurements behind it; and until
 * this route there was nothing anywhere that mutated a graph in front of a
 * visitor. The campaign demo is read-only, so it proves scale and semantic zoom
 * and says nothing at all about stability under an edit.
 */

import Link from '@docusaurus/Link';
import LivingDemo from '@site/src/components/LivingDemo';
import Layout from '@theme/Layout';
import type { ReactNode } from 'react';
import styles from './living.module.css';

export default function LivingDemoPage(): ReactNode {
  return (
    <Layout
      title="Living graph demo"
      description="A build pipeline edited while you watch: every edit is one patch, one LayoutDelta and one glide, with a count of how much of the drawing stayed exactly where it was."
    >
      <main className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>A graph that is edited while you watch</h1>
          <p className={styles.lede}>
            A seeded build pipeline of 32 tasks. Press <strong>grow</strong>,{' '}
            <strong>prune</strong> or <strong>relayout</strong>, or let it play. Each one is a
            single <code>graph.batch</code>, so <code>@dagr/layout</code> sees one patch and
            answers with one <code>LayoutDelta</code>, and <code>&lt;DagrCanvas animate&gt;</code>{' '}
            springs every node from where it was to where it now belongs.
          </p>
          <p className={styles.lede}>
            The numbers under the canvas are read off that delta and nothing else. The lit nodes
            are the ones it named. Everything unlit is a node the edit did not touch, drawn in
            exactly the place it was in before: that is what{' '}
            <Link to="/docs/incremental-layout">incremental layout</Link> means, and the
            measurements over a six-session corpus are on that page. This one is not a new
            measurement, it is the same claim with the numbers on screen beside the picture.
          </p>
          <p className={styles.lede}>
            The camera frames the graph once and is yours after that. It does not refit when the
            graph changes, on purpose: a drawing that stays put while the camera moves is
            indistinguishable from a drawing that moves, so an automatic refit would hide the
            very thing this page exists to show. The <strong>refit</strong> button is there for
            when you have panned away. For the other demo, three thousand nodes and no edits at
            all, see the <Link to="/demos/campaign">campaign</Link>.
          </p>
        </header>
        <LivingDemo />
      </main>
    </Layout>
  );
}
