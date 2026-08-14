import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import HeroGraph from '@site/src/components/HeroGraph';
import perfStats from '@site/src/components/perfStats.json';
import CodeBlock from '@theme/CodeBlock';
import Layout from '@theme/Layout';
import ThemedImage from '@theme/ThemedImage';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './index.module.css';

const EXAMPLE = `import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';

const g = new Graph();
g.addNode({ id: 'parse' });
g.addNode({ id: 'typecheck' });
g.addEdge({ source: 'parse', target: 'typecheck' });

const { nodes, edges, bounds } = layout({ graph: g });
nodes.get('typecheck'); // { x, y, width, height }`;

interface Feature {
  title: string;
  body: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: 'Headless layout',
    body: (
      <>
        A typed Sugiyama pipeline: cycle breaking, ranking, ordering,
        positioning, routing. Every stage a caller chooses between is exported
        by name, and none of them touch the DOM.
      </>
    ),
  },
  {
    title: 'Stable identity',
    body: (
      <>
        Nodes keep their identity across relayouts, mutations arrive as
        patches with inverses, and an unchanged record keeps its object
        identity, so <code>getNode(id) === previousNode</code> is a real
        memoization test.
      </>
    ),
  },
  {
    title: 'WebGPU rendering',
    body: (
      <>
        SDF shapes on the three.js <code>WebGPURenderer</code>, headed for
        instanced meshes and spring animation. The layout engine never learns
        the renderer exists.
      </>
    ),
  },
  {
    title: 'Measured, then merged',
    body: (
      <>
        Strict TypeScript, property-based tests, and a benchmark gate that
        compares medians as ratios against a control workload, with a
        tolerance that widens with measured noise instead of crying wolf.
      </>
    ),
  },
];

export default function Home(): ReactNode {
  return (
    <Layout
      title="Directed graph layout, designed for animation"
      description="Dagr is a directed graph toolkit for the web: a typed, headless Sugiyama layout engine designed for animation, a WebGPU renderer, and visual DSL building blocks."
    >
      <main>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <img src={useBaseUrl('/img/logo.svg')} alt="" width={28} height={28} />
              <span>dagr</span>
            </p>
            <h1 className={styles.title}>
              Directed graph layout, designed for animation
            </h1>
            <p className={styles.lede}>
              Dagr is a successor to the dagre and d3 pairing: a typed,
              headless Sugiyama engine whose output is built to move, a WebGPU
              renderer on three.js, and a React component on top. Layout will
              emit deltas rather than fresh coordinates, so a renderer can
              spring every node from where it was to where it belongs.
            </p>
            <div className={styles.actions}>
              <Link
                className={clsx('bias-open-s', styles.button, styles.buttonPrimary)}
                to="/docs/"
              >
                Get started
              </Link>
              <Link
                className={clsx('bias-open-s', styles.button, styles.buttonGhost)}
                href="https://github.com/prnt-design/dagr"
              >
                GitHub
              </Link>
            </div>
            <p className={styles.status}>
              Early days: the graph model and the layout core are shipped,
              rendering has first light, and nothing is on npm yet. The{' '}
              <Link href="https://github.com/prnt-design/dagr/blob/main/ROADMAP.md">
                roadmap
              </Link>{' '}
              is public.
            </p>
          </div>
          <figure className={clsx('selvedge', styles.heroFigure)}>
            <HeroGraph />
            <figcaption className={styles.heroCaption}>
              Laid out by the engine, not by hand: 20 nodes, 34 edges, seven
              ranks, ranked, ordered, positioned, and routed by{' '}
              <code>@dagr/layout</code>.
            </figcaption>
          </figure>
        </header>

        <section className={styles.features} aria-label="What Dagr is">
          {FEATURES.map((f) => (
            <article key={f.title} className={clsx('selvedge', styles.card)}>
              <h2 className={styles.cardTitle}>{f.title}</h2>
              <p className={styles.cardBody}>{f.body}</p>
            </article>
          ))}
        </section>

        <section className={styles.perf} aria-label="Scale">
          <div className={styles.perfHead}>
            <h2 className={styles.exampleTitle}>Scale is a measured claim</h2>
            <p className={styles.exampleBody}>
              This is <code>smallCorpus()</code> from the repository&apos;s
              benchmark harness, 1,000 nodes and 4,000 edges, laid out in{' '}
              {perfStats.medianMs}&thinsp;ms: the median of {perfStats.runs}{' '}
              back-to-back runs at this drawing&apos;s node size and spacing,
              full pipeline, contract checks included, on an{' '}
              {perfStats.machine} virtual machine under Node{' '}
              {perfStats.node}. That figure is this drawing&apos;s, not the
              gate&apos;s: every merge is gated by the same harness comparing
              medians as ratios against a control workload, and the{' '}
              <Link to="/docs/layout">layout docs</Link> publish the cost of
              each stage on both bench corpora rather than a single flattering
              number.
            </p>
          </div>
          <figure className={clsx('selvedge', styles.perfFigure)}>
            <ThemedImage
              className={styles.perfImage}
              alt="The 1,000 node, 4,000 edge benchmark corpus laid out by Dagr: 64 ranks drawn left to right."
              sources={{
                light: useBaseUrl('/img/bench-1k-light.svg'),
                dark: useBaseUrl('/img/bench-1k-dark.svg'),
              }}
            />
          </figure>
        </section>

        <section className={styles.example} aria-label="Example">
          <div className={styles.exampleCopy}>
            <h2 className={styles.exampleTitle}>The whole API fits in a graph and a call</h2>
            <p className={styles.exampleBody}>
              Build a <code>Graph</code>, hand it to <code>layout</code>, read
              positions and routes back by your own ids. Sizes, spacing, and
              individual stages are config, not forks. The APIs are real and
              tested; the package names are where they will publish at v0.1,
              and nothing is on npm yet.
            </p>
            <p className={styles.exampleBody}>
              <Link to="/docs/">Read the docs</Link> for the graph model, the
              layout pipeline, and what each stage guarantees.
            </p>
          </div>
          <div className={styles.exampleCode}>
            <CodeBlock language="ts">{EXAMPLE}</CodeBlock>
          </div>
        </section>
      </main>
    </Layout>
  );
}
