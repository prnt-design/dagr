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
          <h1 className={styles.title}>Follow an edit</h1>
          <p className={styles.lede}>
            Add or remove tasks in a build pipeline. Each edit is one graph
            batch; the layout engine returns new geometry and a delta describing
            what changed. Press grow, prune, or relayout to see it happen, or
            play the sequence.
          </p>
          <p className={styles.lede}>
            The readout counts added, removed, and moved nodes from the actual
            delta. The camera stays where you leave it; use refit to frame the
            graph again. Stability depends on the graph and the edit. Read the{' '}
            <Link to="/docs/incremental-layout">
              measurements and limitations
            </Link>
            , or return <Link to="/">inside the graph</Link> to explore the
            architecture.
          </p>
        </header>
        <LivingDemo />
      </main>
    </Layout>
  );
}
