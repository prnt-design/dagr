import { bench, describe } from 'vitest';

import { registerControl } from '@dagr/bench';
import { createSceneMotion } from '../src/scene-motion.js';
import type { SceneMotion, SceneMotionDelta } from '../src/scene-motion.js';
import type { Vec2 } from '../src/types.js';

/**
 * The CPU half of M4.10's springs-in-flight frame: `apply` on a retarget and
 * `advance` on every frame, at 10,000 nodes. The graph and the edge styles are
 * `bench/browser/frame-profile.html`'s, so these entries price the same work
 * that page times in a browser, without the browser.
 */

registerControl();

const COUNT = 10_000;
const SPACING = { x: 130, y: 90 };
const SHIFT = 20;
const BEND = 25;

/**
 * 1/1000 s rather than a 60 Hz frame's 1/60. A step costs the same at either:
 * with the default half-life both keep `w * dt` at or above the 0.01 where
 * `log1pMinusU` switches to its series (0.014 here), so every spring takes the
 * same branch. At 60 Hz a 20 unit move comes to rest in about 35 calls, and a
 * settled spring is skipped, so the measured loop would drift from pricing
 * motion to pricing a still scene. At 1/1000 s it stays in flight for about
 * 590 calls, more than the sampling window below makes on an Apple M4; on a
 * machine fast enough to make more, the bench throws rather than measure a
 * scene at rest.
 */
const DT = 1 / 1000;

/** `bench/README.md`'s longer window for an iteration measured in milliseconds. */
const HEAVY = { time: 3_000 };

function grid(): { home: Vec2[]; links: [number, number][] } {
  const columns = Math.ceil(Math.sqrt(COUNT * 1.5));
  const home: Vec2[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    home.push({ x: (i % columns) * SPACING.x, y: -Math.floor(i / columns) * SPACING.y });
  }
  const links: [number, number][] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const below = i + columns;
    if (below < COUNT) links.push([i, below]);
    if (i % 3 === 0 && below + 1 < COUNT && (i % columns) + 1 < columns) links.push([i, below + 1]);
  }
  return { home, links };
}

const { home, links } = grid();

/** Every node moved by `shift`, every edge rerouted to its moved ends. */
function retarget(shift: number, bend: boolean): SceneMotionDelta {
  const centres = home.map((p) => ({ x: p.x + shift, y: p.y }));
  return {
    nodes: {
      added: [],
      removed: [],
      moved: centres.map((center, i) => ({ id: `n${String(i)}`, center })),
    },
    edges: {
      added: [],
      removed: [],
      rerouted: links.map(([from, to]) => {
        const a = centres[from]!;
        const b = centres[to]!;
        const points = bend ? [a, { x: (a.x + b.x) / 2 + BEND, y: (a.y + b.y) / 2 }, b] : [a, b];
        return { id: `e${String(from)}-${String(to)}`, points };
      }),
    },
  };
}

function atHome(bend: boolean): SceneMotion {
  const motion = createSceneMotion();
  const start = retarget(0, bend);
  motion.resync({ nodes: start.nodes!.moved, edges: start.edges!.rerouted });
  return motion;
}

for (const [style, bend] of [
  ['straight', false],
  ['smooth', true],
] as const) {
  describe(`scene motion, 10k nodes, ${style} edges`, () => {
    const away = [retarget(SHIFT, bend), retarget(-SHIFT, bend)] as const;

    const retargeted = atHome(bend);
    let applies = 0;
    bench(
      'apply: retarget every node and edge',
      () => {
        applies += 1;
        retargeted.apply(away[applies % 2]!);
      },
      HEAVY,
    );

    let moving = atHome(bend);
    let phases = 0;
    bench(
      'advance: one frame, every spring in flight',
      () => {
        if (moving.advance(DT).settled) {
          throw new Error('the springs came to rest inside the measured loop');
        }
      },
      {
        ...HEAVY,
        // Outside the timed loop, before the warm-up and again before the run,
        // so both start from rest with one retarget in flight.
        setup: () => {
          phases += 1;
          moving = atHome(bend);
          moving.apply(away[phases % 2]!);
        },
      },
    );
  });
}
