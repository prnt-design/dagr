import type { Camera2D } from './camera.js';
import { OverlayDisposedError, OverlayParentError } from './errors.js';
import type { CapCandidate, OverlayPlacement } from './overlay-math.js';
import {
  boundsCentre,
  cssNumber,
  cssPx,
  distanceSqFrom,
  entryTransform,
  layerTransform,
  needsRebase,
  passesGate,
  placementInView,
  requirePlacement,
  selectWithinCap,
} from './overlay-math.js';
import type { Vec2 } from './types.js';
import { requireAtLeast } from './validate.js';

/**
 * A layer of DOM elements positioned in world coordinates over a canvas, kept
 * registered with a {@link Camera2D}.
 *
 * This is `@dagr/render`'s answer to having no text. The GPU draws thousands of
 * shapes and the DOM draws the tens of readable things, and the camera keeps
 * them lined up. The analogue is react-konva-utils' `Html`, which portals a div
 * and syncs its CSS transform to a Konva stage; this one answers to a
 * `Camera2D` and carries no framework at all.
 *
 * **Everything decidable is in `overlay-math.ts`, including the CSS strings.**
 * This file is the wiring: it makes two divs, keeps a registry, and assigns
 * what the math hands it. That split is what makes the arithmetic testable in
 * Node, and it is worth preserving when adding to this file: an expression that
 * ends up here is an expression no test executes.
 *
 * ## What one `sync()` does
 *
 * 1. Rebase the layer origin, if the camera has moved off it.
 * 2. Write ONE transform on the layer, which is what a pan costs in total.
 * 3. Cull every entry against the visible world, gate the box entries by their
 *    width on screen, and cap what is left.
 * 4. Detach what fell out, attach what came in, and rewrite the transforms of
 *    the entries whose transform actually changed, which is none of them for a
 *    pan that did not rebase.
 *
 * **It reads no layout.** No `getBoundingClientRect`, no `offsetWidth`, no
 * `getComputedStyle` (the one call is at creation, not in the loop). That is
 * what keeps it off the forced-reflow path, and it is a property to preserve
 * rather than an accident: one layout read inside the loop makes every frame
 * pay for the styles it wrote a line earlier.
 */

/** The default element cap. See {@link selectWithinCap} for why there is one. */
const DEFAULT_MAX_ELEMENTS = 200;

/**
 * The custom properties the layer publishes whenever the zoom changes, so that
 * CONTENT can counter-scale without the overlay growing a third placement mode.
 *
 * The problem they solve is the one the three-tier semantic zoom runs into
 * immediately. A title label wants to be GATED by how big its node is on screen
 * (which needs a box) and DRAWN at a constant size (which is what a point
 * does). Those are different properties of the same entry, and the union
 * deliberately has no member for "box that does not scale", because such a
 * thing is not a world rectangle.
 *
 * A CSS custom property splits them cleanly: the entry stays a box, and a
 * descendant that wants constant size writes
 * `transform: scale(var(--dagr-overlay-inv-zoom))`. Custom properties inherit,
 * so the whole card gets it, and the browser does the arithmetic on the
 * compositor. The cost is two extra style writes on ONE element, and only on
 * the syncs where the zoom moved, so a pan stays the one write it was.
 *
 * Unitless, so both are usable inside `calc()` as multipliers.
 *
 * **Exported, because a name that only prose carries is not part of a
 * contract.** These two strings are the one piece of this API that lives in a
 * stylesheet rather than in a call, so a consumer who reads them out of the
 * documentation hardcodes them, and a rename here would be silent in every
 * stylesheet that used them. As values they can be asserted in a test and read
 * by a build step, and a caller setting them from JavaScript names the same
 * constant the overlay writes.
 */
export const OVERLAY_ZOOM_PROPERTY = '--dagr-overlay-zoom';

/** The reciprocal of {@link OVERLAY_ZOOM_PROPERTY}, for counter-scaling. */
export const OVERLAY_INV_ZOOM_PROPERTY = '--dagr-overlay-inv-zoom';

/** What `createHtmlOverlay` needs. */
export interface HtmlOverlayOptions {
  /**
   * The element the overlay mounts into. It is the caller's element and the
   * overlay does not style it.
   *
   * Two requirements, and the second is the one a consumer gets wrong first.
   * It has to establish a containing block, or the layer resolves against
   * something else entirely: see {@link OverlayParentError}. And **its padding
   * box has to coincide with the canvas box the camera describes**, because the
   * layer is placed at `camera.worldToScreen(origin)`, which is CSS pixels from
   * the CANVAS top-left, while the clip div is `inset: 0` on this element's
   * padding box. A padding or a border here, or a canvas that does not fill it,
   * offsets every entry by that much at every zoom, with nothing to see but
   * labels that are consistently a few pixels out.
   */
  readonly parent: HTMLElement;

  /** The camera the layer follows. Read on every {@link HtmlOverlay.sync}. */
  readonly camera: Camera2D;

  /**
   * The most elements the overlay will keep attached at once. Default 200.
   * A `RangeError` below 1.
   */
  readonly maxElements?: number;
}

/** What one entry needs. */
export interface OverlayEntryInit {
  /** Where it sits in the world. */
  readonly placement: OverlayPlacement;

  /**
   * Builds the element, called the first time the entry becomes visible and
   * again every time it becomes visible after being culled.
   *
   * Lazy because the point of the cap is that a scene has far more entries than
   * elements: building a card for each of 2,800 nodes at registration would be
   * 2,800 DOM subtrees for the tens that are ever on screen.
   */
  readonly create: () => HTMLElement;

  /**
   * Called when the entry stops being visible, after its element is detached,
   * and on {@link HtmlOverlay.dispose}. The default drops the element for the
   * collector; a pool implements this and hands the same element back from
   * `create` later.
   *
   * **The element arrives with every inline style the overlay wrote taken back
   * off it** (`position`, `left`, `top`, `margin`, `transform-origin`,
   * `pointer-events`, `box-sizing`, `width`, `height`, `transform`), so a pool
   * can hand it to a different entry without inheriting the last one's size or
   * position. Its content is untouched: what `create` built is the caller's.
   */
  readonly release?: (element: HTMLElement) => void;

  /**
   * Whether the element takes pointer events. Default false.
   *
   * The layer is `pointer-events: none` so the canvas keeps every gesture, and
   * this turns it back on for one element. The cost is worth knowing before
   * using it: an interactive element swallows the wheel and the drag over its
   * own area, so panning with the cursor over a card does nothing. The overlay
   * does not forward events to the canvas, because forwarding synthesises input
   * the browser did not send and gets the coordinate space wrong in exactly the
   * cases (transforms, pointer capture) this feature is made of. The pattern
   * that works is an inert card with interactive controls inside it.
   */
  readonly interactive?: boolean;
}

/** A caller's handle on one registered entry. */
export interface OverlayEntry {
  /**
   * Replaces the placement. The transform is rewritten on the next
   * {@link HtmlOverlay.sync}, not here, so a hundred moves in one frame cost
   * one style write each rather than one reflow each.
   *
   * This exists because {@link OverlayPlacement} is deeply `readonly`: the
   * overlay caches what it computed, so a placement mutated in place would move
   * the box for the culling test and not for the transform.
   */
  place(placement: OverlayPlacement): void;

  /** Unregisters it, detaching and releasing its element if it has one. */
  remove(): void;
}

/** The overlay itself. */
export interface HtmlOverlay {
  /** Registers an entry. Throws {@link OverlayDisposedError} after dispose. */
  add(init: OverlayEntryInit): OverlayEntry;

  /**
   * Brings the layer and every entry up to date with the camera. Call it from
   * the same callback that renders a frame, never from a
   * `requestAnimationFrame` of its own: a second loop is a second frame budget
   * and a frame of skew, which reads as the labels swimming over the graph
   * during a pan.
   *
   * A no-op after dispose. See {@link OverlayDisposedError} for why this method
   * is the one that does not throw.
   */
  sync(): void;

  /** How many elements are attached as of the last sync. */
  readonly activeCount: number;

  /**
   * Detaches everything, releases every attached element, and removes the
   * overlay's own divs. Idempotent.
   */
  dispose(): void;
}

/** What the overlay tracks per entry. The handle is the caller's view of it. */
interface EntryState extends CapCandidate {
  readonly order: number;
  readonly init: OverlayEntryInit;
  placement: OverlayPlacement;
  element: HTMLElement | null;
  /** Set by `place`, cleared once the new placement has been written out. */
  dirty: boolean;
  distanceSq: number;
  /**
   * The sync that last kept this entry, which is how the detach pass asks "did
   * this survive?" without a `Set` of the survivors.
   *
   * A stamp rather than a membership test because `sync` runs every frame: a
   * fresh `Set` of up to the cap, plus the array it is built from, is garbage
   * generated sixty times a second in the one function that must not generate
   * any. Zero is a safe initial value because the counter starts at one.
   */
  keptFrame: number;
}

/**
 * Builds an overlay over `parent`.
 *
 * Two nested divs, both owned by the overlay and both removed by
 * {@link HtmlOverlay.dispose}:
 *
 * - a CLIP div, `position: absolute; inset: 0; overflow: hidden`, holding the
 *   layer to the canvas box. The layer cannot clip itself, because clipping
 *   applies in an element's own coordinate space and the layer's is scaled, so
 *   its clip rectangle would grow with the zoom.
 * - a LAYER div carrying the camera transform, with `transform-origin: 0 0` so
 *   that its scale multiplies coordinates rather than distances from its own
 *   centre.
 *
 * @throws {OverlayParentError} when `parent` computes to `position: static`.
 * @throws {RangeError} when `maxElements` is below 1.
 */
export function createHtmlOverlay(options: HtmlOverlayOptions): HtmlOverlay {
  const { parent, camera } = options;
  const maxElements = requireAtLeast(options.maxElements ?? DEFAULT_MAX_ELEMENTS, 1, 'maxElements');

  // Once, at creation, and never inside `sync`. A parent that is restyled after
  // this call is not detected, which is the price of not reading layout every
  // frame; the failure it does catch is the common one, which is a parent whose
  // stylesheet never said `position` at all.
  //
  // The connectivity check is not belt and braces. `getComputedStyle` on a
  // disconnected element returns an EMPTY declaration, so its `position` is the
  // empty string rather than `static`, and a `=== 'static'` test alone would
  // wave through every caller who builds an overlay before mounting its parent,
  // which is exactly the case the error exists to name.
  if (!parent.isConnected) throw new OverlayParentError('is not in a document');
  const parentPosition = parent.ownerDocument.defaultView?.getComputedStyle(parent).position ?? '';
  if (parentPosition === 'static' || parentPosition === '') {
    throw new OverlayParentError(`has a computed position of "${parentPosition}"`);
  }

  const document = parent.ownerDocument;
  const clip = document.createElement('div');
  clip.style.position = 'absolute';
  clip.style.inset = '0';
  clip.style.overflow = 'hidden';
  clip.style.pointerEvents = 'none';

  const layer = document.createElement('div');
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.transformOrigin = '0 0';
  clip.appendChild(layer);
  parent.appendChild(clip);

  const entries = new Set<EntryState>();
  const attached = new Set<EntryState>();

  /**
   * The candidate list, reused across frames rather than rebuilt.
   *
   * `sync` runs on every frame a caller draws, and at M4.10's ten thousand
   * nodes with most of them in view this array holds ten thousand entries. A
   * fresh one per frame is that much straight into the young generation sixty
   * times a second, which is a garbage collector pause in the middle of a pan.
   * `length = 0` keeps the backing store.
   */
  const candidates: EntryState[] = [];

  /** Counts syncs, for {@link EntryState.keptFrame}. Starts above zero. */
  let frameStamp = 0;

  let nextOrder = 0;
  let activeCount = 0;
  let disposed = false;

  /**
   * The world point the layer's local coordinates are measured from, and `null`
   * before the first sync. Rebased by {@link needsRebase}'s rule.
   */
  let origin: Vec2 | null = null;

  /**
   * Last synced zoom, so a pan can be told from a zoom. Point entries carry
   * `scale(1/zoom)` and so have to be rewritten when it changes; box entries
   * never do, which is what makes a pan one style write in total.
   */
  let lastZoom = Number.NaN;

  const applyBaseStyles = (state: EntryState, element: HTMLElement): void => {
    const style = element.style;
    // `left` and `top` stay at zero for the life of the element and the
    // position comes from `transform`, which is a compositor property where
    // `left` is a layout property. Absolute, because a static element sits in
    // normal flow, so entries would stack down the layer and each transform
    // would offset from wherever the flow put it. Margin zero for the same
    // reason: an `<h3>` as an entry root brings a user-agent margin that would
    // shift it off its own world position.
    style.position = 'absolute';
    style.left = '0';
    style.top = '0';
    style.margin = '0';
    style.transformOrigin = '0 0';
    style.pointerEvents = state.init.interactive === true ? 'auto' : 'none';
  };

  /**
   * Writes the size a box entry gets from its bounds, and CLEARS it for a point.
   *
   * The clearing half is not defensive tidiness, it is the correctness half.
   * `place()` can change an entry's kind, and a point's anchor is expressed as a
   * percentage of the element's own box, so a width left over from the box the
   * entry used to be is a phantom the anchor still resolves against: the element
   * lands half that stale box away from its world point, at every zoom, and the
   * error grows with the box. Writing one kind's styles without clearing the
   * other's is how a placement change becomes a silent offset.
   */
  const applySize = (state: EntryState, element: HTMLElement): void => {
    const style = element.style;
    if (state.placement.kind !== 'box') {
      style.boxSizing = '';
      style.width = '';
      style.height = '';
      return;
    }
    const { bounds } = state.placement;
    // Border-box, so a card's own border and padding stay inside the node's
    // layout box. Content-box would make a 1 unit border draw 2 units wider
    // than the box the layout engine reserved, and the overlap would be with
    // the neighbour the layout engine spaced it away from.
    style.boxSizing = 'border-box';
    style.width = cssPx(bounds.maxX - bounds.minX, 'bounds.width');
    style.height = cssPx(bounds.maxY - bounds.minY, 'bounds.height');
  };

  const applyTransform = (state: EntryState, element: HTMLElement, at: Vec2): void => {
    element.style.transform = entryTransform(state.placement, at, camera.zoom);
  };

  /**
   * Takes back every inline style the overlay wrote, so an element leaves in the
   * state it arrived in.
   *
   * A pool is the reason. Without this, an element released by a 1000 unit card
   * and handed back from another entry's `create` carries that card's width,
   * height and transform, and the attach path rewrites the size only for a box,
   * so a point entry would inherit a phantom box (see {@link applySize}) and any
   * entry would draw at the old position for one frame. It also means a caller
   * who reuses the element somewhere else does not get an absolutely positioned
   * one with a transform on it.
   *
   * The element's CONTENT is untouched: what the caller built is the caller's.
   */
  const clearOverlayStyles = (element: HTMLElement): void => {
    const style = element.style;
    style.position = '';
    style.left = '';
    style.top = '';
    style.margin = '';
    style.transformOrigin = '';
    style.pointerEvents = '';
    style.boxSizing = '';
    style.width = '';
    style.height = '';
    style.transform = '';
  };

  const detach = (state: EntryState): void => {
    const element = state.element;
    if (element === null) return;
    state.element = null;
    attached.delete(state);
    element.remove();
    clearOverlayStyles(element);
    state.init.release?.(element);
  };

  return {
    add(init: OverlayEntryInit): OverlayEntry {
      if (disposed) throw new OverlayDisposedError('add');
      requirePlacement(init.placement, 'placement');

      const state: EntryState = {
        order: nextOrder++,
        init,
        placement: init.placement,
        element: null,
        dirty: false,
        distanceSq: 0,
        keptFrame: 0,
      };
      entries.add(state);

      return {
        place(placement: OverlayPlacement): void {
          requirePlacement(placement, 'placement');
          state.placement = placement;
          state.dirty = true;
        },
        remove(): void {
          detach(state);
          entries.delete(state);
        },
      };
    },

    sync(): void {
      if (disposed) return;

      const visible = camera.visibleWorldBounds();
      const zoom = camera.zoom;

      let at: Vec2;
      let rebased: boolean;
      if (origin === null || needsRebase(origin, visible)) {
        at = boundsCentre(visible);
        rebased = true;
      } else {
        at = origin;
        rebased = false;
      }
      origin = at;

      const zoomChanged = zoom !== lastZoom;
      lastZoom = zoom;

      layer.style.transform = layerTransform(camera.worldToScreen(at), zoom);
      if (zoomChanged) {
        layer.style.setProperty(OVERLAY_ZOOM_PROPERTY, cssNumber(zoom, 'zoom'));
        layer.style.setProperty(OVERLAY_INV_ZOOM_PROPERTY, cssNumber(1 / zoom, 'zoom'));
      }

      frameStamp += 1;
      candidates.length = 0;
      for (const state of entries) {
        if (!placementInView(state.placement, visible)) continue;
        if (!passesGate(state.placement, zoom)) continue;
        state.distanceSq = distanceSqFrom(state.placement, camera.center);
        candidates.push(state);
      }
      const kept = selectWithinCap(candidates, maxElements);

      // Stamp first, then detach whatever is not stamped. The stamp is what
      // makes the detach pass a field comparison rather than a scan of `kept`
      // per attached entry, which at the cap would be 200 by 200 comparisons a
      // frame, and it costs no allocation where a `Set` of the survivors costs
      // one per frame.
      for (const state of kept) state.keptFrame = frameStamp;
      for (const state of attached) {
        if (state.keptFrame !== frameStamp) detach(state);
      }

      for (const state of kept) {
        const existing = state.element;
        if (existing === null) {
          const element = state.init.create();
          state.element = element;
          applyBaseStyles(state, element);
          applySize(state, element);
          applyTransform(state, element, at);
          state.dirty = false;
          layer.appendChild(element);
          attached.add(state);
          continue;
        }
        if (state.dirty) {
          applySize(state, existing);
          applyTransform(state, existing, at);
          state.dirty = false;
          continue;
        }
        // The whole reason a pan is one style write: a box entry's transform is
        // in world units measured from the origin, so neither a pan nor a zoom
        // changes it. Only a rebase does. A point entry counter-scales, so it
        // also follows the zoom.
        if (rebased || (zoomChanged && state.placement.kind === 'point')) {
          applyTransform(state, existing, at);
        }
      }

      activeCount = kept.length;
    },

    get activeCount(): number {
      return activeCount;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const state of attached) detach(state);
      entries.clear();
      activeCount = 0;
      clip.remove();
    },
  };
}
