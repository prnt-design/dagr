import { useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from '@docusaurus/Link';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LivingDemo from '../LivingDemo';
import type RichDemoModule from './RichDemo';
import { architectureLayout, connections, SOURCE, systems } from './model';
import type { SystemId } from './model';
import styles from './styles.module.css';

const modes = ['Architecture', 'Follow an edit', 'Rich content'] as const;
type Mode = (typeof modes)[number];

export default function ArchitectureExplorer() {
  const [mode, setMode] = useState<Mode>('Architecture');
  const [selected, setSelected] = useState<SystemId>('layout');
  const [zoom, setZoom] = useState(1);
  const drawing = useMemo(architectureLayout, []);
  const arrow = useId().replace(/:/g, '');
  const current = systems.find((node) => node.id === selected)!;
  const width = drawing.bounds.height + 64;
  const height = drawing.bounds.width + 64;
  return (
    <section
      className={styles.explorer}
      aria-label="Inside the graph workbench"
    >
      <div className={styles.modebar}>
        <div className={styles.modes} role="group" aria-label="Explore Dagr">
          {modes.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <span className={styles.note}>REAL ENGINE. OPEN SOURCE.</span>
      </div>
      {mode === 'Architecture' && (
        <>
          <label className={styles.mobileSelect}>
            Inspect a system
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value as SystemId)}
            >
              {systems.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.workbench}>
            <div className={styles.diagramPanel}>
              <div className={styles.diagramHeading}>
                <span>01 / RUNTIME ARCHITECTURE</span>
                <span>
                  {systems.length} systems · {connections.length} connections
                </span>
              </div>
              <div
                className={styles.viewport}
                tabIndex={0}
                aria-label="Architecture diagram. Scroll to explore; select a node to inspect it."
              >
                <div
                  className={styles.diagram}
                  style={{
                    width: `${Math.round(100 * zoom)}%`,
                    minWidth: `${Math.round(1000 * zoom)}px`,
                    aspectRatio: `${width} / ${height}`,
                  }}
                >
                  <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className={styles.wires}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id={arrow}
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                      >
                        <path d="M0 0 L8 4 L0 8" fill="currentColor" />
                      </marker>
                    </defs>
                    {connections.map((edge, index) => {
                      const route = drawing.edges.get(`flow-${index}`)!;
                      const points = route.points.map((p) => ({
                        x: p.y - drawing.bounds.y + 32,
                        y: p.x - drawing.bounds.x + 32,
                      }));
                      const middle = points[Math.floor(points.length / 2)]!;
                      const from = points[0]!;
                      const to = points[points.length - 1]!;
                      const labelX = (from.x + to.x) / 2;
                      return (
                        <g
                          key={edge.label}
                          className={
                            edge.source === selected || edge.target === selected
                              ? styles.activeWire
                              : undefined
                          }
                        >
                          <path
                            d={points
                              .map(
                                (p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`,
                              )
                              .join(' ')}
                            markerEnd={`url(#${arrow})`}
                          />
                          <rect
                            x={labelX - 48}
                            y={middle.y - 23}
                            width="96"
                            height="22"
                          />
                          <text x={labelX} y={middle.y - 8} textAnchor="middle">
                            {edge.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  {systems.map((node) => {
                    const box = drawing.nodes.get(node.id)!;
                    const position = {
                      left: `${((box.y - box.height / 2 - drawing.bounds.y + 32) / width) * 100}%`,
                      top: `${((box.x - box.width / 2 - drawing.bounds.x + 32) / height) * 100}%`,
                      width: `${(box.height / width) * 100}%`,
                      height: `${(box.width / height) * 100}%`,
                    };
                    return (
                      <button
                        type="button"
                        key={node.id}
                        style={position as CSSProperties}
                        className={`${styles.node} ${styles[node.color]}`}
                        aria-pressed={selected === node.id}
                        onClick={() => setSelected(node.id)}
                      >
                        <span className={styles.nodeRole}>{node.role}</span>
                        <strong>{node.name}</strong>
                        <span className={styles.nodeSummary}>
                          {node.summary}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className={styles.diagramFooter}>
                <div
                  className={styles.zoom}
                  role="group"
                  aria-label="Diagram zoom"
                >
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoom <= 1}
                    onClick={() => setZoom((v) => Math.max(1, v - 0.25))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={zoom >= 2}
                    onClick={() => setZoom((v) => Math.min(2, v + 0.25))}
                  >
                    +
                  </button>
                  <button type="button" onClick={() => setZoom(1)}>
                    Reset zoom
                  </button>
                </div>
                <span>Select a node. Follow the connections.</span>
              </div>
            </div>
            <aside
              className={styles.inspector}
              aria-label="Selected system"
              aria-live="polite"
            >
              <p className={styles.kicker}>INSPECT / {current.role}</p>
              <h2>{current.name}</h2>
              <p>{current.detail}</p>
              <h3>What it does</h3>
              <ul>
                {current.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              <h3>At the boundary</h3>
              <code>{current.api}</code>
              <div className={styles.inspectorLinks}>
                <a href={`${SOURCE}${current.file}`}>Read the source ↗</a>
                <Link to={current.docs}>Explore the API →</Link>
              </div>
            </aside>
          </div>
          <p className={styles.caption}>
            Laid out by <code>@dagr/layout</code>, presented with HTML and SVG.
            This map explains the runtime flow; it is not a live profiler or a
            package dependency graph.
          </p>
          <details className={styles.connections}>
            <summary>Read the connections</summary>
            <dl>
              {connections.map((edge) => (
                <div key={edge.label}>
                  <dt>
                    {systems.find((n) => n.id === edge.source)!.name} →{' '}
                    {systems.find((n) => n.id === edge.target)!.name}:{' '}
                    <code>{edge.label}</code>
                  </dt>
                  <dd>{edge.detail}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
      {mode === 'Follow an edit' && (
        <div className={styles.demoPanel}>
          <div className={styles.demoIntro}>
            <p className={styles.kicker}>02 / CHANGES YOU CAN FOLLOW</p>
            <h2>A small edit. A visible difference.</h2>
            <p>
              Add or remove tasks in a build pipeline. The readout reports what
              each actual layout delta added, removed, and moved. Animation is
              opt-in; start with a single edit.
            </p>
            <Link to="/docs/incremental-layout">
              How incremental layout works →
            </Link>
          </div>
          <LivingDemo />
        </div>
      )}
      {mode === 'Rich content' && (
        <div className={styles.demoPanel}>
          <div className={styles.demoIntro}>
            <p className={styles.kicker}>03 / YOUR DOMAIN, YOUR CONTENT</p>
            <h2>More than boxes and wires.</h2>
            <p>
              A small pattern pipeline with real React content over the GPU
              canvas, plus an annotation on an edge. Change the seed to update
              the preview. This is an illustrative visual language, not a full
              node editor.
            </p>
            <Link to="/docs/rich-content">
              Build rich nodes and edge annotations →
            </Link>
          </div>
          <BrowserOnly
            fallback={
              <p className={styles.loading}>
                Loading the rich-content example…
              </p>
            }
          >
            {() => {
              const RichDemo =
                // eslint-disable-next-line @typescript-eslint/no-require-imports -- renderer modules must not evaluate during server rendering.
                (require('./RichDemo') as { default: typeof RichDemoModule })
                  .default;
              return <RichDemo />;
            }}
          </BrowserOnly>
        </div>
      )}
    </section>
  );
}
