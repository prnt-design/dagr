import { useId, useMemo, useState } from 'react';
import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';
import GraphViewport from '../GraphViewport';
import SvgAdapter from '../GraphViewport/SvgAdapter';
import Board from './Board';
import type { FocusBounds } from '../GraphViewport/useGraphCamera';
import positions from './positions.json';
import styles from './styles.module.css';

const families = [
  'All openings',
  'Italian',
  'Sicilian',
  'French',
  'Queen’s Gambit',
];
const source =
  'https://github.com/lichess-org/chess-openings/tree/c67912be581f0793dbaa776be5ccf111e01f88d9';
const sequence = (moves: string[]) =>
  moves
    .map((move, i) =>
      i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${move}` : move,
    )
    .join(' ');
const shortName = (name: string) =>
  name.includes(':') ? name.split(':').slice(1).join(':').trim() : name;

export default function ChessAtlas() {
  const [focusBounds, setFocusBounds] = useState<FocusBounds | null>(null);
  const [family, setFamily] = useState('All openings');
  const [depth, setDepth] = useState(20);
  const [selected, setSelected] = useState('e2e4_e7e5_g1f3_b8c6_f1c4');
  const arrow = useId().replace(/:/g, '');
  const nodes = useMemo(
    () =>
      positions.filter(
        (node) =>
          node.ply <= depth &&
          (family === 'All openings' || node.families.includes(family)),
      ),
    [family, depth],
  );
  const current = nodes.find((node) => node.id === selected) ?? nodes[0]!;
  const drawing = useMemo(() => {
    const graph = new Graph();
    nodes.forEach((node) => graph.addNode({ id: node.id }));
    nodes.forEach((node) => {
      if (node.parent)
        graph.addEdge({ id: node.id, source: node.parent, target: node.id });
    });
    return layout({
      graph,
      config: {
        defaultNodeSize: { width: 192, height: 238 },
        nodeSep: 42,
        rankSep: 105,
      },
    });
  }, [nodes]);
  const routeIds = new Set<string>();
  let ancestor: (typeof positions)[number] | undefined = current;
  while (ancestor) {
    routeIds.add(ancestor.id);
    ancestor = positions.find((node) => node.id === ancestor?.parent);
  }
  const children = nodes.filter((node) => node.parent === current.id);
  const title =
    current.openings[0]?.name ??
    (current.ply
      ? `After ${current.ply % 2 ? Math.ceil(current.ply / 2) + '.' : current.ply / 2 + '…'} ${current.san}`
      : 'Starting position');
  return (
    <section className={styles.atlas} aria-label="Chess opening atlas">
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>CHESS OPENING ATLAS</p>
          <h2>One position. Many possibilities.</h2>
        </div>
        <p>
          Follow a move. Find the branch.
          <br />
          Explore 24 opening lines as a living map of positions.
        </p>
      </div>
      <div className={styles.filters}>
        <div role="group" aria-label="Opening family">
          {families.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={family === item}
              onClick={() => setFamily(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label>
          Depth{' '}
          <select
            aria-label="Depth"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            <option value={4}>2 moves</option>
            <option value={8}>4 moves</option>
            <option value={12}>6 moves</option>
            <option value={20}>Full lines</option>
          </select>
        </label>
      </div>
      <div className={styles.workbench}>
        <div className={styles.map}>
          <div className={styles.mapHeader}>
            <span>
              {nodes.length} positions · {nodes.length - 1} moves
            </span>
            <span>WHITE AT THE BOTTOM</span>
          </div>
          <GraphViewport
            label="Chess opening graph"
            native
            focusBounds={focusBounds}
          >
            <SvgAdapter
              interactive
              bounds={drawing.bounds}
              label="Opening move tree. Select a position or use the position selector."
            >
              <defs>
                <marker
                  id={arrow}
                  markerWidth="8"
                  markerHeight="8"
                  markerUnits="userSpaceOnUse"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8 Z" fill="var(--atlas-wire)" />
                </marker>
              </defs>
              {nodes
                .filter((node) => node.parent)
                .map((node) => {
                  const points = drawing.edges.get(node.id)!.points;
                  const from = points[0]!,
                    to = points[points.length - 1]!;
                  const mid = {
                    x: (from.x + to.x) / 2,
                    y: (from.y + to.y) / 2,
                  };
                  return (
                    <g
                      key={node.id}
                      className={
                        routeIds.has(node.id) ? styles.activeEdge : styles.edge
                      }
                    >
                      <path
                        d={points
                          .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
                          .join(' ')}
                        markerEnd={`url(#${arrow})`}
                      />
                      <rect
                        x={mid.x - 35}
                        y={mid.y - 14}
                        width={70}
                        height={28}
                      />
                      <text x={mid.x} y={mid.y + 6} textAnchor="middle">
                        {node.san}
                      </text>
                    </g>
                  );
                })}
              {nodes.map((node) => {
                const box = drawing.nodes.get(node.id)!;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${box.x - 96},${box.y - 119})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.openings[0]?.name ?? 'Position'}: ${sequence(node.moves) || 'Start'}`}
                    aria-pressed={current.id === node.id}
                    className={`${styles.node} ${routeIds.has(node.id) ? styles.onPath : ''}`}
                    onClick={() => setSelected(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(node.id);
                      }
                    }}
                  >
                    <rect className={styles.nodeBox} width={192} height={238} />
                    <text x={16} y={24} className={styles.nodeTitle}>
                      {node.ply
                        ? `${node.ply % 2 ? Math.ceil(node.ply / 2) + '.' : node.ply / 2 + '…'} ${node.san}`
                        : 'Initial position'}
                    </text>
                    <g transform="translate(16,38)">
                      <Board board={node.board} lastMove={node.lastMove} />
                    </g>
                    <text x={16} y={219} className={styles.nodeMeta}>
                      {node.openings[0]?.eco ?? `${node.turn} to move`}
                    </text>
                    <title>
                      {node.openings.map((item) => item.name).join(' / ') ||
                        sequence(node.moves) ||
                        'Starting position'}
                    </title>
                  </g>
                );
              })}
            </SvgAdapter>
          </GraphViewport>
        </div>
        <aside
          className={styles.inspector}
          aria-label="Selected chess position"
        >
          <label>
            Inspect a position
            <select
              aria-label="Inspect a position"
              value={current.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.openings[0]?.name ?? (sequence(node.moves) || 'Start')}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.kicker}>
            {current.turn.toUpperCase()} TO MOVE · PLY {current.ply}
          </p>
          <h3>{title}</h3>
          <button
            type="button"
            onClick={() => {
              const box = drawing.nodes.get(current.id)!;
              setFocusBounds({
                x: box.x - drawing.bounds.x - 240,
                y: box.y - drawing.bounds.y - 300,
                width: 480,
                height: 600,
              });
            }}
          >
            Focus this position
          </button>
          <div className={styles.board}>
            <Board
              board={current.board}
              lastMove={current.lastMove}
              size={256}
            />
          </div>
          <p className={styles.sequence}>
            {sequence(current.moves) || 'The board before the first move.'}
          </p>
          <div className={styles.next}>
            <h4>
              {children.length ? 'Continue the line' : 'End of this branch'}
            </h4>
            {children.map((node) => (
              <button
                type="button"
                key={node.id}
                onClick={() => setSelected(node.id)}
              >
                {node.san}
                <span>
                  {node.openings[0]
                    ? shortName(node.openings[0].name)
                    : `${node.turn} to move`}
                </span>
                →
              </button>
            ))}
            {!children.length && (
              <p>
                {positions.some((node) => node.parent === current.id)
                  ? 'Increase depth to see the next moves.'
                  : 'This curated line ends here. The game continues.'}
              </p>
            )}
            {current.parent && (
              <button
                type="button"
                onClick={() => setSelected(current.parent!)}
              >
                ← Previous position
              </button>
            )}
          </div>
          <details className={styles.fen}>
            <summary>Position notation (FEN)</summary>
            <code>{current.fen}</code>
          </details>
          <a
            href={`https://lichess.org/analysis/standard/${current.fen.replace(/ /g, '_')}`}
            target="_blank"
            rel="noreferrer"
          >
            Open this board in Lichess ↗
          </a>
        </aside>
      </div>
      <p className={styles.caption}>
        Boards are replayed from legal moves in the{' '}
        <a href={source}>Lichess opening dataset</a> (CC0). Dagr lays out and
        routes this move tree; SVG keeps boards crisp at any zoom. This is a
        curated atlas, not an engine evaluation. Different move orders stay
        separate.
      </p>
    </section>
  );
}
