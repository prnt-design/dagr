// @vitest-environment jsdom
import { StrictMode, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCameraLimits,
  fitCamera,
  focusCamera,
  revealCamera,
  screenToWorld,
  zoomCamera,
} from '../src/camera.js';
import type { CameraLimits, ExplorerCamera, ExplorerViewportSize } from '../src/camera.js';
import { layoutView } from '../src/index.js';
import type { ExplorerBox, ExplorerLayout } from '../src/index.js';
import { useExplorerCamera } from '../src/use-explorer-camera.js';
import type { ExplorerCameraControls } from '../src/use-explorer-camera.js';
import {
  captured,
  fire,
  flush,
  installDom,
  mount,
  mouse,
  pendingFrames,
  pointer,
  queuedFrames,
  resizeTo,
  runFrame,
  runFramesUntilIdle,
  uninstallDom,
  watchCount,
} from './dom.js';
import type { Mounted } from './dom.js';

/** a -> b -> c with default sizes: a plane 1040 by 200, boxes 240 by 120. */
const chain = layoutView({
  id: 'chain',
  label: 'Chain',
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

/** A taller, different graph, for swapping. */
const fan = layoutView({
  id: 'fan',
  label: 'Fan',
  layout: { direction: 'down' },
  nodes: [
    { id: 'p', label: 'P' },
    { id: 'q', label: 'Q' },
    { id: 'r', label: 'R' },
    { id: 's', label: 'S' },
  ],
  edges: [
    { id: 'pq', source: 'p', target: 'q' },
    { id: 'pr', source: 'p', target: 'r' },
    { id: 'ps', source: 'p', target: 's' },
  ],
});

const SIZE: ExplorerViewportSize = { width: 800, height: 480 };

interface Frame {
  readonly camera: ExplorerCamera;
  readonly viewport: ExplorerViewportSize;
}

let tree: Mounted | null = null;
let frames: Frame[] = [];
let controls: ExplorerCameraControls | null = null;

beforeEach(() => {
  installDom();
  frames = [];
  controls = null;
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

function Harness({
  layout,
  out,
}: {
  readonly layout: ExplorerLayout;
  readonly out: MutableRefObject<ExplorerCameraControls | null>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const camera = useExplorerCamera({
    viewportRef,
    planeRef,
    layout,
    onFrame: (frameCamera, viewport) => frames.push({ camera: frameCamera, viewport }),
  });
  useEffect(() => {
    out.current = camera;
  }, [camera, out]);
  return (
    <div ref={viewportRef} data-testid="viewport" tabIndex={-1}>
      <div ref={planeRef} data-testid="plane" style={{ visibility: 'hidden' }}>
        <button type="button" data-dagr-explorer="node" data-testid="node">
          Node
        </button>
        <button type="button" data-testid="control">
          Control
        </button>
        <input data-testid="input" />
      </div>
    </div>
  );
}

const out: MutableRefObject<ExplorerCameraControls | null> = { current: null };

async function render(layout: ExplorerLayout = chain, strict = false): Promise<void> {
  const element = <Harness layout={layout} out={out} />;
  tree = await mount(strict ? <StrictMode>{element}</StrictMode> : element);
  controls = out.current;
}

async function rerender(layout: ExplorerLayout): Promise<void> {
  await tree?.rerender(<Harness layout={layout} out={out} />);
  controls = out.current;
}

async function ready(layout: ExplorerLayout = chain): Promise<void> {
  await render(layout);
  await resizeTo(SIZE.width, SIZE.height);
  await runFramesUntilIdle();
}

function byTestId(id: string): HTMLElement {
  const element = tree?.container.querySelector(`[data-testid="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${id}`);
  return element;
}

function camera(): ExplorerCameraControls {
  if (controls === null) throw new Error('no controls');
  return controls;
}

function cameraNow(): ExplorerCamera {
  const value = camera().getCamera();
  if (value === null) throw new Error('no camera yet');
  return value;
}

function limitsFor(layout: ExplorerLayout = chain, size: ExplorerViewportSize = SIZE): CameraLimits {
  const limits = createCameraLimits(layout, size);
  if (limits === null) throw new Error('no limits');
  return limits;
}

function expectCamera(actual: ExplorerCamera | null, expected: ExplorerCamera): void {
  expect(actual).not.toBeNull();
  expect(actual?.x).toBeCloseTo(expected.x, 2);
  expect(actual?.y).toBeCloseTo(expected.y, 2);
  expect(actual?.scale).toBeCloseTo(expected.scale, 5);
}

function transformOf(value: ExplorerCamera): string {
  return `translate(${String(value.x)}px, ${String(value.y)}px) scale(${String(value.scale)})`;
}

function fitted(layout: ExplorerLayout = chain, size: ExplorerViewportSize = SIZE): ExplorerCamera {
  const limits = limitsFor(layout, size);
  return limits.constrain(fitCamera(layout, size, limits));
}

function boxOf(layout: ExplorerLayout, id: string): ExplorerBox {
  const box = layout.boxes.get(id);
  if (box === undefined) throw new Error(`no box ${id}`);
  return box;
}

function wheel(init: WheelEventInit): WheelEvent {
  return new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 200, ...init });
}

function key(value: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init });
}

/** Zooms in far enough that a pan is not clamped back by the limits. */
async function zoomedIn(): Promise<ExplorerCamera> {
  camera().zoomBy(4);
  await runFramesUntilIdle();
  return cameraNow();
}

describe('useExplorerCamera: fitting', () => {
  it('fits on the first size and makes the plane visible', async () => {
    await render();
    const plane = byTestId('plane');
    expect(plane.style.visibility).toBe('hidden');
    expect(camera().getCamera()).toBeNull();

    await resizeTo(SIZE.width, SIZE.height);
    const expected = fitted();
    expectCamera(camera().getCamera(), expected);
    expect(plane.style.visibility).toBe('visible');
    expect(plane.style.transform).toBe(transformOf(cameraNow()));
    expect(plane.style.getPropertyValue('--dagr-explorer-inv-zoom')).toBe(String(1 / cameraNow().scale));
    expect(frames.at(-1)?.viewport).toEqual(SIZE);
    expectCamera(frames.at(-1)?.camera ?? null, expected);
    // The first fit is a placement, not a flight.
    expect(pendingFrames()).toBe(0);
  });

  it('does not fit, throw or draw at 0 by 0, and fits once it has a size', async () => {
    await render();
    await resizeTo(0, 0);
    camera().fit();
    camera().zoomBy(2);
    camera().focusBox(boxOf(chain, 'a'));
    camera().revealBox(boxOf(chain, 'a'));
    expect(camera().getCamera()).toBeNull();
    expect(camera().screenToWorld({ x: 1, y: 1 })).toBeNull();
    expect(pendingFrames()).toBe(0);
    expect(frames).toEqual([]);
    expect(byTestId('plane').style.visibility).toBe('hidden');

    await resizeTo(SIZE.width, SIZE.height);
    expectCamera(camera().getCamera(), fitted());
    expect(byTestId('plane').style.visibility).toBe('visible');
  });

  it('keeps its camera when the viewport is hidden after a fit', async () => {
    await ready();
    const before = cameraNow();
    await resizeTo(0, 0);
    expect(cameraNow()).toEqual(before);
    expect(pendingFrames()).toBe(0);
  });

  it('refits when the viewport is resized', async () => {
    await ready();
    await resizeTo(1000, 600);
    await runFramesUntilIdle();
    expectCamera(camera().getCamera(), fitted(chain, { width: 1000, height: 600 }));
    expect(frames.at(-1)?.viewport).toEqual({ width: 1000, height: 600 });
  });

  it('fit() returns to the fitted camera after a zoom', async () => {
    await ready();
    await zoomedIn();
    camera().fit();
    await runFramesUntilIdle();
    expectCamera(camera().getCamera(), fitted());
  });

  it('writes the inverse zoom only when the scale changes', async () => {
    await ready();
    const plane = byTestId('plane');
    const writes = vi.spyOn(plane.style, 'setProperty');
    await fire(byTestId('viewport'), key('ArrowLeft'));
    await runFramesUntilIdle();
    expect(writes).not.toHaveBeenCalledWith('--dagr-explorer-inv-zoom', expect.anything());
    camera().zoomBy(2);
    await runFramesUntilIdle();
    expect(writes).toHaveBeenCalledWith('--dagr-explorer-inv-zoom', String(1 / cameraNow().scale));
  });

  it('answers screenToWorld from the drawn camera', async () => {
    await ready();
    const point = { x: 120, y: 90 };
    expect(camera().screenToWorld(point)).toEqual(screenToWorld(cameraNow(), point));
  });
});

describe('useExplorerCamera: wheel', () => {
  it('does nothing while focus is outside, and leaves the event alone', async () => {
    await ready();
    const before = cameraNow();
    const allowed = await fire(byTestId('viewport'), wheel({ deltaY: -100 }));
    expect(allowed).toBe(true);
    expect(pendingFrames()).toBe(0);
    expect(cameraNow()).toEqual(before);
  });

  it('zooms while focused, keeping the world point under the pointer', async () => {
    await ready();
    const viewport = byTestId('viewport');
    // From a zoomed-in camera, where the limits are slack: at fit they pull
    // the content back to center and the point would rightly move.
    const before = await zoomedIn();
    viewport.focus();
    const anchor = { x: 300, y: 200 };
    const under = screenToWorld(before, anchor);

    const allowed = await fire(viewport, wheel({ deltaY: -100 }));
    expect(allowed).toBe(false);
    await runFramesUntilIdle();

    const limits = limitsFor();
    expectCamera(cameraNow(), limits.constrain(zoomCamera(before, Math.exp(0.2), anchor, limits)));
    expect(cameraNow().scale).toBeGreaterThan(before.scale);
    const after = screenToWorld(cameraNow(), anchor);
    expect(after.x).toBeCloseTo(under.x, 1);
    expect(after.y).toBeCloseTo(under.y, 1);
  });

  it('counts a line-mode wheel as 16 pixels a line, and caps a delta at 150', async () => {
    await ready();
    const viewport = byTestId('viewport');
    viewport.focus();
    const before = cameraNow();
    await fire(viewport, wheel({ deltaY: -100, deltaMode: 1 }));
    await runFramesUntilIdle();
    const limits = limitsFor();
    expectCamera(cameraNow(), limits.constrain(zoomCamera(before, Math.exp(0.3), { x: 300, y: 200 }, limits)));
  });

  it('leaves a Ctrl or Command wheel to the browser', async () => {
    await ready();
    const viewport = byTestId('viewport');
    viewport.focus();
    expect(await fire(viewport, wheel({ deltaY: -100, ctrlKey: true }))).toBe(true);
    expect(await fire(viewport, wheel({ deltaY: -100, metaKey: true }))).toBe(true);
    expect(pendingFrames()).toBe(0);
  });

  it('pans horizontally on a Shift wheel', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const before = await zoomedIn();
    viewport.focus();
    expect(await fire(viewport, wheel({ deltaY: 30, shiftKey: true }))).toBe(false);
    await runFramesUntilIdle();
    expectCamera(cameraNow(), { x: before.x - 30, y: before.y, scale: before.scale });
  });
});

describe('useExplorerCamera: pointer', () => {
  it('pans past 5 pixels, captures, and suppresses the click and dblclick that follow', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const node = byTestId('node');
    const before = await zoomedIn();
    const clicks = vi.fn();
    viewport.addEventListener('click', clicks);
    viewport.addEventListener('dblclick', clicks);

    await fire(node, pointer('pointerdown', 100, 100));
    await fire(node, pointer('pointermove', 103, 100));
    expect(viewport.hasAttribute('data-dragging')).toBe(false);
    expect(captured.size).toBe(0);

    await fire(node, pointer('pointermove', 140, 130));
    expect(viewport.getAttribute('data-dragging')).toBe('true');
    expect(captured.get(1)).toBe(viewport);
    expect(document.activeElement).toBe(viewport);

    await fire(node, pointer('pointerup', 140, 130));
    expect(viewport.hasAttribute('data-dragging')).toBe(false);
    expect(captured.size).toBe(0);
    await runFramesUntilIdle();
    expectCamera(cameraNow(), { x: before.x + 40, y: before.y + 30, scale: before.scale });

    expect(await fire(node, mouse('click', 140, 130))).toBe(false);
    expect(await fire(node, mouse('dblclick', 140, 130))).toBe(false);
    expect(clicks).not.toHaveBeenCalled();

    // The next press is a press again.
    await fire(node, pointer('pointerdown', 10, 10));
    await fire(node, pointer('pointerup', 10, 10));
    await fire(node, mouse('click', 10, 10));
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('suppresses a dblclick whose first click ended a drag', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const node = byTestId('node');
    await zoomedIn();
    const doubles = vi.fn();
    viewport.addEventListener('dblclick', doubles);

    await fire(node, pointer('pointerdown', 100, 100));
    await fire(node, pointer('pointermove', 130, 100));
    await fire(node, pointer('pointerup', 130, 100));
    await fire(node, mouse('click', 130, 100));
    await fire(node, pointer('pointerdown', 130, 100));
    await fire(node, pointer('pointerup', 130, 100));
    await fire(node, mouse('click', 130, 100));
    await fire(node, mouse('dblclick', 130, 100));
    expect(doubles).not.toHaveBeenCalled();
  });

  it('does not pan for a press released within 5 pixels', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const node = byTestId('node');
    const before = await zoomedIn();
    const clicks = vi.fn();
    viewport.addEventListener('click', clicks);

    await fire(node, pointer('pointerdown', 100, 100));
    await fire(node, pointer('pointermove', 103, 104));
    await fire(node, pointer('pointerup', 103, 104));
    await fire(node, mouse('click', 103, 104));
    expect(pendingFrames()).toBe(0);
    expect(cameraNow()).toEqual(before);
    expect(viewport.hasAttribute('data-dragging')).toBe(false);
    expect(captured.size).toBe(0);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('does not start a drag from a button that is not a node, or from a secondary button', async () => {
    await ready();
    const before = await zoomedIn();
    const control = byTestId('control');
    await fire(control, pointer('pointerdown', 100, 100));
    await fire(control, pointer('pointermove', 160, 160));
    await fire(control, pointer('pointerup', 160, 160));
    const plane = byTestId('plane');
    await fire(plane, pointer('pointerdown', 100, 100, { button: 2 }));
    await fire(plane, pointer('pointermove', 160, 160));
    await fire(plane, pointer('pointerup', 160, 160));
    expect(pendingFrames()).toBe(0);
    expect(cameraNow()).toEqual(before);
  });

  it('on touch, a press while unfocused only focuses the viewport', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const plane = byTestId('plane');
    const before = await zoomedIn();
    expect(viewport.style.touchAction).toBe('');

    await fire(plane, pointer('pointerdown', 100, 100, { pointerType: 'touch' }));
    expect(document.activeElement).toBe(viewport);
    expect(viewport.style.touchAction).toBe('none');
    await fire(plane, pointer('pointermove', 160, 160, { pointerType: 'touch' }));
    await fire(plane, pointer('pointerup', 160, 160, { pointerType: 'touch' }));
    expect(cameraNow()).toEqual(before);

    // Focused, a swipe is a pan.
    await fire(plane, pointer('pointerdown', 100, 100, { pointerType: 'touch' }));
    await fire(plane, pointer('pointermove', 120, 100, { pointerType: 'touch' }));
    await fire(plane, pointer('pointerup', 120, 100, { pointerType: 'touch' }));
    await runFramesUntilIdle();
    expectCamera(cameraNow(), { x: before.x + 20, y: before.y, scale: before.scale });

    await flush(() => viewport.blur());
    expect(viewport.style.touchAction).toBe('');
  });
});

describe('useExplorerCamera: keys', () => {
  it('zooms by 1.25 and 0.8 about the center, and fits on 0', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const limits = limitsFor();
    const center = { x: SIZE.width / 2, y: SIZE.height / 2 };

    let before = cameraNow();
    expect(await fire(viewport, key('+'))).toBe(false);
    await runFramesUntilIdle();
    expectCamera(cameraNow(), limits.constrain(zoomCamera(before, 1.25, center, limits)));

    before = cameraNow();
    await fire(viewport, key('='));
    await runFramesUntilIdle();
    expectCamera(cameraNow(), limits.constrain(zoomCamera(before, 1.25, center, limits)));

    before = cameraNow();
    await fire(viewport, key('-'));
    await runFramesUntilIdle();
    expectCamera(cameraNow(), limits.constrain(zoomCamera(before, 0.8, center, limits)));

    await fire(viewport, key('0'));
    await runFramesUntilIdle();
    expectCamera(cameraNow(), fitted());
  });

  it('pans by 60 on the arrows', async () => {
    await ready();
    const viewport = byTestId('viewport');
    const before = await zoomedIn();
    const steps: [string, number, number][] = [
      ['ArrowLeft', 60, 0],
      ['ArrowRight', -60, 0],
      ['ArrowUp', 0, 60],
      ['ArrowDown', 0, -60],
    ];
    for (const [name, dx, dy] of steps) {
      const from = cameraNow();
      expect(await fire(viewport, key(name))).toBe(false);
      await runFramesUntilIdle();
      expectCamera(cameraNow(), { x: from.x + dx, y: from.y + dy, scale: before.scale });
    }
  });

  it('blurs on Escape', async () => {
    await ready();
    const viewport = byTestId('viewport');
    viewport.focus();
    await fire(viewport, key('Escape'));
    expect(document.activeElement).not.toBe(viewport);
  });

  it('ignores keys typed in an input, and keys with Ctrl, Command or Alt', async () => {
    await ready();
    const input = byTestId('input');
    const viewport = byTestId('viewport');
    expect(await fire(input, key('+'))).toBe(true);
    expect(await fire(viewport, key('-', { ctrlKey: true }))).toBe(true);
    expect(await fire(viewport, key('0', { metaKey: true }))).toBe(true);
    expect(await fire(viewport, key('ArrowLeft', { altKey: true }))).toBe(true);
    expect(pendingFrames()).toBe(0);
  });
});

describe('useExplorerCamera: flights', () => {
  it('eases over several frames, then stops asking for frames', async () => {
    await ready();
    const before = cameraNow();
    camera().zoomBy(2);
    expect(pendingFrames()).toBe(1);
    await runFrame();
    const middle = cameraNow();
    expect(middle.scale).toBeGreaterThan(before.scale);
    expect(middle.scale).toBeLessThan(before.scale * 2);
    expect(await runFramesUntilIdle()).toBeGreaterThan(1);
    expect(pendingFrames()).toBe(0);
  });

  it('applies a change in one frame under reduced motion', async () => {
    uninstallDom();
    installDom({ reducedMotion: true });
    await ready();
    const before = cameraNow();
    camera().zoomBy(2);
    expect(pendingFrames()).toBe(0);
    const limits = limitsFor();
    expectCamera(
      cameraNow(),
      limits.constrain(zoomCamera(before, 2, { x: SIZE.width / 2, y: SIZE.height / 2 }, limits)),
    );
  });

  it('focusBox and revealBox reach the camera camera.ts computes', async () => {
    await ready();
    const limits = limitsFor();
    const c = boxOf(chain, 'c');
    camera().focusBox(c);
    await runFramesUntilIdle();
    expectCamera(cameraNow(), limits.constrain(focusCamera(c, SIZE, limits)));

    const a = boxOf(chain, 'a');
    const before = cameraNow();
    camera().revealBox(a);
    await runFramesUntilIdle();
    const expected = limits.constrain(revealCamera(before, a, SIZE));
    expectCamera(cameraNow(), expected);
    expect(cameraNow().scale).toBeCloseTo(before.scale, 6);
  });

  it('ignores a zoom factor or a box that is not finite', async () => {
    await ready();
    const before = cameraNow();
    camera().zoomBy(Number.NaN);
    camera().zoomBy(-1);
    camera().zoomBy(0);
    camera().focusBox({ x: Number.NaN, y: 0, width: 10, height: 10 });
    camera().revealBox({ x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 });
    expect(pendingFrames()).toBe(0);
    expect(cameraNow()).toEqual(before);
  });
});

describe('useExplorerCamera: layout', () => {
  it('rebuilds the limits and refits when the layout is swapped, even mid-drag', async () => {
    await ready();
    const node = byTestId('node');
    await zoomedIn();
    await fire(node, pointer('pointerdown', 100, 100));
    await fire(node, pointer('pointermove', 140, 100));

    await rerender(fan);
    expectCamera(camera().getCamera(), fitted(fan));
    expectCamera(frames.at(-1)?.camera ?? null, fitted(fan));
    expect(pendingFrames()).toBe(0);

    // The new limits are in force: a zoom far past the ceiling stops at it.
    camera().zoomBy(1e6);
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBeCloseTo(limitsFor(fan).maxScale, 6);
    await fire(node, pointer('pointerup', 140, 100));
  });
});

describe('useExplorerCamera: lifetime', () => {
  it('on unmount cancels the frame, disconnects, removes every listener, and a late frame writes nothing', async () => {
    const added: [EventTarget, string, EventListenerOrEventListenerObject | null][] = [];
    const removed: [EventTarget, string, EventListenerOrEventListenerObject | null][] = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      type,
      listener,
      options,
    ) {
      added.push([this, type, listener]);
      add.call(this, type, listener, options);
    });
    vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (
      this: EventTarget,
      type,
      listener,
      options,
    ) {
      removed.push([this, type, listener]);
      remove.call(this, type, listener, options);
    });

    await ready();
    const viewport = byTestId('viewport');
    const plane = byTestId('plane');
    const own = added.filter(([target]) => target === viewport);
    expect(own.map(([, type]) => type)).toEqual(
      expect.arrayContaining(['wheel', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick']),
    );

    camera().zoomBy(2);
    const late = queuedFrames();
    expect(late).toHaveLength(1);
    const drawn = plane.style.transform;
    const count = frames.length;

    await tree?.unmount();
    expect(pendingFrames()).toBe(0);
    expect(watchCount()).toBe(0);
    for (const [, type, listener] of own) {
      expect(removed.some(([target, t, l]) => target === viewport && t === type && l === listener)).toBe(true);
    }

    late[0]?.(performance.now() + 16);
    expect(plane.style.transform).toBe(drawn);
    expect(frames).toHaveLength(count);
    // The controls outlive the effect as no-ops.
    camera().zoomBy(2);
    expect(camera().getCamera()).toBeNull();
    expect(pendingFrames()).toBe(0);
  });

  it("leaves one set of listeners and one frame loop after StrictMode's double effect", async () => {
    const live = new Map<string, number>();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const ever = new Map<string, number>();
    const isViewport = (target: EventTarget): boolean =>
      target instanceof HTMLElement && target.dataset['testid'] === 'viewport';
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      type,
      listener,
      options,
    ) {
      if (isViewport(this)) {
        ever.set(type, (ever.get(type) ?? 0) + 1);
        live.set(type, (live.get(type) ?? 0) + 1);
      }
      add.call(this, type, listener, options);
    });
    vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (
      this: EventTarget,
      type,
      listener,
      options,
    ) {
      if (isViewport(this)) live.set(type, (live.get(type) ?? 0) - 1);
      remove.call(this, type, listener, options);
    });

    await render(chain, true);
    await resizeTo(SIZE.width, SIZE.height);
    // The effect really did run twice, and the first run cleaned up after itself.
    expect(ever.get('wheel')).toBe(2);
    expect(live.size).toBeGreaterThan(0);
    expect(watchCount()).toBe(1);
    for (const [type, count] of live) expect([type, count]).toEqual([type, 1]);

    camera().zoomBy(2);
    expect(pendingFrames()).toBe(1);
    const before = frames.length;
    await runFrame();
    expect(frames.length - before).toBe(1);
    expect(pendingFrames()).toBe(1);
  });
});
