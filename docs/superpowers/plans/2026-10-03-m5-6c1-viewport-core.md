# M5.6c-1 explorer viewport core implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@prnt/dagr-explorer` the pure half of its viewport: camera
arithmetic, the visible set that virtualizes node content, and the lookup from
a point to a node.

**Architecture:** Two internal modules with no DOM and no clock. `camera.ts`
is functions from a camera to a camera, with limits supplied by `Camera2D`.
`visible-set.ts` decides, for a camera, which nodes get an element at which
tier, which are left to the base layer, and which edges are in view. The React
viewport in M5.6c-2 owns the animation frame and the DOM and calls these.

**Tech Stack:** TypeScript, Vitest, `@prnt/dagr-render/core`

**Spec:** `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`, sections
"Tiers and virtualization" and "Camera and pointer". M5.6c is split in two: this
plan is the pure core, and M5.6c-2 is the React viewport built on it.

## Global constraints

- Both modules are INTERNAL. Nothing is added to `packages/explorer/src/index.ts`,
  and `test/index.test.ts` keeps pinning the same ten runtime names.
- Never import `@prnt/dagr-render` (the full entry), `@prnt/dagr-react`, or
  `three`. From the renderer, import only `@prnt/dagr-render/core`.
- No DOM globals, no `requestAnimationFrame`, no `performance`. These modules
  run in Node.
- A camera is `{ x, y, scale }`: the plane's `translate(x, y) scale(scale)`,
  in CSS pixels, over a y-down world.
- Tier gates, exact: `summary` `56`, `rich` `200`, half-open (exactly at a gate
  is the higher tier). Overlay cap `200`. Overscan `0.25` of the viewport on
  each side.
- A pinned node is always an overlay node, exempt from the cap, at least
  `summary`.
- Focus margin `24` per side, reveal margin `12`, easing constant `55` ms with
  a frame clamped to `64` ms, content padding `0.05`.
- No em-dashes in any prose: comments, docs, commit messages, the pull request.
- Commits: conventional subject, author `Dagr Agent <agent@prnt.design>`
  (repo-local git config), trailer
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Work reaches `main` only through a pull request, per `AGENTS.md`.

## Review focus

- **A viewport with no size, or a layout with no content.** The viewport is
  measured after mount and is 0 by 0 before that. `createCameraLimits` must
  return `null`, not divide by zero. Pinned in Task 1.
- **A pinned id the layout does not have** (the selected node was removed from
  the data a frame ago). It must be ignored, not mounted. Pinned in Task 2.
- **A cap smaller than the number of pinned nodes, and a cap of zero.** Pins
  are exempt, and zero means no overlay. Pinned in Task 2.
- **A frame far longer than a frame** (a backgrounded tab resuming). The ease
  must not jump: the elapsed time is clamped. Pinned in Task 1.
- **A node larger than the viewport being revealed.** It cannot fit inside the
  margin, so it is centered. Pinned in Task 1.

Every expected number in the tests below was measured by running this exact
code against `layoutView` on 2026-10-03. If a number is off, the layout or
`Camera2D` changed: stop and report it, do not edit the number.

---

### Task 1: Camera arithmetic

**Files:**
- Create: `packages/explorer/src/camera.ts`
- Test: `packages/explorer/test/camera.test.ts`

**Interfaces:**
- Consumes: `ExplorerBox`, `ExplorerLayout` from `./layout.js`. `Camera2D`,
  `fitZoom` and the type `Vec2` from `@prnt/dagr-render/core`.
- Produces, all from `packages/explorer/src/camera.ts`:
  - `interface ExplorerCamera { readonly x: number; readonly y: number; readonly scale: number }`
  - `interface ExplorerViewportSize { readonly width: number; readonly height: number }`
  - `interface CameraLimits { readonly minScale: number; readonly maxScale: number; constrain(camera: ExplorerCamera): ExplorerCamera }`
  - `createCameraLimits(layout, viewport): CameraLimits | null`
  - `fitCamera(layout, viewport, limits): ExplorerCamera`
  - `zoomCamera(camera, factor, anchor: Vec2, limits): ExplorerCamera`
  - `panCamera(camera, dx, dy): ExplorerCamera`
  - `focusCamera(box: ExplorerBox, viewport, limits): ExplorerCamera`
  - `revealCamera(camera, box: ExplorerBox, viewport): ExplorerCamera`
  - `visibleWorld(camera, viewport): ExplorerBox`
  - `screenToWorld(camera, point: Vec2): Vec2`
  - `easeCamera(current, target, elapsedMs): ExplorerCamera`
  - `cameraSettled(current, target): boolean`
  - constants `CONTENT_PADDING`, `FOCUS_MARGIN`, `REVEAL_MARGIN`, `EASE_MS`

- [ ] **Step 1: Write the failing test**

Create `packages/explorer/test/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/index.js';
import type { ExplorerBox } from '../src/index.js';
import {
  cameraSettled,
  createCameraLimits,
  easeCamera,
  fitCamera,
  focusCamera,
  panCamera,
  revealCamera,
  screenToWorld,
  visibleWorld,
  zoomCamera,
} from '../src/camera.js';
import type { CameraLimits } from '../src/camera.js';

/** a -> b -> c with default sizes: a plane 1040 by 200, boxes 240 by 120. */
const chain = layoutView({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
  ],
});
const viewport = { width: 800, height: 480 };

function limitsOf(): CameraLimits {
  const limits = createCameraLimits(chain, viewport);
  if (limits === null) throw new Error('no limits');
  return limits;
}

function boxOf(id: string): ExplorerBox {
  const box = chain.boxes.get(id);
  if (box === undefined) throw new Error(`no box for ${id}`);
  return box;
}

describe('createCameraLimits', () => {
  it('fits the whole plane at the floor and one node at the ceiling', () => {
    const limits = limitsOf();
    // 800 * 0.9 / 1040: the plane's width, with 5% of the viewport left each side.
    expect(limits.minScale).toBeCloseTo(0.6923, 4);
    // min(800 / 240, 480 / 120) * 0.9: one 240 by 120 node fills the viewport.
    expect(limits.maxScale).toBeCloseTo(3, 6);
  });

  it('has nothing to limit without a viewport or without content', () => {
    expect(createCameraLimits(chain, { width: 0, height: 480 })).toBeNull();
    expect(createCameraLimits(chain, { width: 800, height: 0 })).toBeNull();
    const empty = layoutView({ id: 'v', label: 'View', nodes: [], edges: [] });
    expect(createCameraLimits(empty, viewport)).toBeNull();
  });

  it('pulls a camera panned far away back to the content', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    for (const lost of [panCamera(fit, 5000, 5000), panCamera(fit, -5000, -5000)]) {
      const back = limits.constrain(lost);
      expect(back.x).toBeCloseTo(fit.x, 6);
      expect(back.y).toBeCloseTo(fit.y, 6);
      expect(back.scale).toBeCloseTo(fit.scale, 6);
    }
  });

  it('clamps a scale outside the range', () => {
    const limits = limitsOf();
    expect(limits.constrain({ x: 0, y: 0, scale: 100 }).scale).toBeCloseTo(3, 6);
    expect(limits.constrain({ x: 0, y: 0, scale: 0.001 }).scale).toBeCloseTo(0.6923, 4);
  });
});

describe('fitCamera', () => {
  it('centers the plane at the floor scale, and is already inside the limits', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    expect(fit.scale).toBeCloseTo(0.6923, 4);
    expect(fit.x).toBeCloseTo(40, 6);
    expect(fit.y).toBeCloseTo(170.7692, 4);
    const constrained = limits.constrain(fit);
    expect(constrained.x).toBeCloseTo(fit.x, 6);
    expect(constrained.y).toBeCloseTo(fit.y, 6);
  });
});

describe('zoomCamera', () => {
  it('keeps the world point under the anchor where it was', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    const anchor = { x: 400, y: 240 };
    const before = screenToWorld(fit, anchor);
    const zoomed = zoomCamera(fit, 2, anchor, limits);
    expect(zoomed.scale).toBeCloseTo(1.3846, 4);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('stops at the floor and the ceiling', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    expect(zoomCamera(fit, 0.5, { x: 400, y: 240 }, limits)).toEqual(fit);
    expect(zoomCamera(fit, 100, { x: 0, y: 0 }, limits).scale).toBeCloseTo(3, 6);
  });
});

describe('focusCamera', () => {
  it('centers a node and fills the viewport with it, up to the ceiling', () => {
    const limits = limitsOf();
    const camera = focusCamera(boxOf('b'), viewport, limits);
    // (800 - 48) / 240 is 3.13, over the ceiling, so 3.
    expect(camera.scale).toBeCloseTo(3, 6);
    // b's center is (520, 100): 400 - 520 * 3 and 240 - 100 * 3.
    expect(camera.x).toBeCloseTo(-1160, 6);
    expect(camera.y).toBeCloseTo(-60, 6);
  });
});

describe('revealCamera', () => {
  const one = { x: 0, y: 0, scale: 1 };

  it('does not move for a node already inside the margin', () => {
    expect(revealCamera(one, boxOf('a'), viewport)).toEqual(one);
  });

  it('pans the least distance that brings a node 12 inside the edge', () => {
    // c spans 760 to 1000. The viewport is 800 wide, so it must move 1000 - 788.
    expect(revealCamera(one, boxOf('c'), viewport)).toEqual({ x: -212, y: 0, scale: 1 });
  });

  it('centers a node that is larger than the viewport', () => {
    // At scale 4, a is 960 by 480 on screen, centered on (640, 400).
    expect(revealCamera({ x: 0, y: 0, scale: 4 }, boxOf('a'), viewport)).toEqual({
      x: -240,
      y: -160,
      scale: 4,
    });
  });

  it('never changes the scale', () => {
    expect(revealCamera({ x: 0, y: 0, scale: 2 }, boxOf('c'), viewport).scale).toBe(2);
  });
});

describe('visibleWorld and screenToWorld', () => {
  it('invert the plane transform', () => {
    const camera = { x: 40, y: -20, scale: 2 };
    expect(visibleWorld(camera, viewport)).toEqual({ x: -20, y: 10, width: 400, height: 240 });
    expect(screenToWorld(camera, { x: 40, y: -20 })).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(camera, { x: 240, y: 180 })).toEqual({ x: 100, y: 100 });
  });
});

describe('easeCamera and cameraSettled', () => {
  const from = { x: 0, y: 0, scale: 1 };
  const to = { x: 100, y: 50, scale: 2 };

  it('moves part of the way, more for a longer frame', () => {
    const short = easeCamera(from, to, 16);
    expect(short.x).toBeCloseTo(25.2416, 4);
    expect(short.y).toBeCloseTo(12.6208, 4);
    expect(short.scale).toBeCloseTo(1.2524, 4);
    expect(easeCamera(from, to, 32).x).toBeGreaterThan(short.x);
  });

  it('treats a frame longer than 64ms as 64ms, so a stalled tab does not jump', () => {
    expect(easeCamera(from, to, 1000)).toEqual(easeCamera(from, to, 64));
  });

  it('does not move for a zero or negative frame', () => {
    expect(easeCamera(from, to, 0)).toEqual(from);
    expect(easeCamera(from, to, -5)).toEqual(from);
  });

  it('settles within a twentieth of a pixel and a ten-thousandth of scale', () => {
    expect(cameraSettled(to, to)).toBe(true);
    expect(cameraSettled({ x: 100.02, y: 50.02, scale: 2 }, to)).toBe(true);
    expect(cameraSettled({ x: 100.1, y: 50, scale: 2 }, to)).toBe(false);
    expect(cameraSettled({ x: 100, y: 50, scale: 2.001 }, to)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @prnt/dagr-explorer exec vitest run test/camera.test.ts`

Expected: FAIL. `../src/camera.js` cannot be resolved.

- [ ] **Step 3: Write the module**

Create `packages/explorer/src/camera.ts`:

```ts
/**
 * The camera's arithmetic, with no DOM and no clock.
 *
 * A camera is the plane's CSS transform: `translate(x, y) scale(scale)`, in
 * CSS pixels, over a world that is y-down. Everything here is a pure function
 * from a camera to a camera, so the hook that owns the animation frame holds
 * no arithmetic of its own and all of it is testable in Node.
 *
 * **Functions return the camera that was ASKED for, not the one allowed.**
 * `CameraLimits.constrain` is the one place a camera is clamped, and the
 * caller decides when: a target is constrained when it is set, and the eased
 * camera again when it is drawn, so a flight can cross a sparse gap without
 * being trapped against the nearest node on the way.
 *
 * Limits come from `Camera2D` in `@prnt/dagr-render/core`, which speaks a
 * y-up world with a center and a zoom. The conversion to and from this
 * module's top-left, y-down camera lives in `createCameraLimits` and nowhere
 * else.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import { Camera2D, fitZoom } from '@prnt/dagr-render/core';
import type { ExplorerBox, ExplorerLayout } from './layout.js';
import type { Vec2 } from '@prnt/dagr-render/core';

export interface ExplorerCamera { readonly x: number; readonly y: number; readonly scale: number }
export interface ExplorerViewportSize { readonly width: number; readonly height: number }
export interface CameraLimits {
  readonly minScale: number;
  readonly maxScale: number;
  constrain(camera: ExplorerCamera): ExplorerCamera;
}

export const CONTENT_PADDING = 0.05;
export const FOCUS_MARGIN = 24;
export const REVEAL_MARGIN = 12;
export const EASE_MS = 55;

export function createCameraLimits(layout: ExplorerLayout, viewport: ExplorerViewportSize): CameraLimits | null {
  if (!(viewport.width > 0) || !(viewport.height > 0) || !(layout.width > 0) || !(layout.height > 0)) return null;
  const limiter = new Camera2D({ viewport: { width: viewport.width, height: viewport.height, devicePixelRatio: 1 } });
  let detail = { width: 160, height: 80 };
  let best = 0;
  const regions = [];
  for (const box of layout.boxes.values()) {
    const zoom = fitZoom({ minX: 0, minY: 0, maxX: box.width, maxY: box.height }, limiter.viewport);
    if (zoom > best) { best = zoom; detail = { width: box.width, height: box.height }; }
    regions.push({ minX: box.x, maxX: box.x + box.width, minY: -box.y - box.height, maxY: -box.y });
  }
  limiter.setContentBounds({ minX: 0, maxX: layout.width, minY: -layout.height, maxY: 0 }, detail, CONTENT_PADDING, regions);
  return {
    minScale: limiter.minZoom,
    maxScale: limiter.maxZoom,
    constrain(camera) {
      limiter.setZoom(camera.scale);
      limiter.setCenter({ x: (viewport.width / 2 - camera.x) / limiter.zoom, y: -(viewport.height / 2 - camera.y) / limiter.zoom });
      return { x: viewport.width / 2 - limiter.center.x * limiter.zoom, y: viewport.height / 2 + limiter.center.y * limiter.zoom, scale: limiter.zoom };
    },
  };
}

export function fitCamera(layout: ExplorerLayout, viewport: ExplorerViewportSize, limits: CameraLimits): ExplorerCamera {
  const scale = limits.minScale;
  return { x: (viewport.width - layout.width * scale) / 2, y: (viewport.height - layout.height * scale) / 2, scale };
}
export function zoomCamera(camera: ExplorerCamera, factor: number, anchor: Vec2, limits: CameraLimits): ExplorerCamera {
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, camera.scale * factor));
  const ratio = scale / camera.scale;
  return { x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio, scale };
}
export function panCamera(camera: ExplorerCamera, dx: number, dy: number): ExplorerCamera {
  return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}
export function focusCamera(box: ExplorerBox, viewport: ExplorerViewportSize, limits: CameraLimits): ExplorerCamera {
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, Math.min((viewport.width - FOCUS_MARGIN * 2) / box.width, (viewport.height - FOCUS_MARGIN * 2) / box.height)));
  return { x: viewport.width / 2 - (box.x + box.width / 2) * scale, y: viewport.height / 2 - (box.y + box.height / 2) * scale, scale };
}
export function revealCamera(camera: ExplorerCamera, box: ExplorerBox, viewport: ExplorerViewportSize): ExplorerCamera {
  const axis = (offset: number, start: number, size: number, extent: number): number => {
    const lo = offset + start * camera.scale;
    const hi = lo + size * camera.scale;
    if (hi - lo > extent - REVEAL_MARGIN * 2) return offset + (extent / 2 - (lo + hi) / 2);
    if (lo < REVEAL_MARGIN) return offset + (REVEAL_MARGIN - lo);
    if (hi > extent - REVEAL_MARGIN) return offset + (extent - REVEAL_MARGIN - hi);
    return offset;
  };
  return { x: axis(camera.x, box.x, box.width, viewport.width), y: axis(camera.y, box.y, box.height, viewport.height), scale: camera.scale };
}
export function visibleWorld(camera: ExplorerCamera, viewport: ExplorerViewportSize): ExplorerBox {
  return { x: -camera.x / camera.scale, y: -camera.y / camera.scale, width: viewport.width / camera.scale, height: viewport.height / camera.scale };
}
export function screenToWorld(camera: ExplorerCamera, point: Vec2): Vec2 {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}
export function easeCamera(current: ExplorerCamera, target: ExplorerCamera, elapsedMs: number): ExplorerCamera {
  const alpha = 1 - Math.exp(-Math.max(0, Math.min(64, elapsedMs)) / EASE_MS);
  return { x: current.x + (target.x - current.x) * alpha, y: current.y + (target.y - current.y) * alpha, scale: current.scale + (target.scale - current.scale) * alpha };
}
export function cameraSettled(current: ExplorerCamera, target: ExplorerCamera): boolean {
  return Math.abs(current.x - target.x) + Math.abs(current.y - target.y) < 0.05 && Math.abs(current.scale - target.scale) < 0.0001;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @prnt/dagr-explorer exec vitest run test/camera.test.ts`

Expected: PASS, 17 tests.

Run: `pnpm --filter @prnt/dagr-explorer typecheck` and `pnpm exec eslint packages/explorer`

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/explorer/src/camera.ts packages/explorer/test/camera.test.ts
git commit -F - <<'EOF'
feat(explorer): add the camera's arithmetic as pure functions

The viewport that comes next owns an animation frame and a DOM node. It
should own no arithmetic. Fit, zoom about an anchor, pan, focus a node,
reveal a node by the least pan, and the ease toward a target are each a
function from a camera to a camera, testable in Node.

Limits come from Camera2D, which speaks a y-up world with a center and
a zoom. The conversion to this package's top-left, y-down camera lives
in createCameraLimits and nowhere else. A viewport with no size, which
is every viewport before it is measured, has no limits.

Internal: nothing is added to the package entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The visible set, and the lookup from a point to a node

**Files:**
- Create: `packages/explorer/src/visible-set.ts`
- Test: `packages/explorer/test/visible-set.test.ts`

**Interfaces:**
- Consumes: `visibleWorld`, `ExplorerCamera`, `ExplorerViewportSize` from
  `./camera.js` (Task 1). `ExplorerBox`, `ExplorerLayout` from `./layout.js`.
  `ExplorerLayout.routes` maps an edge id to its points, and a self loop's
  route is empty.
- Produces, all from `packages/explorer/src/visible-set.ts`:
  - `type ExplorerTier = 'summary' | 'rich'`
  - `interface ExplorerTiers { readonly summary: number; readonly rich: number }`
  - `interface LayoutIndex { nodeIds, nodeBoxes, edgeIds, edgeBounds }` (parallel arrays, data order)
  - `indexLayout(layout): LayoutIndex`
  - `interface VisibleSetOptions { tiers?, maxOverlayNodes?, pinned? }`
  - `interface ExplorerVisibleSet { overlay: ReadonlyMap<string, ExplorerTier>; baseNodes: readonly string[]; edges: readonly string[] }`
  - `computeVisibleSet(index, camera, viewport, options?): ExplorerVisibleSet`
  - `sameVisibleSet(a, b): boolean`
  - `nearestToCenter(index, camera, viewport): string | null`
  - `nodeAtPoint(index, point: Vec2): string | null`
  - constants `DEFAULT_TIERS`, `DEFAULT_MAX_OVERLAY_NODES`, `OVERSCAN`

- [ ] **Step 1: Write the failing test**

Create `packages/explorer/test/visible-set.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/index.js';
import {
  computeVisibleSet,
  indexLayout,
  nearestToCenter,
  nodeAtPoint,
  sameVisibleSet,
} from '../src/visible-set.js';
import type { ExplorerVisibleSet } from '../src/visible-set.js';

/**
 * a -> b -> c with default sizes, plus a self loop on a. Boxes are 240 by 120
 * at x 40, 400 and 760, all at y 40. The plane is 1040 by 200.
 */
const chain = layoutView({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'aa', source: 'a', target: 'a' },
  ],
});
const index = indexLayout(chain);
const viewport = { width: 800, height: 480 };
/** The whole plane in view, a node 166 wide on screen. */
const fit = { x: 40, y: 170.76923076923077, scale: 0.6923076923076924 };
const one = { x: 0, y: 0, scale: 1 };

const show = (set: ExplorerVisibleSet) => ({
  overlay: [...set.overlay],
  base: set.baseNodes,
  edges: set.edges,
});

describe('indexLayout', () => {
  it('lists nodes and edges in data order, with each route bounded', () => {
    expect(index.nodeIds).toEqual(['a', 'b', 'c']);
    expect(index.edgeIds).toEqual(['ab', 'bc', 'aa']);
    expect(index.edgeBounds[0]).toEqual({ x: 280, y: 100, width: 120, height: 0 });
  });

  it('gives an edge with no route no bounds', () => {
    expect(index.edgeBounds[2]).toBeNull();
  });
});

describe('computeVisibleSet, tiers', () => {
  it('shows a node as rich at 200 on screen and over', () => {
    expect(show(computeVisibleSet(index, one, viewport))).toEqual({
      overlay: [
        ['a', 'rich'],
        ['b', 'rich'],
        ['c', 'rich'],
      ],
      base: [],
      edges: ['ab', 'bc'],
    });
  });

  it('shows a node as summary from 56 up to 200', () => {
    expect([...computeVisibleSet(index, fit, viewport).overlay.values()]).toEqual([
      'summary',
      'summary',
      'summary',
    ]);
  });

  it('leaves a node under 56 to the base layer, with no overlay element', () => {
    // 240 * 0.2 is 48.
    expect(show(computeVisibleSet(index, { x: 0, y: 0, scale: 0.2 }, viewport))).toEqual({
      overlay: [],
      base: ['a', 'b', 'c'],
      edges: ['ab', 'bc'],
    });
  });

  it('has half-open gates: exactly at a gate is the higher tier', () => {
    const exact = { tiers: { summary: 240, rich: 241 } };
    expect([...computeVisibleSet(index, one, viewport, exact).overlay.values()][0]).toBe('summary');
    const rich = { tiers: { summary: 100, rich: 240 } };
    expect([...computeVisibleSet(index, one, viewport, rich).overlay.values()][0]).toBe('rich');
  });
});

describe('computeVisibleSet, culling', () => {
  it('drops nodes and edges outside the viewport and its overscan', () => {
    // At scale 3 the viewport shows 267 world units, plus a quarter each side.
    expect(show(computeVisibleSet(index, { x: 0, y: 0, scale: 3 }, viewport))).toEqual({
      overlay: [['a', 'rich']],
      base: [],
      edges: ['ab'],
    });
  });

  it('is empty when the camera is nowhere near the content', () => {
    expect(show(computeVisibleSet(index, { x: -5000, y: 0, scale: 1 }, viewport))).toEqual({
      overlay: [],
      base: [],
      edges: [],
    });
  });

  it('never lists a self loop, which has no route', () => {
    expect(computeVisibleSet(index, one, viewport).edges).not.toContain('aa');
  });

  it('does not change for a pan inside the overscan margin', () => {
    const before = computeVisibleSet(index, fit, viewport);
    const after = computeVisibleSet(index, { ...fit, x: fit.x + 10 }, viewport);
    expect(sameVisibleSet(before, after)).toBe(true);
  });
});

describe('computeVisibleSet, the cap', () => {
  it('keeps the nodes nearest the viewport center and leaves the rest as marks', () => {
    expect(show(computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 1 }))).toEqual({
      overlay: [['b', 'summary']],
      base: ['a', 'c'],
      edges: ['ab', 'bc'],
    });
  });

  it('breaks a tie in distance by id', () => {
    // a and c are equally far from the center. With room for two, b and a.
    const set = computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 2 });
    expect([...set.overlay.keys()]).toEqual(['a', 'b']);
  });

  it('treats a cap of zero as no overlay at all', () => {
    expect(computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 0 }).overlay.size).toBe(0);
  });
});

describe('computeVisibleSet, pins', () => {
  it('mounts a pinned node that is too small to read, as summary', () => {
    const tiny = { x: 0, y: 0, scale: 0.2 };
    expect(show(computeVisibleSet(index, tiny, viewport, { pinned: ['b'] }))).toEqual({
      overlay: [['b', 'summary']],
      base: ['a', 'c'],
      edges: ['ab', 'bc'],
    });
  });

  it('mounts a pinned node that is off screen, at the tier its size earns', () => {
    const far = { x: -5000, y: 0, scale: 1 };
    expect(show(computeVisibleSet(index, far, viewport, { pinned: ['c'] }))).toEqual({
      overlay: [['c', 'rich']],
      base: [],
      edges: [],
    });
  });

  it('does not count a pinned node against the cap', () => {
    const set = computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 1, pinned: ['a'] });
    expect([...set.overlay.keys()]).toEqual(['a', 'b']);
    expect(set.baseNodes).toEqual(['c']);
  });

  it('ignores a pinned id the layout does not have', () => {
    expect(computeVisibleSet(index, fit, viewport, { pinned: ['ghost'] }).overlay.has('ghost')).toBe(
      false,
    );
  });
});

describe('sameVisibleSet', () => {
  it('compares membership, tier and order, not identity', () => {
    const a = computeVisibleSet(index, fit, viewport);
    expect(sameVisibleSet(a, a)).toBe(true);
    expect(sameVisibleSet(a, computeVisibleSet(index, fit, viewport))).toBe(true);
    expect(sameVisibleSet(a, computeVisibleSet(index, one, viewport))).toBe(false);
    expect(sameVisibleSet(a, computeVisibleSet(index, { x: 0, y: 0, scale: 0.2 }, viewport))).toBe(
      false,
    );
  });
});

describe('nearestToCenter', () => {
  it('names the node whose center is nearest the middle of the viewport', () => {
    expect(nearestToCenter(index, fit, viewport)).toBe('b');
    expect(nearestToCenter(index, { x: 0, y: 0, scale: 3 }, viewport)).toBe('a');
  });

  it('has nothing to name in an empty layout', () => {
    const empty = indexLayout(layoutView({ id: 'v', label: 'View', nodes: [], edges: [] }));
    expect(nearestToCenter(empty, one, viewport)).toBeNull();
  });
});

describe('nodeAtPoint', () => {
  it('finds the node under a world point, edges of the box included', () => {
    expect(nodeAtPoint(index, { x: 50, y: 50 })).toBe('a');
    expect(nodeAtPoint(index, { x: 280, y: 160 })).toBe('a');
  });

  it('finds nothing between nodes', () => {
    expect(nodeAtPoint(index, { x: 300, y: 100 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @prnt/dagr-explorer exec vitest run test/visible-set.test.ts`

Expected: FAIL. `../src/visible-set.js` cannot be resolved.

- [ ] **Step 3: Write the module**

Create `packages/explorer/src/visible-set.ts`:

```ts
/**
 * Which nodes get a DOM element, which are left to the base layer, and which
 * edges are in view: the explorer's virtualization, as one pure function.
 *
 * A node's tier comes from its width on screen in CSS pixels, with half-open
 * gates, the rule `@prnt/dagr-render`'s rich nodes use. Below the `summary`
 * gate it is a mark and has NO element: the base layer draws it.
 *
 * **The scan is linear on purpose.** Testing 10,000 boxes costs tens of
 * microseconds. The renderer's overlay scans the same way and names a spatial
 * index as the fix if a measurement ever asks for one.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import type { ExplorerBox, ExplorerLayout } from './layout.js';
import type { Vec2 } from '@prnt/dagr-render/core';
import { visibleWorld } from './camera.js';
import type { ExplorerCamera, ExplorerViewportSize } from './camera.js';

export type ExplorerTier = 'summary' | 'rich';
export interface ExplorerTiers { readonly summary: number; readonly rich: number }
export const DEFAULT_TIERS: ExplorerTiers = Object.freeze({ summary: 56, rich: 200 });
export const DEFAULT_MAX_OVERLAY_NODES = 200;
export const OVERSCAN = 0.25;

export interface LayoutIndex {
  readonly nodeIds: readonly string[];
  readonly nodeBoxes: readonly ExplorerBox[];
  readonly edgeIds: readonly string[];
  /** `null` for an edge with no route, which is never in view. */
  readonly edgeBounds: readonly (ExplorerBox | null)[];
}

export function indexLayout(layout: ExplorerLayout): LayoutIndex {
  const edgeIds: string[] = [];
  const edgeBounds: (ExplorerBox | null)[] = [];
  for (const [id, points] of layout.routes) {
    edgeIds.push(id);
    if (points.length === 0) { edgeBounds.push(null); continue; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    edgeBounds.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }
  return { nodeIds: [...layout.boxes.keys()], nodeBoxes: [...layout.boxes.values()], edgeIds, edgeBounds };
}

export interface VisibleSetOptions {
  readonly tiers?: ExplorerTiers | undefined;
  readonly maxOverlayNodes?: number | undefined;
  /** Node ids that are always overlay nodes, exempt from the cap. */
  readonly pinned?: readonly string[] | undefined;
}

export interface ExplorerVisibleSet {
  /** Overlay nodes and their tier, in data order. */
  readonly overlay: ReadonlyMap<string, ExplorerTier>;
  /** Nodes in view that the base layer draws as marks, in data order. */
  readonly baseNodes: readonly string[];
  /** Edges whose route is in view, in data order. */
  readonly edges: readonly string[];
}

/** Inclusive: boxes that only touch count, so a hairline route is not culled. */
function intersects(a: ExplorerBox, b: ExplorerBox): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function computeVisibleSet(index: LayoutIndex, camera: ExplorerCamera, viewport: ExplorerViewportSize, options: VisibleSetOptions = {}): ExplorerVisibleSet {
  const tiers = options.tiers ?? DEFAULT_TIERS;
  const cap = options.maxOverlayNodes ?? DEFAULT_MAX_OVERLAY_NODES;
  const pinned = new Set(options.pinned ?? []);
  const world = visibleWorld(camera, viewport);
  const view: ExplorerBox = {
    x: world.x - world.width * OVERSCAN,
    y: world.y - world.height * OVERSCAN,
    width: world.width * (1 + OVERSCAN * 2),
    height: world.height * (1 + OVERSCAN * 2),
  };
  const centerX = world.x + world.width / 2;
  const centerY = world.y + world.height / 2;

  const tierOf = new Map<number, ExplorerTier>();
  const candidates: { readonly i: number; readonly distance: number }[] = [];
  const inView: number[] = [];
  index.nodeBoxes.forEach((box, i) => {
    const id = index.nodeIds[i] as string;
    const screenWidth = box.width * camera.scale;
    const natural: ExplorerTier | null = screenWidth >= tiers.rich ? 'rich' : screenWidth >= tiers.summary ? 'summary' : null;
    if (pinned.has(id)) { tierOf.set(i, natural ?? 'summary'); return; }
    if (!intersects(box, view)) return;
    inView.push(i);
    if (natural === null) return;
    tierOf.set(i, natural);
    const dx = box.x + box.width / 2 - centerX;
    const dy = box.y + box.height / 2 - centerY;
    candidates.push({ i, distance: dx * dx + dy * dy });
  });

  if (candidates.length > cap) {
    candidates.sort((a, b) => a.distance - b.distance || ((index.nodeIds[a.i] as string) < (index.nodeIds[b.i] as string) ? -1 : 1));
    for (const dropped of candidates.slice(Math.max(0, cap))) tierOf.delete(dropped.i);
  }

  const overlay = new Map<string, ExplorerTier>();
  index.nodeIds.forEach((id, i) => { const tier = tierOf.get(i); if (tier !== undefined) overlay.set(id, tier); });
  const baseNodes = inView.filter((i) => !tierOf.has(i)).map((i) => index.nodeIds[i] as string);
  const edges: string[] = [];
  index.edgeBounds.forEach((bounds, i) => { if (bounds !== null && intersects(bounds, view)) edges.push(index.edgeIds[i] as string); });
  return { overlay, baseNodes, edges };
}

export function sameVisibleSet(a: ExplorerVisibleSet, b: ExplorerVisibleSet): boolean {
  if (a === b) return true;
  if (a.overlay.size !== b.overlay.size || a.baseNodes.length !== b.baseNodes.length || a.edges.length !== b.edges.length) return false;
  for (const [id, tier] of a.overlay) if (b.overlay.get(id) !== tier) return false;
  for (let i = 0; i < a.baseNodes.length; i += 1) if (a.baseNodes[i] !== b.baseNodes[i]) return false;
  for (let i = 0; i < a.edges.length; i += 1) if (a.edges[i] !== b.edges[i]) return false;
  return true;
}

export function nearestToCenter(index: LayoutIndex, camera: ExplorerCamera, viewport: ExplorerViewportSize): string | null {
  const world = visibleWorld(camera, viewport);
  const centerX = world.x + world.width / 2;
  const centerY = world.y + world.height / 2;
  let best: string | null = null;
  let bestDistance = Infinity;
  index.nodeBoxes.forEach((box, i) => {
    const dx = box.x + box.width / 2 - centerX;
    const dy = box.y + box.height / 2 - centerY;
    const distance = dx * dx + dy * dy;
    const id = index.nodeIds[i] as string;
    if (distance < bestDistance || (distance === bestDistance && best !== null && id < best)) { best = id; bestDistance = distance; }
  });
  return best;
}

export function nodeAtPoint(index: LayoutIndex, point: Vec2): string | null {
  for (let i = index.nodeBoxes.length - 1; i >= 0; i -= 1) {
    const box = index.nodeBoxes[i] as ExplorerBox;
    if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return index.nodeIds[i] as string;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: PASS, 9 files. `test/visible-set.test.ts` has 22 tests, and
`test/index.test.ts` passes unchanged: no runtime export was added.

Run: `pnpm --filter @prnt/dagr-explorer typecheck` and `pnpm exec eslint packages/explorer`

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/explorer/src/visible-set.ts packages/explorer/test/visible-set.test.ts
git commit -F - <<'EOF'
feat(explorer): compute the visible set that virtualizes node content

For a camera, computeVisibleSet says which nodes get a DOM element and
at which tier, which are left to the base layer as marks, and which
edges are in view. A node's tier comes from its width on screen, with
half-open gates at 56 and 200. Under 56 it has no element at all.

The overlay is capped at 200 nodes, nearest the viewport center first.
A pinned node (the selected one, the keyboard's tab target) is always
mounted, exempt from the cap, at least as a summary: otherwise focus
would vanish when its node scrolled away.

sameVisibleSet is what lets the viewport re-render only when membership
or a tier changes. A pan inside the overscan margin changes neither.

The scan is linear on purpose, as the renderer's overlay is. Internal:
nothing is added to the package entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Record it, then ship through the pull request gate

**Files:**
- Modify: `packages/explorer/CHANGELOG.md`
- Modify: `ROADMAP.md`
- Modify: `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `camera.ts` and `visible-set.ts` on `main`, for M5.6c-2.

- [ ] **Step 1: Changelog**

In `packages/explorer/CHANGELOG.md`, add this bullet at the end of the
`## Unreleased` list:

```markdown
- Add the viewport's pure core (M5.6c-1), internal for now: camera arithmetic
  with limits from `Camera2D`, and the visible set that decides which nodes
  get a DOM element at which tier, capped, with pinned nodes always mounted.
```

- [ ] **Step 2: Roadmap**

In `ROADMAP.md`, replace the line

```markdown
- [ ] **M5.6c** Camera, viewport, SVG base, visible set, overlay tiers, pins.
```

with:

```markdown
- [ ] **M5.6c** Camera, viewport, SVG base, visible set, overlay tiers, pins.
  The pure core (camera arithmetic, the visible set, the point-to-node lookup)
  landed first as M5.6c-1. The React viewport that uses it is M5.6c-2.
```

- [ ] **Step 3: Spec status**

The maintainer approved spec amendments 3 to 13 on 2026-10-03. In
`docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`:

Replace the `**Status:**` line with:

`**Status:** Approved by the maintainer on 2026-10-03, with the thirteen amendments listed at the end, which the maintainer also approved that day.`

At the end of the "Amendments" section, replace the paragraph that begins
`Amendments 3 to 13 were made by the agent executing the plans` (through the
end of that paragraph) with:

```markdown
Amendments 3 to 13 were made by the agent executing the plans, after review
findings. The maintainer approved all of them on 2026-10-03.
```

In the "Increments" table, replace the M5.6c row with two rows:

```markdown
| M5.6c-1 | camera arithmetic, the visible set, the point-to-node lookup |
| M5.6c-2 | the camera hook, viewport, SVG base, overlay tiers, pins |
```

- [ ] **Step 4: Check the prose and commit**

Run: `git diff origin/main | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`

```bash
git add packages/explorer/CHANGELOG.md ROADMAP.md docs/superpowers
git commit -F - <<'EOF'
docs(explorer): record the viewport core and the approved amendments

M5.6c is split: the pure core landed here, and the React viewport that
uses it is M5.6c-2. The spec's status line and its amendment list said
eleven amendments were unapproved. The maintainer approved them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Ship**

Follow `AGENTS.md`, "How work reaches main": rebase onto `origin/main`,
`pnpm install --frozen-lockfile`, then
`pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci`.
Run `bench:ci` only when the 1-minute load is at or below 3.5: it is
load-sensitive on this machine. Then a diff review and a tree review, a pull
request whose body records every review and how each finding was resolved,
green CI, and a squash merge.
