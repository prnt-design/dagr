import { shapeEdgePath } from '@prnt/dagr-render';
import type { EdgePathOptions } from '@prnt/dagr-render';
import { useGraphInteraction } from '@prnt/dagr-react';
import type { GraphHitProvider } from '@prnt/dagr-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from '@docusaurus/Link';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import { useGraphCamera } from '../GraphViewport/useGraphCamera';
import type { Camera } from '../GraphViewport/useGraphCamera';
import {
  buildSystem,
  neighbors,
  nodes,
  registry,
  searchNodes,
  wires,
} from './model';
import type { SystemNode } from './model';
import styles from './styles.module.css';

const symbols = {
  client: '▣',
  gateway: '◇',
  service: '⬡',
  stream: '≋',
  worker: '↻',
  store: '▤',
  external: '↗',
};
const kindNames = {
  client: 'Client',
  gateway: 'Gateway',
  service: 'Service',
  stream: 'Event stream',
  worker: 'Worker',
  store: 'Storage',
  external: 'Integration',
};

function RichNode({ node }: { node: SystemNode }) {
  return (
    <>
      <span className={styles.nodeTop}>
        <span>
          {symbols[node.kind]} {kindNames[node.kind]}
        </span>
        <span>{node.id}</span>
      </span>
      <strong className={styles.nodeName}>{node.name}</strong>
      <span className={styles.subtitle}>{node.subtitle}</span>
      <span className={styles.rich}>
        <span className={styles.rows}>
          {node.rows.map(([key, value]) => (
            <span key={key}>
              {key}
              <b>{value}</b>
            </span>
          ))}
        </span>
        <span className={styles.nodeCode}>{node.code.join('\n')}</span>
      </span>
      <span className={styles.ports}>
        {registry.get(node.kind).ports.map((p) => (
          <span key={p.id}>
            {p.direction === 'in' ? '●' : '○'} {p.id}
            <small>{p.type}</small>
          </span>
        ))}
      </span>
    </>
  );
}

export default function SystemAtlas() {
  useBrokenLinks().collectAnchor('system-atlas');
  const system = useMemo(buildSystem, []);
  const [selected, setSelected] = useState('checkout');
  const [query, setQuery] = useState('');
  const [edgePath, setEdgePath] = useState<EdgePathOptions['style']>('smooth');
  const paths = useMemo(() => new Map([...system.routes].map(([id, points]) => [id, shapeEdgePath(points, { style: edgePath })])), [system, edgePath]);
  const [trace, setTrace] = useState(false);
  const [tab, setTab] = useState<'inspect' | 'language'>('inspect');
  const [proposal, setProposal] = useState('valid');
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const zoomReadout = useRef<HTMLSpanElement>(null);
  const miniCamera = useRef<SVGRectElement>(null);
  const arrow = useId().replace(/:/g, '');
  const apply = useCallback((camera: Camera, width: number, height: number) => {
    if (!plane.current || !viewport.current) return;
    plane.current.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    viewport.current.dataset.detail =
      camera.scale < 0.42
        ? 'overview'
        : camera.scale < 0.58
          ? 'summary'
          : 'rich';
    if (zoomReadout.current)
      zoomReadout.current.textContent = `${Math.round(camera.scale * 100)}%`;
    if (miniCamera.current) {
      miniCamera.current.setAttribute('x', String(-camera.x / camera.scale));
      miniCamera.current.setAttribute('y', String(-camera.y / camera.scale));
      miniCamera.current.setAttribute('width', String(width / camera.scale));
      miniCamera.current.setAttribute('height', String(height / camera.scale));
    }
  }, []);
  const getNodes = useCallback(() => [...system.boxes.values()], [system]);
  const camera = useGraphCamera(
    viewport,
    plane,
    system.width,
    system.height,
    true,
    apply,
    undefined,
    getNodes,
  );
  const hitTarget = useCallback<GraphHitProvider<typeof system>>(
    (query) => {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]!;
        const box = system.boxes.get(node.id)!;
        if (
          query.world.x >= box.x &&
          query.world.x <= box.x + box.width &&
          query.world.y >= box.y &&
          query.world.y <= box.y + box.height
        ) {
          return {
            target: { kind: 'node', nodeId: node.id },
            displayedRevision: system,
          };
        }
      }
      return { target: null, displayedRevision: system };
    },
    [system],
  );
  useGraphInteraction({
    surfaceRef: viewport,
    displayedRevision: system,
    devicePixelRatio: globalThis.devicePixelRatio || 1,
    screenToWorld: (point) => camera.current.screenToWorld(point),
    hitTarget,
    selection: { kind: 'node', nodeId: selected },
    onSelectionChange: (target) => {
      if (target?.kind === 'node') setSelected(target.nodeId);
    },
    onPanStart: () => camera.current.beginPan(),
    onPanBy: (delta) => camera.current.panBy(delta),
  });
  const current = nodes.find((n) => n.id === selected)!;
  const adjacent = neighbors(selected);
  const matches = searchNodes(query);
  const matchIds = new Set(matches.map((n) => n.id));
  const connections = wires.filter(
    (e) => e.source === selected || e.target === selected,
  );
  function focus(id: string) {
    setSelected(id);
    setTab('inspect');
    const rect = viewport.current?.getBoundingClientRect();
    if (rect && (rect.bottom < 80 || rect.top > window.innerHeight)) {
      viewport.current?.scrollIntoView({ block: 'center' });
    }
    const b = system.boxes.get(id)!;
    // Keep enough surrounding graph in view to preserve context.
    const padding = (viewport.current?.clientWidth ?? 0) < 600 ? 12 : 150;
    camera.current.focus({
      x: b.x - padding,
      y: b.y - 140,
      width: b.width + padding * 2,
      height: b.height + 280,
    });
  }
  const check = registry.checkConnection(
    system.graph,
    proposal === 'valid'
      ? {
          source: 'checkout',
          sourcePort: 'event',
          target: 'shipping-events',
          targetPort: 'publish',
        }
      : {
          source: 'checkout',
          sourcePort: 'event',
          target: 'orders-db',
          targetPort: 'write',
        },
  );

  return (
    <section
      className={styles.section}
      id="system-atlas"
      aria-labelledby="atlas-title"
    >
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            AN ARCHITECTURE, EXPRESSED AS A LANGUAGE
          </p>
          <h2 id="atlas-title">One system. Every connection.</h2>
        </div>
        <p>
          A commerce platform from request to receipt. Follow the event streams,
          inspect a service, or zoom into the contracts that hold it together.
        </p>
      </header>
      <div className={styles.workbench}>
        <div className={styles.topbar}>
          <div>
            <strong>Commerce / system atlas</strong>
            <span>ILLUSTRATIVE ARCHITECTURE</span>
          </div>
          <span>
            {nodes.length} nodes <i>·</i> {wires.length} typed connections
          </span>
        </div>
        <div className={styles.workspace}>
          <div className={styles.graphColumn}>
            <div className={styles.graphActions}>
              <div className={styles.legend}>
                {registry.kinds.map((k) => (
                  <span key={k} data-kind={k}>
                    <i />
                    {kindNames[k as keyof typeof kindNames]}
                  </span>
                ))}
              </div>
              <label>
                Edges{' '}
                <select aria-label="Edge style" value={edgePath} onChange={(event) => setEdgePath(event.target.value as EdgePathOptions['style'])}>
                  <option value="polyline">Routed</option>
                  <option value="smooth">Curved</option>
                  <option value="orthogonal">Orthogonal</option>
                </select>
              </label>
              <button
                type="button"
                aria-pressed={trace}
                onClick={() => setTrace(!trace)}
              >
                Trace connections {trace ? 'on' : 'off'}
              </button>
            </div>
            <div
              className={styles.viewport}
              ref={viewport}
              tabIndex={0}
              role="region"
              aria-label="Commerce architecture graph"
              aria-describedby={`${arrow}-hint`}
              data-detail="overview"
            >
              <div
                ref={plane}
                className={styles.plane}
                style={{ width: system.width, height: system.height }}
              >
                <svg
                  className={styles.wires}
                  width={system.width}
                  height={system.height}
                  aria-hidden="true"
                >
                  <defs>
                    {['http', 'event', 'record'].map((type) => (
                      <marker
                        key={type}
                        id={`${arrow}-${type}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerUnits="userSpaceOnUse"
                        markerWidth="10"
                        markerHeight="10"
                        orient="auto-start-reverse"
                      >
                        <path
                          d="M 0 0 L 10 5 L 0 10 z"
                          className={styles[type]}
                        />
                      </marker>
                    ))}
                  </defs>
                  {wires.map((edge) => {
                    const points = paths.get(edge.id)!;
                    const active =
                      edge.source === selected || edge.target === selected;
                    return (
                      <g
                        key={edge.id}
                        className={`${styles.wire} ${styles[edge.type]} ${active ? styles.active : ''}`}
                        opacity={trace && !active ? 0.08 : undefined}
                      >
                        <path
                          d={points
                            .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
                            .join(' ')}
                          markerEnd={`url(#${arrow}-${edge.type})`}
                        />
                      </g>
                    );
                  })}
                </svg>
                {nodes.map((n) => {
                  const b = system.boxes.get(n.id)!;
                  const dim =
                    (trace && !adjacent.has(n.id)) ||
                    (query.trim() && !matchIds.has(n.id));
                  return (
                    <button
                      type="button"
                      key={n.id}
                      data-graph-node={n.id}
                      data-dagr-interaction-target
                      data-kind={n.kind}
                      className={styles.node}
                      style={
                        {
                          left: b.x,
                          top: b.y,
                          width: b.width,
                          height: b.height,
                          opacity: dim ? 0.2 : 1,
                        } as CSSProperties
                      }
                      aria-label={`${n.name}, ${kindNames[n.kind]}`}
                      aria-pressed={n.id === selected}
                      onClick={(event) => {
                        if (event.detail === 0) setSelected(n.id);
                      }}
                      onDoubleClick={() => focus(n.id)}
                      onFocus={(event) => {
                        if (event.currentTarget.matches(':focus-visible'))
                          focus(n.id);
                      }}
                    >
                      <RichNode node={n} />
                    </button>
                  );
                })}
              </div>
              <div className={styles.minimap} aria-hidden="true">
                <svg viewBox={`0 0 ${system.width} ${system.height}`}>
                  {wires.map((e) => (
                    <path
                      key={e.id}
                      d={system.routes
                        .get(e.id)!
                        .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
                        .join(' ')}
                    />
                  ))}
                  {nodes.map((n) => (
                    <rect
                      key={n.id}
                      {...system.boxes.get(n.id)!}
                      className={
                        n.id === selected ? styles.miniSelected : undefined
                      }
                    />
                  ))}
                  <rect ref={miniCamera} className={styles.miniCamera} />
                </svg>
              </div>
              <div className={styles.graphCaption}>
                REQUEST → PROCESS → PUBLISH → REACT → PERSIST
              </div>
            </div>
            <div className={styles.toolbar}>
              <div>
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => camera.current.zoom(0.8)}
                >
                  −
                </button>
                <span ref={zoomReadout}>Fit</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => camera.current.zoom(1.25)}
                >
                  +
                </button>
                <button type="button" onClick={() => camera.current.reset()}>
                  Fit graph
                </button>
              </div>
              <button type="button" onClick={() => focus(selected)}>
                Zoom to {current.name} ↗
              </button>
            </div>
          </div>
          <aside
            className={styles.inspector}
            aria-label="Find and inspect nodes"
          >
            <label className={styles.searchLabel} htmlFor={`${arrow}-search`}>
              Find a node
            </label>
            <input
              id={`${arrow}-search`}
              type="search"
              placeholder="Name, type, route, schema…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches[0]) {
                  focus(matches[0].id);
                  setQuery('');
                }
                if (event.key === 'Escape') setQuery('');
              }}
            />
            {query.trim() ? (
              <div className={styles.results}>
                <p role="status">
                  {matches.length} {matches.length === 1 ? 'match' : 'matches'}
                </p>
                {matches.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      focus(n.id);
                      setQuery('');
                    }}
                  >
                    <span>
                      {symbols[n.kind]} {n.name}
                    </span>
                    <small>{kindNames[n.kind]} ↗</small>
                  </button>
                ))}
                {!matches.length && (
                  <p>Try “checkout”, “PostgreSQL”, or “event”.</p>
                )}
              </div>
            ) : (
              <>
                <div
                  className={styles.tabs}
                  role="group"
                  aria-label="Inspector view"
                >
                  <button
                    type="button"
                    aria-pressed={tab === 'inspect'}
                    onClick={() => setTab('inspect')}
                  >
                    Inspect node
                  </button>
                  <button
                    type="button"
                    aria-pressed={tab === 'language'}
                    onClick={() => setTab('language')}
                  >
                    The language
                  </button>
                </div>
                {tab === 'inspect' ? (
                  <>
                    <div className={styles.selection} data-kind={current.kind}>
                      <p>
                        {symbols[current.kind]} {kindNames[current.kind]}{' '}
                        <span>/{current.id}</span>
                      </p>
                      <h3>{current.name}</h3>
                      <p>{current.subtitle}</p>
                    </div>
                    <dl className={styles.facts}>
                      {current.rows.map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <pre className={styles.code}>{current.code.join('\n')}</pre>
                    <h4>Port contract</h4>
                    <div className={styles.contracts}>
                      {registry.get(current.kind).ports.map((p) => (
                        <div key={p.id}>
                          <span>
                            {p.direction === 'in' ? '←' : '→'} {p.id}
                          </span>
                          <code>{p.type}</code>
                        </div>
                      ))}
                    </div>
                    <h4>
                      Connections <span>{connections.length}</span>
                    </h4>
                    <div className={styles.connectionList}>
                      {connections.map((e) => {
                        const other = nodes.find(
                          (n) =>
                            n.id ===
                            (e.source === selected ? e.target : e.source),
                        )!;
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => focus(other.id)}
                          >
                            <span>
                              {e.source === selected ? '→' : '←'} {other.name}
                            </span>
                            <small>{e.type} ↗</small>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className={styles.language}>
                    <h3>The diagram has rules.</h3>
                    <p>
                      Seven node kinds declare typed ports. Every connection in
                      this graph passes the actual <code>@prnt/dagr-vdsl</code>{' '}
                      registry before layout.
                    </p>
                    <pre
                      className={styles.code}
                    >{`service: {\n  ports: [\n    { id: 'event',\n      direction: 'out',\n      type: 'event' },\n    // request + write ports\n  ],\n  canConnect: sameType\n}`}</pre>
                    <h4>Try a connection</h4>
                    <p>
                      From Checkout’s <code>event</code> output:
                    </p>
                    <label htmlFor={`${arrow}-proposal`}>
                      Destination port
                    </label>
                    <select
                      id={`${arrow}-proposal`}
                      value={proposal}
                      onChange={(e) => setProposal(e.target.value)}
                    >
                      <option value="valid">Shipping events / publish</option>
                      <option value="invalid">Orders / write</option>
                    </select>
                    <p
                      className={styles.verdict}
                      data-ok={check.ok}
                      role="status"
                    >
                      <strong>
                        {check.ok
                          ? '✓ Connection allowed'
                          : '× Connection refused'}
                      </strong>
                      <span>
                        {check.ok
                          ? 'event → event. The port contract matches.'
                          : `${'code' in check ? check.code : ''}: event cannot connect to record.`}
                      </span>
                    </p>
                    <p>
                      This checks a proposal without changing the graph. The
                      application defines the language; Dagr validates its
                      structure.
                    </p>
                    <Link to="/docs/vdsl">Build your own VDSL →</Link>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
        <div className={styles.bottom}>
          <p id={`${arrow}-hint`}>
            Click to inspect. Double-click to zoom. Focus the graph to
            scroll-zoom; drag or arrow keys to pan. + / − zoom, 0 fits, Escape
            releases focus.
          </p>
          <span>Typed with VDSL · Laid out by Dagr · HTML + SVG</span>
        </div>
      </div>
      <div className={styles.after}>
        <p>
          Zoom out for topology. Zoom in for meaning.
          <br />
          <span>
            Illustrative configuration, not live infrastructure or telemetry.
          </span>
        </p>
        <div>
          <button
            type="button"
            onClick={() => {
              focus('order-events');
              setTrace(true);
            }}
          >
            Follow an order ↗
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('language');
            }}
          >
            Explore the language →
          </button>
        </div>
      </div>
      <details className={styles.accessible}>
        <summary>Read all nodes and connections</summary>
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => focus(n.id)}>
                {n.name}
              </button>{' '}
              ({kindNames[n.kind]}):{' '}
              {wires
                .filter((e) => e.source === n.id)
                .map((e) => nodes.find((other) => other.id === e.target)!.name)
                .join(', ') || 'No outgoing connections'}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
