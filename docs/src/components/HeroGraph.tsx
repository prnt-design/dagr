import type { ReactNode } from 'react';
import styles from './HeroGraph.module.css';
import data from './heroGraphData.json';

// The landing page's hero image is output from the engine it advertises:
// scripts/generate-hero-graph.mjs builds a 20 node DAG, runs `layout` on it,
// and commits the coordinates and routes here. Drawn inline rather than as an
// image so every color resolves from the muslin tokens and follows the theme.
//
// The layout ranks top to bottom; the hero wants landscape, so x and y swap
// and the graph reads left to right. One source-to-sink spine carries the
// accent; everything else stays in the achromatic ramp, which is the token
// system's own rule about where color lives.

const PAD = 10;
// Matches --corner-cut-xs (5px), drawn into the geometry so every browser
// tier sees the cut, not only the ones with corner-shape.
const CUT = 5;

interface HeroNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spine: boolean;
}

interface HeroEdge {
  id: string;
  spine: boolean;
  points: [number, number][];
}

function nodePoints(n: HeroNode): string {
  const x0 = n.y - n.height / 2;
  const y0 = n.x - n.width / 2;
  const x1 = n.y + n.height / 2;
  const y1 = n.x + n.width / 2;
  return [
    `${x0 + CUT},${y0}`,
    `${x1},${y0}`,
    `${x1},${y1 - CUT}`,
    `${x1 - CUT},${y1}`,
    `${x0},${y1}`,
    `${x0},${y0 + CUT}`,
  ].join(' ');
}

export default function HeroGraph(): ReactNode {
  const { bounds } = data;
  const nodes = data.nodes as HeroNode[];
  const edges = data.edges as HeroEdge[];
  const viewBox = [
    bounds.y - PAD,
    bounds.x - PAD,
    bounds.height + PAD * 2,
    bounds.width + PAD * 2,
  ].join(' ');
  return (
    <svg
      className={styles.graph}
      viewBox={viewBox}
      role="img"
      aria-label={
        'A directed acyclic graph of 20 nodes and 34 edges, laid out by the ' +
        'Dagr layout engine: seven ranks left to right, one source-to-sink ' +
        'path highlighted.'
      }
    >
      {edges.map((e) => (
        <polyline
          key={e.id}
          className={e.spine ? styles.edgeSpine : styles.edge}
          points={e.points.map(([x, y]) => `${y},${x}`).join(' ')}
          pathLength={1}
        />
      ))}
      {nodes.map((n) => (
        <polygon
          key={n.id}
          className={n.spine ? styles.nodeSpine : styles.node}
          points={nodePoints(n)}
        />
      ))}
    </svg>
  );
}
