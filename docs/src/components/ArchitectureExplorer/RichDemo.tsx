import { useEffect, useMemo, useState } from 'react';
import { Graph } from '@dagr/graph';
import { DagrCanvas, Html, useDagrCanvas } from '@dagr/react';
import styles from './styles.module.css';
import GraphViewport from '../GraphViewport';
import RendererAdapter from '../GraphViewport/RendererAdapter';

const config = { defaultNodeSize: { width: 300, height: 160 }, rankSep: 70 };
const appearance = () => ({ fillColor: 0x263d36, cornerRadius: 2 });
const colors = ['#3b8268', '#a391bf', '#cb7754', '#e3ddd1'];
function Content({
  seed,
  onReady,
}: {
  seed: number;
  onReady: (ready: boolean) => void;
}) {
  useEffect(() => {
    onReady(true);
  }, [onReady]);
  const { result, renderer } = useDagrCanvas();
  const route = result.edges.get('pattern-output');
  const points = route?.points ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <>
      <Html node="seed">
        <div className={styles.richNode}>
          <small>INPUT / INTEGER</small>
          <h3>Seed {seed}</h3>
          <p>
            A repeatable starting point.
            <br />
            Same seed, same pattern.
          </p>
        </div>
      </Html>
      <Html node="pattern">
        <div className={styles.richNode}>
          <small>GENERATOR / PATTERN</small>
          <h3>Woven geometry</h3>
          <div
            className={styles.pattern}
            role="img"
            aria-label={`Pattern preview for seed ${seed}`}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <span
                key={i}
                style={{
                  background:
                    colors[((i * 7 + seed * 3) ^ (i + seed)) % colors.length],
                  clipPath:
                    (i + seed) % 2 === 0
                      ? 'polygon(0 0, 100% 0, 0 100%)'
                      : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </Html>
      <Html node="output">
        <div className={styles.richNode}>
          <small>OUTPUT / PREVIEW</small>
          <h3>Compose your domain</h3>
          <p>
            Nodes carry meaning.
            <br />
            Edges describe what flows.
          </p>
        </div>
      </Html>
      {first && last && (
        <Html
          placement={{
            kind: 'point',
            at: { x: (first.x + last.x) / 2, y: -(first.y + last.y) / 2 },
          }}
        >
          <span className={styles.edgeLabel}>pattern → preview</span>
        </Html>
      )}
      <span className={styles.backend}>Backend: {renderer.backend}</span>
    </>
  );
}
export default function RichDemo() {
  const [seed, setSeed] = useState(7);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const graph = useMemo(() => {
    const value = new Graph();
    for (const id of ['seed', 'pattern', 'output']) value.addNode({ id });
    value.addEdge({ id: 'seed-pattern', source: 'seed', target: 'pattern' });
    value.addEdge({
      id: 'pattern-output',
      source: 'pattern',
      target: 'output',
    });
    return value;
  }, []);
  return (
    <>
      <div className={styles.richControls}>
        <button type="button" onClick={() => setSeed((value) => value + 1)}>
          Change seed
        </button>
        <button type="button" onClick={() => setSeed(7)}>
          Reset seed
        </button>
        <output aria-live="polite">Seed {seed}</output>
      </div>
      {!ready && !failure && <p role="status">Starting the renderer…</p>}
      {failure ? (
        <p role="alert">
          The canvas could not start: {failure.message}. The architecture map
          and rich-content guide remain available.
        </p>
      ) : (
        <GraphViewport label="Rich content graph" native>
          <DagrCanvas
            graph={graph}
            config={config}
            nodeAppearance={appearance}
            clearColor={0x18231f}
            className={styles.richCanvas}
            onError={setFailure}
          >
            <RendererAdapter />
            <Content seed={seed} onReady={setReady} />
          </DagrCanvas>
        </GraphViewport>
      )}
      <p className={styles.caption}>
        This example draws three nodes through the renderer. React portals
        provide the text and generated swatch; an explicit world-space placement
        anchors the edge label. Seed changes update content, not graph topology.
        This demonstrates composition, not graph execution or drag-to-connect.
      </p>
    </>
  );
}
