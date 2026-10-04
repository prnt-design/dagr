// @vitest-environment jsdom
/**
 * When the surface scans for its visible set. Its own file, because the
 * scan is counted through a module mock that would otherwise count the
 * other surface tests' own calls too.
 */
import type { MutableRefObject, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleWorld } from '../src/camera.js';
import type { ExplorerCamera } from '../src/camera.js';
import type { ExplorerEdge, ExplorerLayout, ExplorerNode, ExplorerView } from '../src/index.js';
import type { ExplorerCameraControls } from '../src/use-explorer-camera.js';
import { ViewportSurface } from '../src/viewport-surface.js';
import type { ViewportSurfaceProps } from '../src/viewport-surface.js';
import { DEFAULT_MAX_OVERLAY_NODES, computeVisibleSet, indexLayout } from '../src/visible-set.js';
import type * as VisibleSetModule from '../src/visible-set.js';
import type { ExplorerTiers } from '../src/visible-set.js';
import { fire, installDom, mount, pointer, resizeTo, runFramesUntilIdle, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';

vi.mock('../src/visible-set.js', async (importOriginal) => {
  const actual = await importOriginal<typeof VisibleSetModule>();
  return { ...actual, computeVisibleSet: vi.fn(actual.computeVisibleSet) };
});

const scans = vi.mocked(computeVisibleSet);

/** `count` nodes 40 by 20 in rows of 25, laid out by hand. */
function grid(count: number): { view: ExplorerView; layout: ExplorerLayout } {
  const nodes: ExplorerNode[] = [];
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (let i = 0; i < count; i += 1) {
    const id = `n${String(i).padStart(3, '0')}`;
    nodes.push({ id, label: id });
    boxes.set(id, { x: 40 + (i % 25) * 60, y: 40 + Math.floor(i / 25) * 40, width: 40, height: 20 });
  }
  const rows = Math.ceil(count / 25);
  return {
    view: { id: 'grid', label: 'Grid', nodes, edges: [] },
    layout: { boxes, routes: new Map(), groups: new Map(), width: 80 + 25 * 60, height: 80 + rows * 40 },
  };
}

const SIZE = { width: 800, height: 480 };
/** Every node in view qualifies, so the invariant is about the window alone. */
const ALL_SUMMARY: ExplorerTiers = { summary: 0, rich: 10_000 };
const { view, layout } = grid(500);

let tree: Mounted | null = null;
const controlsRef: MutableRefObject<ExplorerCameraControls | null> = { current: null };

beforeEach(() => {
  installDom();
  controlsRef.current = null;
  scans.mockClear();
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

type Props = Partial<ViewportSurfaceProps<ExplorerNode, ExplorerEdge>>;

function surface(props: Props = {}): ReactNode {
  return (
    <ViewportSurface
      label="Grid"
      view={view}
      layout={layout}
      tiers={ALL_SUMMARY}
      controlsRef={controlsRef}
      {...props}
    />
  );
}

function controls(): ExplorerCameraControls {
  if (controlsRef.current === null) throw new Error('no controls');
  return controlsRef.current;
}

function cameraNow(): ExplorerCamera {
  const camera = controls().getCamera();
  if (camera === null) throw new Error('no camera');
  return camera;
}

function part(name: string): HTMLElement {
  const element = tree?.container.querySelector(`[data-dagr-explorer="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${name}`);
  return element;
}

function mounted(): Set<string | undefined> {
  const buttons = tree?.container.querySelectorAll<HTMLElement>('button[data-dagr-explorer="node"]') ?? [];
  return new Set([...buttons].map((button) => button.dataset['nodeId']));
}

/** Nodes that intersect the actual viewport, with no overscan. All qualify for a tier. */
function onScreen(): string[] {
  const world = visibleWorld(cameraNow(), SIZE);
  const ids: string[] = [];
  for (const [id, box] of layout.boxes) {
    if (
      box.x <= world.x + world.width &&
      box.x + box.width >= world.x &&
      box.y <= world.y + world.height &&
      box.y + box.height >= world.y
    ) {
      ids.push(id);
    }
  }
  return ids;
}

/** Zoomed in, so the window holds well under the cap and the cap drops nothing. */
async function zoomedIn(props: Props = {}): Promise<void> {
  tree = await mount(surface(props));
  await resizeTo(SIZE.width, SIZE.height);
  await runFramesUntilIdle();
  controls().zoomBy(4);
  await runFramesUntilIdle();
  const uncapped = computeVisibleSet(indexLayout(layout), cameraNow(), SIZE, {
    tiers: ALL_SUMMARY,
    maxOverlayNodes: 10_000,
  });
  expect(uncapped.overlay.size).toBeLessThan(DEFAULT_MAX_OVERLAY_NODES);
  scans.mockClear();
}

describe('ViewportSurface: the visible-set scan', () => {
  it('skips the scan on a long pan in small steps, and mounts every node on screen at every step', async () => {
    await zoomedIn();
    const viewport = part('viewport');
    const plane = part('plane');
    await fire(viewport, pointer('pointerdown', 400, 240));
    let drawn = 0;
    let x = 400;
    let y = 240;
    for (let step = 0; step < 120; step += 1) {
      const before = plane.style.transform;
      x -= 4;
      y -= 1;
      await fire(viewport, pointer('pointermove', x, y));
      if (plane.style.transform !== before) drawn += 1;
      const have = mounted();
      expect(onScreen().filter((id) => !have.has(id))).toEqual([]);
    }
    await fire(viewport, pointer('pointerup', x, y));

    // The premise: the pan drew a frame per move, and crossed the margin.
    expect(drawn).toBeGreaterThan(100);
    expect(scans.mock.calls.length).toBeGreaterThan(0);
    expect(scans.mock.calls.length).toBeLessThan(drawn / 4);
  });

  it('scans again for any change of scale, pins, tiers or cap, with the camera still', async () => {
    await zoomedIn();
    controls().zoomBy(1.01);
    await runFramesUntilIdle();
    expect(scans).toHaveBeenCalled();

    const changes: Props[] = [
      { pinned: ['n000'] },
      { pinned: ['n000'], tiers: { summary: 1, rich: 10_000 } },
      { pinned: ['n000'], tiers: { summary: 1, rich: 10_000 }, maxOverlayNodes: 150 },
    ];
    for (const props of changes) {
      scans.mockClear();
      await tree?.rerender(surface(props));
      expect(scans).toHaveBeenCalled();
    }
  });
});
