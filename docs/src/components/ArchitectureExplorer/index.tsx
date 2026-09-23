import { useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from '@docusaurus/Link';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import BrowserOnly from '@docusaurus/BrowserOnly';
import LivingDemo from '../LivingDemo';
import type RichDemoModule from './RichDemo';
import { architectureLayout, connections, SOURCE, systems } from './model';
import type { SystemId } from './model';
import styles from './styles.module.css';
import GraphViewport from '../GraphViewport';

const modes = ['Architecture', 'Follow an edit', 'Rich content'] as const;
type Mode = (typeof modes)[number];

export default function ArchitectureExplorer() {
  useBrokenLinks().collectAnchor('inside-the-graph');
  const [mode, setMode] = useState<Mode>('Architecture');
  const [selected, setSelected] = useState<SystemId>('layout');
  const drawing = useMemo(architectureLayout, []);
  const arrow = useId().replace(/:/g, '');
  const current = systems.find((node) => node.id === selected)!;
  const width = drawing.bounds.height + 64;
  const height = drawing.bounds.width + 64;
  return (
    <section
      className={styles.explorer}
      id="inside-the-graph"
      aria-label="Inside the graph workbench"
    >
      <div className={styles.introduction}>
        <h2>Inside the graph</h2>
        <p>
          Explore how Dagr lays out a graph, animates an edit, and brings your
          content into the scene.
        </p>
      </div>
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
              aria-label="Inspect a system"
              value={selected}
              onChange={(event) =>
                setSelected(event.target.value as SystemId)
              }
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
              <GraphViewport
                label="Architecture diagram"
                width={width}
                height={height}
              >
                <div className={styles.diagram} style={{ width, height }}>
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
                      // Locate the halfway point along the route, not the middle vertex.
                      const lengths = points
                        .slice(1)
                        .map((point, i) =>
                          Math.hypot(
                            point.x - points[i]!.x,
                            point.y - points[i]!.y,
                          ),
                        );
                      let remaining =
                        lengths.reduce((sum, length) => sum + length, 0) / 2;
                      let middle = points[0]!;
                      for (const [i, length] of lengths.entries()) {
                        if (remaining <= length && length > 0) {
                          const start = points[i]!;
                          const end = points[i + 1]!;
                          const fraction = remaining / length;
                          middle = {
                            x: start.x + (end.x - start.x) * fraction,
                            y: start.y + (end.y - start.y) * fraction,
                          };
                          break;
                        }
                        remaining -= length;
                      }
                      const labelX = middle.x;
                      const labelWidth = edge.label.length * 8 + 16;
                      return (
                        <g
                          key={edge.label}
                          className={
                            edge.source === selected ||
                            edge.target === selected
                              ? styles.activeWire
                              : undefined
                          }
                        >
                          <path
                            d={points
                              .map(
                                (p, i) =>
                                  `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`,
                              )
                              .join(' ')}
                            markerEnd={`url(#${arrow})`}
                          />
                          <rect
                            x={labelX - labelWidth / 2}
                            y={middle.y - 34}
                            width={labelWidth}
                            height="22"
                          />
                          <text
                            x={labelX}
                            y={middle.y - 18}
                            textAnchor="middle"
                          >
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
              </GraphViewport>
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
            Laid out by <code>@dagr/layout</code>, presented with HTML and
            SVG. This map explains the runtime flow; it is not a live profiler
            or a package dependency graph.
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
              Add or remove tasks in a build pipeline. The readout reports
              what each actual layout delta added, removed, and moved.
              Animation is opt-in; start with a single edit.
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
