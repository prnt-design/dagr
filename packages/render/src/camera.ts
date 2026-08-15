import type { OrthoFrustum, Size, Vec2, ViewportSize, WorldBounds } from './types.js';
import { requireFinite, requireFinitePoint, requirePositive } from './validate.js';

/**
 * The 2D camera every Dagr view is drawn through, and the only part of
 * `@dagr/render` that a unit test can reach: everything else in the package
 * needs a GPU adapter, so this file carries the package's whole verified
 * contract. See `test/camera.test.ts`, where every sentence below that makes a
 * numerical claim is executed.
 */

/**
 * The width and height an `HTMLCanvasElement` has before CSS or an attribute
 * says otherwise, per the HTML specification. Used as the default viewport so
 * that a camera built before its canvas has been measured still describes a
 * real canvas rather than a made-up one.
 */
const DEFAULT_VIEWPORT: ViewportSize = { width: 300, height: 150, devicePixelRatio: 1 };

/**
 * Rejects a viewport with a non-positive width, height or device pixel ratio.
 *
 * The three checks this file used to define (`requireFinite`,
 * `requirePositive`, `requireFinitePoint`, with the paragraph on why a bad
 * number is a `RangeError` and why nothing falls back to a default) moved to
 * `validate.ts` when the overlay needed the same three. The rule is unchanged
 * and lives there now.
 */
function requireViewport(viewport: ViewportSize, field: string): ViewportSize {
  requirePositive(viewport.width, `${field}.width`);
  requirePositive(viewport.height, `${field}.height`);
  requirePositive(viewport.devicePixelRatio, `${field}.devicePixelRatio`);
  return {
    width: viewport.width,
    height: viewport.height,
    devicePixelRatio: viewport.devicePixelRatio,
  };
}

/**
 * What a caller may say when building a {@link Camera2D}. Every field is
 * optional and every one has a default, so `new Camera2D()` is a legal camera
 * looking at the world origin.
 */
export interface Camera2DInit {
  /** Where the camera looks, in world units. Default the origin. */
  readonly center?: Vec2;

  /** CSS pixels per world unit. Default 1. */
  readonly zoom?: number;

  /** The canvas size and device pixel ratio. Default 300 by 150 at ratio 1. */
  readonly viewport?: ViewportSize;

  /**
   * The smallest zoom {@link Camera2D.zoomAtScreen} and
   * {@link Camera2D.setZoom} will settle on. Default `Number.MIN_VALUE`, the
   * smallest positive double, which is unbounded for any practical purpose
   * while still being a finite positive number, so the range check below has no
   * special case for "no minimum".
   */
  readonly minZoom?: number;

  /** The largest zoom, on the same terms. Default `Number.MAX_VALUE`. */
  readonly maxZoom?: number;
}

/**
 * An orthographic 2D camera: a centre, a zoom, and the size of the canvas it is
 * looking through.
 *
 * ## Conventions, stated once
 *
 * **World y is UP, screen y is DOWN.** World space is the space a layout is
 * computed in and the space a caller thinks in; screen space is CSS pixels with
 * the origin at the canvas TOP-LEFT corner, which is where a `PointerEvent`'s
 * `offsetX` and `offsetY` already are.
 *
 * The flip is hardcoded in FOUR methods, not two, and it is worth counting them
 * honestly because each one is a separate chance to get the sign wrong:
 * {@link worldToScreen} and {@link screenToWorld} negate the y term,
 * {@link panByScreen} spells the same asymmetry as a minus on x and a plus on
 * y, and {@link zoomAtScreen} solves `worldToScreen` for the centre and carries
 * the sign again. Every one of the four has a test that would fail if its sign
 * flipped alone.
 *
 * Note that `@dagr/layout` computes in y-down coordinates. Converting between
 * the two is the business of whatever feeds a layout result to a scene (M4.4),
 * not of this camera, which has one convention and states it. That package's
 * `Rect` is why {@link visibleWorldBounds} returns extents rather than a corner
 * and a size: the two records were structurally identical with opposite corner
 * conventions, so one could be passed where the other was meant with nothing
 * red anywhere and a scene mirrored about the horizontal axis to show for it.
 * See `WorldBounds` in `types.ts`.
 *
 * **Zoom is CSS PIXELS PER WORLD UNIT.** At zoom 2, a one-unit box draws two
 * CSS pixels wide. Zooming in raises it.
 *
 * **The device pixel ratio appears in exactly one method,
 * {@link drawingBufferSize}.** Every other method on this class is pure CSS
 * pixels and world units, and changing only the ratio cannot move a single
 * result by a single bit. That is a tested claim, not an aspiration: the suite
 * asserts exact equality across ratios 1, 2 and 3.5, which holds because the
 * ratio never enters the arithmetic at all. The reason to insist on it is that
 * every input event and every CSS length a caller has is in CSS pixels, so a
 * camera that mixed the two would make hit testing wrong on exactly the
 * machines the developer is not using.
 *
 * ## Mutation
 *
 * The three pieces of state are exposed as getters with named setters rather
 * than as public fields, so that every value the camera holds has been through
 * a check. A public `zoom` field costs nothing to assign `NaN` to, and a `NaN`
 * zoom does not throw: it propagates silently into every coordinate, and the
 * first sign of it is an empty canvas.
 */
export class Camera2D {
  #center: Vec2;
  #zoom: number;
  #viewport: ViewportSize;
  #minZoom: number;
  #maxZoom: number;

  /**
   * Builds a camera, rejecting anything that cannot describe one.
   *
   * The zoom range was fixed at construction until the campaign demo's P2,
   * on the argument that a range moving under a live gesture is a source of
   * exactly the drift {@link zoomAtScreen} works to avoid. What P2 needs is
   * content-derived limits, and the FIT zoom depends on the viewport, so a
   * window resize has to be able to rebind the range: construction-time
   * limits cannot follow it. {@link setZoomLimits} is that rebinding, and the
   * drift argument survives it intact, because the hazard was never "limits
   * that change" but limits that change BETWEEN the read and the write of one
   * anchored zoom. `setZoomLimits` is called from resize handling, an event
   * that no wheel event interleaves with on a single thread, and
   * {@link zoomAtScreen} still clamps first and derives the centre from the
   * clamped zoom, so a gesture arriving after a rebind anchors correctly
   * under the new range.
   *
   * The initial zoom has to lie inside the range: clamping it instead would
   * mean a caller who asked for zoom 10 in a 0.5 to 4 camera silently gets 4,
   * and the first they hear of it is the drawing being the wrong size.
   */
  constructor(init: Camera2DInit = {}) {
    this.#minZoom = requirePositive(init.minZoom ?? Number.MIN_VALUE, 'minZoom');
    this.#maxZoom = requirePositive(init.maxZoom ?? Number.MAX_VALUE, 'maxZoom');
    if (this.#minZoom > this.#maxZoom) {
      throw new RangeError(
        `minZoom has to be at most maxZoom, got ${String(this.#minZoom)} and ${String(this.#maxZoom)}`,
      );
    }

    const zoom = requirePositive(init.zoom ?? 1, 'zoom');
    if (zoom < this.#minZoom || zoom > this.#maxZoom) {
      throw new RangeError(
        `zoom has to lie between minZoom and maxZoom, got ${String(zoom)} outside [${String(this.#minZoom)}, ${String(this.#maxZoom)}]`,
      );
    }

    this.#zoom = zoom;
    this.#center = requireFinitePoint(init.center ?? { x: 0, y: 0 }, 'center');
    this.#viewport = requireViewport(init.viewport ?? DEFAULT_VIEWPORT, 'viewport');
  }

  /** Where the camera looks, in world units. */
  get center(): Vec2 {
    return this.#center;
  }

  /** CSS pixels per world unit. */
  get zoom(): number {
    return this.#zoom;
  }

  /** The canvas size in CSS pixels, and its device pixel ratio. */
  get viewport(): ViewportSize {
    return this.#viewport;
  }

  /** The smallest zoom this camera will settle on. */
  get minZoom(): number {
    return this.#minZoom;
  }

  /** The largest zoom this camera will settle on. */
  get maxZoom(): number {
    return this.#maxZoom;
  }

  /** Moves the camera to a world point. Rejects a non-finite coordinate. */
  setCenter(center: Vec2): void {
    this.#center = requireFinitePoint(center, 'center');
  }

  /**
   * Sets the zoom, clamped into the camera's range.
   *
   * Clamping here rather than throwing, unlike the constructor: a zoom set
   * after construction comes from a gesture or an animation, which naturally
   * overshoots and expects the camera to stop at the edge. What is still
   * rejected is a zoom that is not a positive finite number, since no clamp can
   * make sense of one.
   */
  setZoom(zoom: number): void {
    this.#zoom = this.#clampZoom(requirePositive(zoom, 'zoom'));
  }

  /**
   * Rebinds the zoom range, clamping the current zoom into it.
   *
   * Clamping rather than throwing, on {@link setZoom}'s reasoning: new limits
   * arrive from a resize or from content changing underneath a camera that is
   * already somewhere, and the useful behavior is to bring it along, not to
   * make the caller order a read-modify-write correctly on every resize. What
   * is still rejected is a range that cannot hold any zoom at all: a
   * non-positive bound, a non-finite one, or a minimum above its maximum.
   */
  setZoomLimits(minZoom: number, maxZoom: number): void {
    const min = requirePositive(minZoom, 'minZoom');
    const max = requirePositive(maxZoom, 'maxZoom');
    if (min > max) {
      throw new RangeError(
        `minZoom has to be at most maxZoom, got ${String(min)} and ${String(max)}`,
      );
    }
    this.#minZoom = min;
    this.#maxZoom = max;
    this.#zoom = this.#clampZoom(this.#zoom);
  }

  /**
   * Centres on `bounds` and adopts the zoom that fits them, padded, clamped
   * into the camera's range.
   *
   * `padding` is the fraction of the viewport left empty on EACH side of the
   * limiting axis, so 0.05 shows the bounds across 90% of that axis. It is
   * capped at 0.45 because at 0.5 the content would occupy zero pixels and
   * the implied zoom stops being a number a camera can hold.
   *
   * Degenerate bounds are rejected rather than defaulted: a zero or negative
   * extent describes no region, and the zoom that "fits" it is an infinity.
   * Callers fitting a single point should decide their own zoom and use
   * {@link setCenter}, which is a decision this method cannot make for them.
   */
  fitBounds(bounds: WorldBounds, padding = 0.05): void {
    requireFinite(bounds.minX, 'bounds.minX');
    requireFinite(bounds.minY, 'bounds.minY');
    requireFinite(bounds.maxX, 'bounds.maxX');
    requireFinite(bounds.maxY, 'bounds.maxY');
    requireFinite(padding, 'padding');
    if (padding < 0 || padding > 0.45) {
      throw new RangeError(`padding has to lie in [0, 0.45], got ${String(padding)}`);
    }
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) {
      throw new RangeError(
        `bounds have to span a positive area, got ${String(width)} by ${String(height)}`,
      );
    }
    const fit =
      (1 - 2 * padding) * Math.min(this.#viewport.width / width, this.#viewport.height / height);
    this.#zoom = this.#clampZoom(fit);
    this.#center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  }

  /**
   * Adopts a new canvas size.
   *
   * **The centre and the zoom are preserved, so the visible world GROWS when
   * the canvas grows.** That is the decision, and it is worth stating because
   * the alternative is defensible elsewhere: a camera that preserved the
   * visible RECT would rescale the drawing to fit, which is what an image
   * viewer does. A graph canvas is not an image viewer. A user who has zoomed
   * in to read a label and then widens the window expects to see MORE graph at
   * the same size, not the same graph at a new size, and a window resize that
   * quietly changed the zoom would make every on-screen distance the user had
   * built an intuition for wrong.
   */
  setViewport(viewport: ViewportSize): void {
    this.#viewport = requireViewport(viewport, 'viewport');
  }

  /**
   * Turns a point in CSS pixels from the canvas top-left into a world point.
   *
   * The inverse of {@link worldToScreen}. Not exactly: the round trip is
   * measured, not asserted to be free, and over the range the suite covers
   * (zoom 1e-3 to 1e3, centres out to 1e4 world units) the worst error seen is
   * 7.4e-10 CSS pixels, against an asserted bound of 1e-8. Both are far below
   * anything a pointer can express, but "pixel-exact" would be a claim no test
   * here establishes, so it is not made.
   */
  screenToWorld(p: Vec2): Vec2 {
    return {
      x: this.#center.x + (p.x - this.#viewport.width / 2) / this.#zoom,
      y: this.#center.y - (p.y - this.#viewport.height / 2) / this.#zoom,
    };
  }

  /** Turns a world point into CSS pixels from the canvas top-left. */
  worldToScreen(p: Vec2): Vec2 {
    return {
      x: this.#viewport.width / 2 + (p.x - this.#center.x) * this.#zoom,
      y: this.#viewport.height / 2 - (p.y - this.#center.y) * this.#zoom,
    };
  }

  /**
   * The world region the canvas currently shows.
   *
   * `minX, minY` is {@link screenToWorld} of the canvas's bottom-left pixel and
   * `maxX, maxY` is {@link screenToWorld} of its top-right, world y being up.
   * Both are checked against `screenToWorld` in the suite rather than merely
   * asserted here, as is the claim that the region has the viewport's aspect
   * ratio at any zoom.
   *
   * Extents rather than a corner and a size: see {@link WorldBounds} for the
   * type error that shape buys.
   */
  visibleWorldBounds(): WorldBounds {
    const halfWidth = this.#viewport.width / (2 * this.#zoom);
    const halfHeight = this.#viewport.height / (2 * this.#zoom);
    return {
      minX: this.#center.x - halfWidth,
      minY: this.#center.y - halfHeight,
      maxX: this.#center.x + halfWidth,
      maxY: this.#center.y + halfHeight,
    };
  }

  /**
   * The extents to give an orthographic projection, in world units.
   *
   * CENTRE-RELATIVE: symmetric about zero, with the camera's own position
   * supplied separately. See {@link OrthoFrustum} for why. The suite pins the
   * seam this creates: the NDC these extents produce for a world point, through
   * the standard orthographic algebra with the camera at {@link center}, equals
   * the NDC implied by {@link worldToScreen}. That agreement is what makes a
   * click handler built on `screenToWorld` land on the shape a frame built on
   * this frustum drew, and it is the one thing in this package that a
   * screenshot cannot cheaply check.
   */
  orthoFrustum(): OrthoFrustum {
    const halfWidth = this.#viewport.width / (2 * this.#zoom);
    const halfHeight = this.#viewport.height / (2 * this.#zoom);
    return { left: -halfWidth, right: halfWidth, bottom: -halfHeight, top: halfHeight };
  }

  /**
   * How big the drawing buffer should be, in DEVICE pixels. The one method on
   * this class that reads the device pixel ratio.
   *
   * Rounded to the nearest whole pixel, because a drawing buffer is an integer
   * number of texels and a fractional one is not addressable. Nearest rather
   * than floor or ceiling: it is the choice that keeps the error under half a
   * device pixel in either direction, where flooring accumulates a bias that
   * shows up as a hairline of unpainted canvas along two edges.
   *
   * Floored at 1, because a zero-sized texture is not a legal GPU resource and
   * a canvas under half a device pixel wide would round to one. That is not a
   * neutral-answer fallback: 1 is the nearest size that exists, not a guess at
   * what the caller meant.
   */
  drawingBufferSize(): Size {
    const ratio = this.#viewport.devicePixelRatio;
    return {
      width: Math.max(1, Math.round(this.#viewport.width * ratio)),
      height: Math.max(1, Math.round(this.#viewport.height * ratio)),
    };
  }

  /**
   * Moves the camera so that the world appears to slide by `dx, dy` CSS pixels.
   *
   * The sign is the one a drag gesture wants: pass the pointer's own delta and
   * the world follows the pointer. The CAMERA therefore moves opposite to the
   * apparent motion on both axes, which the code below spells as a minus on x
   * and a PLUS on y, because screen y and world y point opposite ways. That
   * asymmetry is the thing worth a test rather than a comment, and it has one:
   * a property test checks that a world point's screen position shifts by
   * `dx, dy`, to within 1e-8 CSS pixels.
   */
  panByScreen(dx: number, dy: number): void {
    requireFinite(dx, 'dx');
    requireFinite(dy, 'dy');
    this.#center = {
      x: this.#center.x - dx / this.#zoom,
      y: this.#center.y + dy / this.#zoom,
    };
  }

  /**
   * Multiplies the zoom by `factor` while keeping the world point currently
   * under `anchor` exactly where it is on screen.
   *
   * This is what a wheel or a pinch is: zoom towards the cursor. The invariant
   * is the whole point of the method, so the order of operations matters and is
   * not the obvious one. The new zoom is CLAMPED FIRST, and only then is the
   * centre derived from it. A version that derives the centre from the
   * unclamped zoom and clamps afterwards passes every test that does not sit on
   * a clamp boundary, and then drifts the anchor by a growing amount for every
   * further notch of a wheel that is already at its limit, which is precisely
   * when a user is most likely to keep scrolling. The suite tests both
   * boundaries with a factor that overshoots by six orders of magnitude.
   */
  zoomAtScreen(anchor: Vec2, factor: number): void {
    requireFinitePoint(anchor, 'anchor');
    requirePositive(factor, 'factor');

    const world = this.screenToWorld(anchor);
    const zoom = this.#clampZoom(this.#zoom * factor);

    // Solve worldToScreen(world) === anchor for the centre, at the new zoom.
    this.#center = {
      x: world.x - (anchor.x - this.#viewport.width / 2) / zoom,
      y: world.y + (anchor.y - this.#viewport.height / 2) / zoom,
    };
    this.#zoom = zoom;
  }

  /**
   * Holds a zoom inside the camera's range.
   *
   * `zoom * factor` can overflow to `Infinity` for a large enough factor even
   * though both operands are finite, which `Math.min` handles correctly here:
   * `Infinity` clamps to `maxZoom` rather than escaping as a non-finite zoom.
   */
  #clampZoom(zoom: number): number {
    return Math.min(this.#maxZoom, Math.max(this.#minZoom, zoom));
  }
}
