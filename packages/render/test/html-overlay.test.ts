// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera2D } from '../src/camera.js';
import { OverlayDisposedError, OverlayParentError } from '../src/errors.js';
import {
  OVERLAY_INV_ZOOM_PROPERTY,
  OVERLAY_ZOOM_PROPERTY,
  createHtmlOverlay,
} from '../src/html-overlay.js';
import type { HtmlOverlay } from '../src/html-overlay.js';
import type { OverlayPlacement } from '../src/overlay-math.js';

/**
 * The overlay's DOM wiring: what is attached, what is detached, and when.
 *
 * **This is the package's first test that needs a DOM, and the docblock at the
 * top of the file is the whole of the machinery for it.** The other suites here
 * run in bare Node and stay there; a per-file environment is what keeps the
 * jsdom cost on the one file that needs it. It is worth being clear about why
 * this line moved at all: M4.1 drew the testing line at "pure modules in Node,
 * a screenshot for anything that needs a device", and a DOM is not a device. It
 * is available in Node, so the wiring that was going to be untested is not.
 *
 * The arithmetic and every CSS string are asserted in `overlay-math.test.ts`.
 * What is asserted here is behaviour no pure function has: element lifetime,
 * eviction under the cap, and the lifecycle.
 *
 * One jsdom fact this suite depends on, found rather than assumed: computed
 * styles resolve only for elements that are IN a document, so a parent has to
 * be attached to `document.body` before `getComputedStyle` reports its inline
 * `position: relative`. A detached parent reports `static` and would trip
 * `OverlayParentError`, which is a property of jsdom and not of the overlay.
 */

/** A parent shaped like the demo's `.stage`: positioned, and in the document. */
function makeParent(): HTMLElement {
  const parent = document.createElement('div');
  parent.style.position = 'relative';
  document.body.appendChild(parent);
  return parent;
}

function makeCamera(zoom = 1): Camera2D {
  return new Camera2D({ zoom, viewport: { width: 1000, height: 600, devicePixelRatio: 1 } });
}

/** The layer div: the overlay's second element, and the one entries live in. */
function layerOf(parent: HTMLElement): HTMLElement {
  const clip = parent.firstElementChild;
  const layer = clip?.firstElementChild;
  if (!(layer instanceof HTMLElement)) throw new Error('no layer');
  return layer;
}

const box = (minX: number, maxX: number, gate?: { min?: number; max?: number }): OverlayPlacement => ({
  kind: 'box',
  bounds: { minX, minY: -10, maxX, maxY: 10 },
  ...(gate?.min === undefined ? {} : { minScreenWidth: gate.min }),
  ...(gate?.max === undefined ? {} : { maxScreenWidth: gate.max }),
});

/** Counts what `create` and `release` were called with, which is the pool seam. */
function countingEntry(): {
  create: () => HTMLElement;
  release: (element: HTMLElement) => void;
  created: number;
  released: number;
} {
  const state = {
    created: 0,
    released: 0,
    create: (): HTMLElement => {
      state.created += 1;
      return document.createElement('div');
    },
    release: (): void => {
      state.released += 1;
    },
  };
  return state;
}

describe('createHtmlOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('builds a clip div and a layer div inside the parent', () => {
    const parent = makeParent();
    createHtmlOverlay({ parent, camera: makeCamera() });

    const clip = parent.firstElementChild;
    expect(clip).toBeInstanceOf(HTMLElement);
    if (!(clip instanceof HTMLElement)) return;
    // The clip is what holds the layer to the canvas box. The layer cannot do
    // it: clipping applies in an element's own space, and the layer's is scaled.
    expect(clip.style.overflow).toBe('hidden');
    expect(clip.style.pointerEvents).toBe('none');
    expect(layerOf(parent).style.transformOrigin).toBe('0 0');
  });

  it('refuses a parent that does not establish a containing block', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const camera = makeCamera();
    expect(() => createHtmlOverlay({ parent, camera })).toThrow(OverlayParentError);
    // The message has to say what to do: a caller cannot see this from the
    // overlay's own code, and the symptom without the check is a layer over the
    // whole document with labels in plausible but wrong places.
    expect(() => createHtmlOverlay({ parent, camera })).toThrow(/position: relative/);
  });

  it('refuses a parent that is not in a document', () => {
    // `getComputedStyle` on a disconnected element returns an EMPTY declaration
    // in a browser, so a `position === 'static'` test alone would wave through
    // every caller who builds an overlay before mounting its parent, which is
    // the case the error exists to name. jsdom reports `static` for the same
    // element, so this test would pass either way here and the browser case is
    // the one being guarded.
    const parent = document.createElement('div');
    parent.style.position = 'relative';
    expect(() => createHtmlOverlay({ parent, camera: makeCamera() })).toThrow(OverlayParentError);
    expect(() => createHtmlOverlay({ parent, camera: makeCamera() })).toThrow(/not in a document/);
  });

  it('rejects a cap below one element', () => {
    const parent = makeParent();
    expect(() => createHtmlOverlay({ parent, camera: makeCamera(), maxElements: 0 })).toThrow(
      RangeError,
    );
    expect(() => createHtmlOverlay({ parent, camera: makeCamera(), maxElements: 0.5 })).toThrow(
      /maxElements/,
    );
  });

  it('creates no element until an entry is visible, and none for a culled one', () => {
    const parent = makeParent();
    const overlay = createHtmlOverlay({ parent, camera: makeCamera() });
    const entry = countingEntry();
    // Far outside a 1000 by 600 view at zoom 1.
    overlay.add({ placement: box(10_000, 10_100), create: entry.create, release: entry.release });

    expect(entry.created).toBe(0);
    overlay.sync();
    expect(entry.created).toBe(0);
    expect(overlay.activeCount).toBe(0);
    expect(layerOf(parent).children.length).toBe(0);
  });

  it('attaches on the way in and releases on the way out', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    const entry = countingEntry();
    overlay.add({ placement: box(-50, 50), create: entry.create, release: entry.release });

    overlay.sync();
    expect(entry.created).toBe(1);
    expect(overlay.activeCount).toBe(1);
    expect(layerOf(parent).children.length).toBe(1);

    // A sync that changes nothing does not rebuild anything: `create` is called
    // per becoming-visible, not per frame.
    overlay.sync();
    expect(entry.created).toBe(1);

    camera.panByScreen(-5000, 0);
    overlay.sync();
    expect(entry.released).toBe(1);
    expect(overlay.activeCount).toBe(0);
    expect(layerOf(parent).children.length).toBe(0);

    camera.panByScreen(5000, 0);
    overlay.sync();
    expect(entry.created).toBe(2);
  });

  it('applies the styles an entry element cannot be positioned without', () => {
    const parent = makeParent();
    const overlay = createHtmlOverlay({ parent, camera: makeCamera() });
    overlay.add({ placement: box(-50, 50), create: () => document.createElement('h3') });
    overlay.sync();

    const element = layerOf(parent).children[0];
    expect(element).toBeInstanceOf(HTMLElement);
    if (!(element instanceof HTMLElement)) return;
    // Absolute, because a static element sits in normal flow and its transform
    // would offset from wherever the flow put it. Margin zero because an `h3`
    // brings a user-agent margin that would do the same.
    expect(element.style.position).toBe('absolute');
    expect(element.style.left).toBe('0px');
    expect(element.style.top).toBe('0px');
    expect(element.style.margin).toBe('0px');
    expect(element.style.transformOrigin).toBe('0 0');
    expect(element.style.pointerEvents).toBe('none');
    // Sized to the box, in world units, border-box so a border stays inside the
    // box the layout engine reserved.
    expect(element.style.width).toBe('100px');
    expect(element.style.height).toBe('20px');
    expect(element.style.boxSizing).toBe('border-box');
  });

  it('turns pointer events back on only for an interactive entry', () => {
    const parent = makeParent();
    const overlay = createHtmlOverlay({ parent, camera: makeCamera() });
    overlay.add({
      placement: box(-50, 50),
      create: () => document.createElement('div'),
      interactive: true,
    });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    expect(element.style.pointerEvents).toBe('auto');
  });

  it('gates a box entry by its width on screen', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    // 40 world units wide: the label tier from 24 to 160 CSS pixels is zoom
    // 0.6 up to 4.
    overlay.add({
      placement: box(-20, 20, { min: 24, max: 160 }),
      create: () => document.createElement('div'),
    });

    camera.setZoom(0.5);
    overlay.sync();
    expect(overlay.activeCount).toBe(0);

    camera.setZoom(2);
    overlay.sync();
    expect(overlay.activeCount).toBe(1);

    camera.setZoom(4);
    overlay.sync();
    expect(overlay.activeCount).toBe(0);
  });

  it('writes one layer transform per sync and leaves box entries alone on a pan', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    overlay.add({ placement: box(-50, 50), create: () => document.createElement('div') });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    const before = element.style.transform;
    const layerBefore = layerOf(parent).style.transform;

    // A pan small enough not to rebase. The layer moves, the entry does not:
    // this is the property that makes a pan one style write in total.
    camera.panByScreen(-10, 0);
    overlay.sync();
    expect(element.style.transform).toBe(before);
    expect(layerOf(parent).style.transform).not.toBe(layerBefore);
  });

  it('publishes the zoom and its inverse, so content can counter-scale in CSS', () => {
    // This is what lets a label be GATED by its node's size on screen (a box)
    // and DRAWN at a constant size (what a point does), without the placement
    // union growing a member for "box that does not scale".
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    overlay.sync();

    const layer = layerOf(parent);
    // Asserted through the exported constants, because these two strings are
    // the one part of the contract that lives in a stylesheet: a test that
    // spelled them out by hand would agree with a rename that broke every
    // consumer.
    expect(OVERLAY_ZOOM_PROPERTY).toBe('--dagr-overlay-zoom');
    expect(OVERLAY_INV_ZOOM_PROPERTY).toBe('--dagr-overlay-inv-zoom');
    expect(layer.style.getPropertyValue(OVERLAY_ZOOM_PROPERTY)).toBe('1');
    expect(layer.style.getPropertyValue(OVERLAY_INV_ZOOM_PROPERTY)).toBe('1');

    camera.setZoom(4);
    overlay.sync();
    expect(layer.style.getPropertyValue(OVERLAY_ZOOM_PROPERTY)).toBe('4');
    // Unitless, so a stylesheet can use it as a multiplier inside `calc()`.
    expect(layer.style.getPropertyValue(OVERLAY_INV_ZOOM_PROPERTY)).toBe('0.25');
  });

  it('rewrites entry transforms when the origin is rebased', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    overlay.add({
      placement: box(-10_000, 10_000),
      create: () => document.createElement('div'),
    });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    const before = element.style.transform;

    // Past half the viewport, so the origin falls out of the visible region.
    camera.panByScreen(-800, 0);
    overlay.sync();
    expect(element.style.transform).not.toBe(before);
  });

  it('rewrites a point entry when the zoom changes, and not on a pan', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    overlay.add({
      placement: { kind: 'point', at: { x: 0, y: 0 } },
      create: () => document.createElement('div'),
    });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    const atZoom1 = element.style.transform;

    camera.panByScreen(-10, 0);
    overlay.sync();
    expect(element.style.transform).toBe(atZoom1);

    // A point counter-scales by 1/zoom so it stays the size it was authored at,
    // so its transform is the one that has to follow the zoom.
    camera.setZoom(2);
    overlay.sync();
    expect(element.style.transform).not.toBe(atZoom1);
    expect(element.style.transform).toContain('scale(0.5)');
  });

  it('caps the elements and keeps the ones nearest the camera', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera, maxElements: 2 });
    const marks: string[] = [];
    for (const x of [-400, -100, 300]) {
      overlay.add({
        placement: box(x, x + 10),
        create: () => {
          const element = document.createElement('div');
          element.dataset.x = String(x);
          return element;
        },
      });
    }
    overlay.sync();

    for (const child of Array.from(layerOf(parent).children)) {
      if (child instanceof HTMLElement) marks.push(child.dataset.x ?? '');
    }
    expect(overlay.activeCount).toBe(2);
    // The camera is at x = 0; the boxes centre on -395, -95 and 305, so the
    // two nearest are -100 and 300.
    expect(marks.sort()).toEqual(['-100', '300']);
  });

  it('re-places an entry through its handle, not by mutating the placement', () => {
    const parent = makeParent();
    const overlay = createHtmlOverlay({ parent, camera: makeCamera() });
    const handle = overlay.add({
      placement: box(-50, 50),
      create: () => document.createElement('div'),
    });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    expect(element.style.width).toBe('100px');

    handle.place(box(-100, 100));
    overlay.sync();
    // Both the transform and the size follow, since a new box can change either.
    expect(element.style.width).toBe('200px');
    expect(element.style.transform).toBe('translate(-100px, -10px)');
  });

  it('clears the box size when an entry is re-placed as a point', () => {
    // A point's anchor is a percentage of the element's OWN box, so a width
    // left over from the box it used to be is a phantom the anchor resolves
    // against: the element lands half that stale box away from its world point,
    // at every zoom, and the error grows with the box.
    const parent = makeParent();
    const overlay = createHtmlOverlay({ parent, camera: makeCamera() });
    const handle = overlay.add({
      placement: box(-50, 50),
      create: () => document.createElement('div'),
    });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    expect(element.style.width).toBe('100px');

    handle.place({ kind: 'point', at: { x: 0, y: 0 } });
    overlay.sync();
    expect(element.style.width).toBe('');
    expect(element.style.height).toBe('');
    expect(element.style.boxSizing).toBe('');
  });

  it('gives an element back without the styles it was lent', () => {
    // The pool contract M4.12 builds on: an element released by a 1000 unit
    // card and handed back from another entry's `create` must not carry that
    // card's size or transform, and a caller reusing it elsewhere should not
    // get an absolutely positioned element.
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    const released: HTMLElement[] = [];
    overlay.add({
      placement: box(-50, 50),
      create: () => document.createElement('div'),
      release: (element) => {
        released.push(element);
      },
    });
    overlay.sync();
    camera.panByScreen(-5000, 0);
    overlay.sync();

    const element = released[0];
    expect(element).toBeInstanceOf(HTMLElement);
    if (element === undefined) return;
    expect(element.style.cssText).toBe('');
  });

  it('detaches and releases on remove', () => {
    const parent = makeParent();
    const overlay = createHtmlOverlay({ parent, camera: makeCamera() });
    const entry = countingEntry();
    const handle = overlay.add({
      placement: box(-50, 50),
      create: entry.create,
      release: entry.release,
    });
    overlay.sync();
    expect(layerOf(parent).children.length).toBe(1);

    handle.remove();
    expect(entry.released).toBe(1);
    expect(layerOf(parent).children.length).toBe(0);
    overlay.sync();
    expect(overlay.activeCount).toBe(0);
    // Removing twice is not an error, since a caller unmounting cannot always
    // know whether it already did.
    expect(() => {
      handle.remove();
    }).not.toThrow();
  });

  it('reads no layout, which is what keeps sync off the reflow path', () => {
    const parent = makeParent();
    const camera = makeCamera();
    const overlay = createHtmlOverlay({ parent, camera });
    overlay.add({ placement: box(-50, 50), create: () => document.createElement('div') });
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    const rect = vi.spyOn(element, 'getBoundingClientRect');
    const computed = vi.spyOn(window, 'getComputedStyle');

    camera.panByScreen(-10, 0);
    camera.setZoom(3);
    overlay.sync();
    overlay.sync();

    expect(rect).not.toHaveBeenCalled();
    expect(computed).not.toHaveBeenCalled();
  });

  describe('after dispose', () => {
    let parent: HTMLElement;
    let overlay: HtmlOverlay;
    let entry: ReturnType<typeof countingEntry>;

    beforeEach(() => {
      parent = makeParent();
      overlay = createHtmlOverlay({ parent, camera: makeCamera() });
      entry = countingEntry();
      overlay.add({ placement: box(-50, 50), create: entry.create, release: entry.release });
      overlay.sync();
      overlay.dispose();
    });

    it('takes its own divs with it and gives every element back', () => {
      expect(parent.children.length).toBe(0);
      expect(entry.released).toBe(1);
      expect(overlay.activeCount).toBe(0);
    });

    it('is idempotent', () => {
      expect(() => {
        overlay.dispose();
      }).not.toThrow();
      expect(entry.released).toBe(1);
    });

    it('lets sync pass, because a frame is often already queued', () => {
      // The knowing divergence from `RendererDisposedError`: `sync` is the one
      // method the platform calls, from inside a frame callback where a throw
      // reaches the global error handler rather than the caller's catch.
      expect(() => {
        overlay.sync();
      }).not.toThrow();
    });

    it('throws on add, which is called from the caller own line', () => {
      expect(() => overlay.add({ placement: box(0, 1), create: entry.create })).toThrow(
        OverlayDisposedError,
      );
    });
  });
});
