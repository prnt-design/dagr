import { bench, describe } from 'vitest';

import { registerControl } from '@dagr/bench';
import { createRichNodes } from '@prnt/dagr-render';
import type { HtmlOverlay, SceneNode } from '@prnt/dagr-render';
import { createTierFeed } from '../src/tier-feed.js';

registerControl();

const COUNT = 10_000;
const MOVING = 100;

function scene(shift: number): SceneNode[] {
  const columns = 100;
  return Array.from({ length: COUNT }, (_, index) => ({
    id: `node-${String(index)}`,
    shape: 'roundedRect',
    // The first MOVING nodes are mid-glide; the rest stand still.
    center: { x: (index % columns) * 120 + (index < MOVING ? shift : 0), y: Math.floor(index / columns) * 90 },
    size: { width: 100, height: 60 },
    fillColor: 0,
    glowColor: 0,
    glowWorld: 0,
  }));
}

/** An overlay that records nothing: the cost measured is the feed's and the tiers' bookkeeping. */
const overlay = {
  add: () => ({ place() {}, remove() {} }),
  sync() {},
  dispose() {},
} as unknown as HtmlOverlay;

function feedWithTiers() {
  const rich = createRichNodes<unknown>({
    overlay,
    tiers: [{ name: 'card', minScreenWidth: 20, create: () => ({}) as HTMLElement, update() {} }],
  });
  return createTierFeed(rich, () => undefined);
}

describe('animated frame feeding tiers, 10k nodes, 100 in motion', () => {
  const frames = [scene(1), scene(2)];
  const feed = feedWithTiers();
  feed.full(frames[0]!);
  let tick = 0;
  bench('step: only what moved', () => {
    tick += 1;
    feed.step(frames[tick % 2]!);
  });
  const whole = feedWithTiers();
  whole.full(frames[0]!);
  bench('full: every node (the old per-frame cost)', () => {
    tick += 1;
    whole.full(frames[tick % 2]!);
  });
});
