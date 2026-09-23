import Link from '@docusaurus/Link';
import ChessAtlas from '@site/src/components/ChessAtlas';
import ArchitectureExplorer from '@site/src/components/ArchitectureExplorer';
import LiveLayout from '@site/src/components/LiveLayout';
import CodeBlock from '@theme/CodeBlock';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const EXAMPLE = `import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';

const graph = new Graph();
graph.addNode({ id: 'source' });
graph.addNode({ id: 'preview' });
graph.addEdge({ source: 'source', target: 'preview' });

const result = layout({ graph });
// Node boxes and routed edges, keyed by your IDs.`;

export default function Home() {
  return (
    <Layout
      title="Inside the graph"
      description="Explore Dagr from the inside: graph layout, animated changes, and rich content. An open-source toolkit by Nii Yeboah, creator of PRNT."
    >
      <main>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>DAGR / A GRAPH TOOLKIT FOR THE WEB</p>
          <div className={styles.intro}>
            <div>
              <h1>
                Inside the graph<span>.</span>
              </h1>
              <p className={styles.lede}>
                Structure you can explore.
                <br />
                Changes you can follow.
              </p>
            </div>
            <div className={styles.context}>
              <p>
                Graph layout, GPU rendering, and the building blocks for visual
                languages. Follow branching chess openings, then explore the
                engine that gives the graph its structure.
              </p>
              <p className={styles.byline}>
                By <a href="https://niiyeboah.com">Nii Yeboah</a>, engineer and
                generative artist behind <a href="https://prnt.design">PRNT</a>.
              </p>
              <Link to="/docs/">Build with Dagr ↗</Link>
            </div>
          </div>
        </header>
        <ChessAtlas />
        <ArchitectureExplorer />
        <section className={styles.story} aria-labelledby="meaning-title">
          <p className={styles.eyebrow}>THE GRAPH IS THE MEDIUM</p>
          <div className={styles.storyBody}>
            <h2 id="meaning-title">
              You bring the meaning.
              <br />
              Dagr brings the structure.
            </h2>
            <div>
              <p>
                A service map, a build pipeline, a procedural pattern. Each has
                its own vocabulary. Dagr handles graph identity, layout,
                rendering, and motion so your application can define what the
                connections mean.
              </p>
              <Link to="/docs/visual-languages">
                The case for visual languages →
              </Link>
            </div>
          </div>
        </section>
        <section className={styles.scale} aria-labelledby="scale-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>MEASURE IT HERE</p>
              <h2 id="scale-title">
                A bigger graph.
                <br />
                An actual measurement.
              </h2>
            </div>
            <p>
              Run the layout engine on a seeded graph in your browser. This
              measures layout and the worker round trip on your device, not GPU
              frame rate.{' '}
              <Link to="/docs/layout#what-a-run-costs">
                Read the methodology →
              </Link>
            </p>
          </div>
          <LiveLayout />
        </section>
        <section className={styles.start} aria-labelledby="start-title">
          <div>
            <p className={styles.eyebrow}>FROM EXPLORING TO BUILDING</p>
            <h2 id="start-title">Start with two nodes.</h2>
            <p>
              The graph and layout packages work without a browser. Add the
              renderer and React bindings when you want a canvas, rich content,
              and animation.
            </p>
            <Link to="/docs/">Get started →</Link>
            <p className={styles.status}>
              Pre-release. Not yet on npm.{' '}
              <a href="https://github.com/prnt-design/dagr">
                Explore the repository ↗
              </a>
            </p>
          </div>
          <CodeBlock language="ts">{EXAMPLE}</CodeBlock>
        </section>
      </main>
    </Layout>
  );
}
