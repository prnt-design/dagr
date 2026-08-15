import { fillCoverage } from './sdf.js';
import type { Arith } from './sdf.js';
import type { Vec2 } from './types.js';
import { requireAtLeast, requireFinite, requirePositive } from './validate.js';

/**
 * M4.5's arithmetic: a route's control points turned into ribbon geometry, and
 * the coverage the ribbon's fragment shader evaluates.
 *
 * Everything here is plain numbers. `ribbon-nodes.ts` is the TSL half, and it
 * holds no formula of its own, exactly as `sdf-nodes.ts` holds none of
 * `sdf.ts`'s. The split buys the same thing it bought M4.2: the expression tree
 * the shader evaluates is the tree `test/ribbon.test.ts` executes, so a join
 * that pinches or a dash that drifts fails a test in Node rather than a
 * screenshot on somebody's machine.
 *
 * ## The width is in SCREEN space, and that decision is the file
 *
 * A ribbon is `halfWidthPixels` DEVICE pixels from its centreline, at every
 * zoom. The ROADMAP asks for this to be stated because it is visible in every
 * screenshot afterwards, so here is the whole argument.
 *
 * The demo's derived zoom range runs from the whole campaign fitted on the
 * reference canvas (0.053 CSS pixels per world unit) to its smallest node framed
 * (19.9), which is what M4.4 drawing the campaign made of the range P2 built;
 * the ladder it replaced ran from about 0.45 to 134 on the same canvas, which is
 * the wider range and the one the argument below was first measured against. A
 * world-space ribbon wide enough to see at the floor is 300 times wider at the
 * ceiling, a slab across the card it was meant to connect; one that looks right
 * at the ceiling is a third of a pixel at the floor, which is the sub-pixel fade
 * M4.2 already documented. There is no width that survives both ends, and a
 * graph that spans decades of zoom is the only kind this engine is for.
 *
 * The second argument is about what an edge IS. `@dagr/layout` gives a node a
 * `Size` and gives an edge a polyline and nothing else, so any world width for
 * a ribbon would be invented here rather than laid out there. An edge is a
 * relation between two boxes; its thickness is a property of the drawing, like
 * an outline's, and `sdf.ts` already measures outlines in device pixels for the
 * same reason.
 *
 * **What it costs, stated rather than implied, at both ends of the range.** A
 * ribbon no longer scales with the boxes it joins, so at card zoom a 3 pixel
 * edge meets a node the size of the viewport and reads as a wire rather than
 * as a road. The far end is the worse one, and it is measured: the campaign's
 * 110.9M world units of centreline at a 3 device pixel width paint 196% of the
 * fitted viewport at the zoom floor, and 65% even at the 0.5 pixel minimum, so
 * the overview is a mat of edge ink rather than a drawing. A constant pixel
 * width is the right DEFAULT and not the right answer everywhere, and since the
 * half width is a uniform the remedy costs nothing here: a scene clamps it
 * against the world-space width and fades edge alpha out below about one pixel
 * per world unit, per frame. M4.5's demo half owes that. And the geometry
 * cannot carry world positions for its own boundary, since where the boundary
 * is depends on the zoom: what a vertex carries is a unit OFFSET, and the
 * vertex stage multiplies it by the half width in pixels over the pixels per
 * world unit. That is one multiply and one uniform, and it is the reason
 * nothing here has to be re-tessellated when the camera moves.
 *
 * Three things fall out of the decision, and they are why it is worth taking
 * rather than merely defensible:
 *
 * - **Every join is scale-free.** The miter test below is an angle test, so the
 *   geometry that is correct at one zoom is correct at all of them. A join rule
 *   that compared the width against a segment's length (the usual inner-side
 *   clamp) could not be decided on the CPU at all once the width is in pixels,
 *   because the two are in different spaces until a camera says otherwise.
 * - **The antialiasing width is exactly 1**, because the unit is the device
 *   pixel. {@link ribbonCoverage} needs no `dFdx`, no `dFdy` and no camera: the
 *   whole of `antialiasWidth`'s subject in `sdf-nodes.ts` does not arise here.
 * - **Dashes are in pixels too**, so a dash pattern looks the same and flows at
 *   the same apparent speed at every zoom, which is what makes it read as
 *   direction rather than as a texture that breathes when you scroll.
 *
 * The door is not closed. A world-space ribbon is this same geometry with the
 * half width multiplied by the pixels per world unit before it reaches the
 * shader, which is a change to one uniform's value at one call site. What is
 * decided here is what the shipped material does, not what the arithmetic can
 * express.
 *
 * ## One indexed mesh, not instances
 *
 * M4.3 instances nodes because a node is one shape drawn thousands of times
 * with different attributes. A ribbon is not: every route has its own point
 * count, so the only thing an instance could be is a SEGMENT, and a per-segment
 * instance has to compute its own joins in the vertex shader from the
 * neighbouring points. That moves the join arithmetic into TSL, where no test
 * in this repository can execute it, to save a buffer this file builds in one
 * pass. Measured on this box, 7,100 routes of 2 to 9 points come to 77,000
 * vertices and 2.5 MB of buffers as polylines, rebuilt only when a layout
 * changes; see {@link DEFAULT_FLATTEN_TOLERANCE_FRACTION} for what `'smooth'`
 * costs and why its default is relative.
 *
 * So {@link tessellateRibbons} returns attribute arrays and a triangle index
 * for the whole scene at once, with a {@link RibbonRange} per route so a caller
 * can colour, highlight or drop one edge's vertices without re-tessellating the
 * rest.
 *
 * ## Units, stated once
 *
 * Positions and arc lengths are WORLD units, because they come from a layout.
 * Half widths, dash periods and dash flow are DEVICE pixels, per the decision
 * above. `offset` is in half-width units: a unit vector on a straight run, and
 * longer at a mitred corner by exactly the factor that keeps the boundary
 * parallel to the centreline. `across` is the same quantity normalised to
 * `[-1, 1]` for the fragment stage, which is not the length of `offset` and so
 * cannot be derived from it.
 *
 * Validation is at the boundary and never inside a coverage function, which is
 * the rule `sdf.ts` states and the reason is the same: a coverage function runs
 * once per fragment per frame and cannot throw anywhere a caller would see it.
 * {@link tessellateRibbons} and {@link requireRibbonStyle} are the boundary.
 */

/** How far past the visible edge the geometry is built, in DEVICE pixels. */
export const RIBBON_AA_PADDING_PIXELS = 1;

/**
 * The default miter limit: the longest a corner vertex may travel from the
 * centreline, in half widths, before the join falls back to a fan instead.
 *
 * The miter length is `1 / cos(turn / 2)`, so this is a statement about angles:
 * a right-angle turn costs 1.41 and stays mitred, a 120 degree turn costs
 * exactly 2 and is the last one that does. Past that the spike would be longer
 * than the ribbon is wide, which on a 3 pixel edge is a 6 pixel dart pointing
 * away from the drawing.
 *
 * SVG's default is 4, which is a 151 degree turn. That is the right default for
 * a stroke that might be 20 pixels wide and wants its corners sharp; a graph
 * edge is 2 to 3 pixels wide and its corners are incidental, so the cheaper
 * bevel wins earlier here.
 */
export const DEFAULT_MITER_LIMIT = 2;

/**
 * Segments shorter than this in world units are dropped before anything is
 * tessellated.
 *
 * A zero-length segment has no direction, so its normal is a division by zero
 * and every vertex downstream of it is a `NaN`. That is not hypothetical:
 * `polylineRouteStage` in `@dagr/layout` documents a self loop as two identical
 * points at one node's centre, so the shortest route in the campaign is exactly
 * this case. The threshold is absolute rather than relative because it exists
 * to keep the squared length out of underflow, and a world unit is a layout
 * coordinate: 1e-9 of one is nothing any camera in this package can resolve.
 */
export const MIN_SEGMENT_WORLD = 1e-9;

/**
 * The chord tolerance used when a caller states none: a fraction of the
 * route's own MEAN SEGMENT LENGTH, rather than a number of world units.
 *
 * **The option is absolute and the default is relative, and the split is the
 * point.** An absolute tolerance is the meaningful contract, because the
 * quantity a caller cares about is chord error in world units, which is what
 * turns into pixels of faceting at a given zoom: a flattened curve is within
 * the tolerance of the true curve, so faceting stays under half a device pixel
 * while `tolerance * pixelsPerWorldUnit <= 0.5`. But no absolute NUMBER is
 * right for two scenes at once. The ladder is 2,205 world units across and the
 * campaign is 96,455, with a median gap between crossings near 2,000, so a
 * tolerance calibrated for one is either invisible detail or visible faceting
 * in the other. Measured: at a flat 0.05 world units the campaign's 7,100
 * routes flatten to 2.2 million vertices, 76 MB of buffers and nearly a second
 * of single-threaded work, because 0.05 is 2.5e-5 of a typical span.
 *
 * A fraction of the mean segment is scale free: the sagitta of a span scales
 * with its length, so segments per span comes out the same at every scale.
 * Measured at both scales for the same shape, this default gives 6.0 points per
 * span and a tenth of it gives 17.3, a ratio of 2.9 against the 3.16 the rule
 * predicts. That is the trade to make deliberately,
 * because an adaptive subdivision's segment count grows as the INVERSE square
 * root of the tolerance: a tenth of this tolerance is about three times the
 * points, not a third.
 */
export const DEFAULT_FLATTEN_TOLERANCE_FRACTION = 0.01;

/**
 * The recursion cap on {@link RibbonOptions.curve} `'smooth'`, which bounds one
 * cubic at 2^6 = 64 straight segments however sharp it is.
 *
 * A cap rather than an option: the tolerance is the knob a caller wants, and
 * this is the guard that keeps a pathological control polygon from turning one
 * edge into a megabyte. Reaching it means the curve is faceted at the stated
 * tolerance, which is a drawing that is slightly wrong rather than a tab that
 * stops responding.
 */
export const MAX_FLATTEN_DEPTH = 6;

/**
 * The exponent on segment length in the Catmull-Rom knot spacing: 0.5, which is
 * the CENTRIPETAL parameterisation.
 *
 * Uniform spacing (0) is the textbook Catmull-Rom and produces cusps and self
 * intersections wherever consecutive points are unevenly spaced, which is every
 * route that leaves a wide box and then steps through evenly spaced dummies.
 * Chordal (1) removes those and overshoots instead. Centripetal is the one with
 * a proof that it never cusps and never self-intersects, and it costs one
 * square root per point.
 */
export const CATMULL_ROM_ALPHA = 0.5;

/** One route to draw: an id to hand back, and its centreline control points. */
export interface RibbonRoute {
  /**
   * Echoed on this route's {@link RibbonRange} and not otherwise read. Uniqueness
   * is the caller's business: two routes sharing an id produce two ranges, in
   * input order.
   */
  readonly id: string;

  /**
   * The centreline, in world units, source to target. `RoutedEdge.points` from
   * `@dagr/layout` is exactly this, and its direction is a contract there, which
   * is what makes {@link ribbonCoverage}'s dash flow mean "towards the target".
   */
  readonly points: readonly Vec2[];
}

/**
 * How {@link tessellateRibbons} treats the points it is given.
 *
 * Every field is declared `?: T | undefined` rather than `?: T`, which under
 * this repo's `exactOptionalPropertyTypes` are different types: the second
 * rejects an explicitly `undefined` value, and a caller threading its own
 * config through has exactly that. `@dagr/graph` and `@dagr/layout` settled
 * the same question the same way, `NetworkSimplexOptions` with the argument
 * written out.
 */
export interface RibbonOptions {
  /**
   * `'polyline'`, the default, draws the control points as they are: the route
   * bends where the layout put a dummy, which is where that layer decided the
   * edge should cross it.
   *
   * `'smooth'` runs a centripetal Catmull-Rom spline THROUGH every control
   * point, converts each span to a cubic Bezier and flattens it to
   * {@link RibbonOptions.flattenToleranceWorld}. Through rather than near: a
   * dummy's coordinate is the crossing the order stage chose, so a curve that
   * used the points as a cage and missed them would undo the layout it came
   * from.
   */
  readonly curve?: 'polyline' | 'smooth' | undefined;

  /** See {@link DEFAULT_MITER_LIMIT}. At least 1, where 1 bevels every corner. */
  readonly miterLimit?: number | undefined;

  /**
   * The chord tolerance for `'smooth'`, in WORLD units. Ignored otherwise. See
   * {@link DEFAULT_FLATTEN_TOLERANCE_FRACTION}.
   *
   * The unit is in the name because it is the one quantity on this surface
   * that is not in device pixels, and the screen-space width decision is
   * exactly what makes that worth stating twice: a caller reading `halfWidth`
   * and `period` in pixels has no reason to guess that this one is not.
   */
  readonly flattenToleranceWorld?: number | undefined;
}

/**
 * Where one route's vertices and triangles landed in the geometry.
 *
 * The reason ranges exist rather than one buffer per route: a caller that wants
 * to colour an edge, fade the overlay kinds out at low zoom or highlight a
 * hovered path writes into a slice of one attribute array, and a caller that
 * wants a scene draws one mesh. Both counts are inclusive of nothing else: the
 * next range starts where this one ends.
 *
 * A route whose points collapse to a single distinct position (a self loop, an
 * empty array) gets a range with zero counts rather than being dropped, so a
 * caller walking ranges beside its own edge list stays in step.
 */
export interface RibbonRange {
  readonly id: string;
  /** The first vertex, as an index into the attribute arrays by VERTEX not by float. */
  readonly vertexStart: number;
  readonly vertexCount: number;
  /** The first index, as an offset into {@link RibbonGeometry.index}. Three per triangle. */
  readonly indexStart: number;
  readonly indexCount: number;
}

/**
 * The attribute arrays and the triangle index for a whole scene of ribbons.
 *
 * `Float32Array` throughout, which is what a `BufferGeometry` attribute wants
 * and is enough for the coordinates a layout produces: a campaign 100,000 world
 * units across resolves to about 0.008 of a unit at its far corner, four orders
 * of magnitude under a device pixel at the zoom that would show it.
 */
export interface RibbonGeometry {
  /** The centreline point each vertex sits on, world units, 2 floats per vertex. */
  readonly position: Float32Array;

  /**
   * Which way and how far this vertex leaves the centreline, in half widths, 2
   * floats per vertex. Unit length on a straight run; `1 / cos(turn / 2)` long
   * at a mitred corner, which is exactly what keeps the boundary parallel to
   * the centreline through the corner; zero at the centre vertex of a bevel.
   */
  readonly offset: Float32Array;

  /**
   * The same quantity as a signed fraction of the half width, 1 float per
   * vertex: `+1` on the left of the direction of travel, `-1` on the right, `0`
   * on the centreline.
   *
   * Not derivable from {@link offset}, which is longer than 1 at a miter while
   * this stays at 1, and that difference is the point: the PERPENDICULAR
   * distance from the centreline at a miter vertex is exactly one half width,
   * which is what makes an interpolated `across` the true distance across every
   * triangle rather than an approximation of it.
   */
  readonly across: Float32Array;

  /**
   * Distance from this route's first point along its centreline, in world
   * units, 1 float per vertex. Restarts at zero for each route, which keeps the
   * magnitude near the length of one edge rather than the length of a scene:
   * the dash phase is a fraction of this multiplied by the zoom, and a
   * float32 with six digits of headroom left is what keeps a dash from
   * shimmering at the far end of a long ribbon.
   *
   * Both ribs of a bevelled corner carry the SAME arc length, so a dash runs
   * continuously through a join. The wedge between them is therefore at one
   * phase across its whole area: a dash edge that lands exactly on a bevelled
   * corner draws that wedge entirely on or entirely off, which is a notch of a
   * pixel or two at a turn sharper than 120 degrees.
   */
  readonly arc: Float32Array;

  /** Triangles, three indices each, wound counter-clockwise. */
  readonly index: Uint32Array;

  /** One per input route, in input order. See {@link RibbonRange}. */
  readonly ranges: readonly RibbonRange[];

  /** Vertices, not floats. `position.length` is twice this. */
  readonly vertexCount: number;

  /** Indices, not triangles. `index.length` is this. */
  readonly indexCount: number;
}

/**
 * The arrays under construction, before they are copied into a
 * {@link RibbonGeometry}.
 *
 * Plain `number[]`, so the doubles are live at the same moment as the typed
 * arrays they are copied into: at the campaign's polyline scale that is about
 * 4.6 MB of accumulator against 2.5 MB of buffers, and `'smooth'` multiplies
 * both. The alternative is a counting pass before the walk, which would let
 * the typed arrays be allocated once and written directly, and it is not taken
 * here because the count depends on which joins mitre and which fan, so the
 * counting pass would have to repeat the join decisions and could disagree
 * with the walk in a way that writes past an end. It is the right change when
 * a profile asks for it, and the right shape for it is to return the counts
 * from the same function that makes the decisions rather than to duplicate
 * them.
 */
interface RibbonBuilder {
  readonly position: number[];
  readonly offset: number[];
  readonly across: number[];
  readonly arc: number[];
  readonly index: number[];
}

/** A pair of boundary vertices at one centreline point, left side and right side. */
interface Rib {
  readonly left: number;
  readonly right: number;
}

/**
 * One straight run of a cleaned centreline, with everything the walk needs
 * about it: its two points, its UNIT direction, and the arc length at each end.
 *
 * Precomputed into records rather than read back out of the point array by
 * index, which is what keeps the walk free of index guards: a direction is
 * meaningless without the pair of points it came from, and a record says so.
 * The unit direction exists because both the normal and the turn test want it,
 * and a normalisation is a `hypot` and two divides that no join should repeat.
 */
interface Segment {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly dx: number;
  readonly dy: number;
  readonly arcFrom: number;
  readonly arcTo: number;
}

/**
 * The segments of a cleaned centreline. Every length is above
 * {@link MIN_SEGMENT_WORLD}, because {@link cleanCentreline} ran first, so the
 * division that normalises a direction here cannot be by zero.
 */
function segmentsOf(points: readonly Vec2[]): Segment[] {
  const segments: Segment[] = [];
  let from: Vec2 | undefined;
  let arc = 0;
  for (const to of points) {
    if (from !== undefined) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      segments.push({ from, to, dx: dx / length, dy: dy / length, arcFrom: arc, arcTo: arc + length });
      arc += length;
    }
    from = to;
  }
  return segments;
}

/** Appends one vertex and returns its index. */
function pushVertex(
  out: RibbonBuilder,
  point: Vec2,
  offsetX: number,
  offsetY: number,
  across: number,
  arc: number,
): number {
  const index = out.across.length;
  out.position.push(point.x, point.y);
  out.offset.push(offsetX, offsetY);
  out.across.push(across);
  out.arc.push(arc);
  return index;
}

/**
 * Appends the two boundary vertices at one centreline point, offset along
 * `(normalX, normalY)` scaled by `scale`.
 *
 * `scale` is 1 for a plain rib and the miter length for a mitred corner. Both
 * vertices keep `across` at exactly `+1` and `-1` whatever the scale is: see
 * {@link RibbonGeometry.across} for why that is the correct distance and not an
 * approximation of one.
 */
function pushRib(
  out: RibbonBuilder,
  point: Vec2,
  normalX: number,
  normalY: number,
  scale: number,
  arc: number,
): Rib {
  const offsetX = normalX * scale;
  const offsetY = normalY * scale;
  return {
    left: pushVertex(out, point, offsetX, offsetY, 1, arc),
    right: pushVertex(out, point, -offsetX, -offsetY, -1, arc),
  };
}

/**
 * Fills the quad between two consecutive ribs with two triangles, wound
 * counter-clockwise while the ribbon is narrower on screen than its segments
 * are long.
 *
 * The vertex ORDER is a property of the construction rather than of the data:
 * `left` is the `(-dy, dx)` side of the direction of travel for every rib, so
 * the pair below is counter-clockwise whichever way the ribbon runs. What is
 * not unconditional is the RESULT, because a mitred rib's vertices sit off the
 * centreline point and can cross the ones before them. See
 * {@link tessellateCentreline} for the bound, which is measured rather than
 * asserted, and for why nothing here can clamp it. The tests check the winding
 * over every triangle of every shape in the suite, at widths inside that
 * bound, because a mesh that is half back-facing is invisible under
 * `FrontSide` in a way that looks like a missing draw call.
 */
function bridgeRibs(out: RibbonBuilder, previous: Rib, next: Rib): void {
  out.index.push(previous.left, previous.right, next.right);
  out.index.push(previous.left, next.right, next.left);
}

/**
 * Drops the points a tessellator cannot use: non-finite coordinates are
 * rejected, and a point closer to its predecessor than {@link MIN_SEGMENT_WORLD}
 * is discarded.
 *
 * The rejection is here rather than left to arithmetic because a `NaN`
 * coordinate does not produce a wrong drawing, it produces NO drawing: three
 * computes a bounding sphere with a `NaN` radius, the frustum test rejects it,
 * and an entire scene of ribbons disappears with nothing logged anywhere. The
 * message names the route and the index, since a caller with 7,000 routes needs
 * to know which one.
 */
function cleanCentreline(points: readonly Vec2[], field: string): Vec2[] {
  const kept: Vec2[] = [];
  for (const [i, point] of points.entries()) {
    requireFinite(point.x, `${field}[${String(i)}].x`);
    requireFinite(point.y, `${field}[${String(i)}].y`);
    const previous = kept.at(-1);
    if (previous !== undefined) {
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      if (Math.hypot(dx, dy) < MIN_SEGMENT_WORLD) continue;
    }
    kept.push({ x: point.x, y: point.y });
  }
  return kept;
}

/**
 * The two interior Bezier control points for the span from `p1` to `p2`, from a
 * centripetal Catmull-Rom spline through `p0, p1, p2, p3`.
 *
 * The non-uniform Catmull-Rom tangents, in the form that reads as what it is:
 * with knots spaced by `|delta|^alpha`, the tangent at `p1` is
 * `(p1 - p0)/(t1 - t0) - (p2 - p0)/(t2 - t0) + (p2 - p1)/(t2 - t1)`, and a cubic
 * Bezier's first control point is a third of the span's knot width along it.
 * Uniform spacing reduces this to the familiar `(p2 - p0) / 2`, which is the
 * cheapest way to read the formula and check it by eye.
 *
 * What the tests can see of it, since this is not exported: the curve passes
 * through every control point, and the direction of travel through one is
 * continuous, which is the property the knot spacing buys. That second one is
 * asserted as a RATE rather than as a bound, because two chords meeting at a
 * knot differ by the curvature times their length even on a perfectly smooth
 * curve: the angle halves when the flattening step halves, where a real corner
 * would hold its angle at every step.
 *
 * `p0` equal to `p1`, or `p3` equal to `p2`, is how the first and last spans of
 * a route arrive: there is no neighbour beyond the end, and the knot width
 * would be zero, so the tangent is taken ONE-SIDED as `(p2 - p1)` over its own
 * knot width. That places the control point a third of the way along the span,
 * which is the straight line, so a two-point route stays exactly straight
 * through `'smooth'` rather than acquiring a curve nobody asked for.
 */
function catmullRomControls(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): [Vec2, Vec2] {
  const w1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) ** CATMULL_ROM_ALPHA;
  const w2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) ** CATMULL_ROM_ALPHA;
  const w3 = Math.hypot(p3.x - p2.x, p3.y - p2.y) ** CATMULL_ROM_ALPHA;

  // The span's own chord, which every branch below needs.
  const spanX = (p2.x - p1.x) / w2;
  const spanY = (p2.y - p1.y) / w2;

  let startX = spanX;
  let startY = spanY;
  if (w1 > 0) {
    startX = (p1.x - p0.x) / w1 - (p2.x - p0.x) / (w1 + w2) + spanX;
    startY = (p1.y - p0.y) / w1 - (p2.y - p0.y) / (w1 + w2) + spanY;
  }

  let endX = spanX;
  let endY = spanY;
  if (w3 > 0) {
    endX = spanX - (p3.x - p1.x) / (w2 + w3) + (p3.x - p2.x) / w3;
    endY = spanY - (p3.y - p1.y) / (w2 + w3) + (p3.y - p2.y) / w3;
  }

  return [
    { x: p1.x + (startX * w2) / 3, y: p1.y + (startY * w2) / 3 },
    { x: p2.x - (endX * w2) / 3, y: p2.y - (endY * w2) / 3 },
  ];
}

/** The distance from `point` to the infinite line through `a` and `b`, or to `a` if they coincide. */
function distanceToChord(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs(dx * (a.y - point.y) - dy * (a.x - point.x)) / length;
}

/** The point half way between two others, which is every step of a de Casteljau split. */
function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Appends the flattening of one cubic Bezier to `out`, excluding its first
 * point and including its last.
 *
 * Recursive de Casteljau subdivision at the midpoint, stopping when both
 * interior control points are within `toleranceWorld` of the chord. That test is
 * conservative in the direction that matters: a cubic lies inside the convex
 * hull of its control points, so a control polygon that is flat to it
 * bounds the curve's own deviation by the same number.
 *
 * Excluding the first point is what lets a caller chain spans without
 * de-duplicating the shared endpoints, and the endpoints are emitted EXACTLY as
 * given rather than as a subdivision of themselves, so a flattened route still
 * passes through the coordinates the layout chose.
 */
function flattenCubic(
  out: Vec2[],
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  toleranceWorld: number,
  depth: number,
): void {
  const flat =
    distanceToChord(p1, p0, p3) <= toleranceWorld &&
    distanceToChord(p2, p0, p3) <= toleranceWorld;
  if (flat || depth >= MAX_FLATTEN_DEPTH) {
    out.push({ x: p3.x, y: p3.y });
    return;
  }

  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const middle = midpoint(p012, p123);

  flattenCubic(out, p0, p01, p012, middle, toleranceWorld, depth + 1);
  flattenCubic(out, middle, p123, p23, p3, toleranceWorld, depth + 1);
}

/**
 * The mean length of a cleaned centreline's segments, which is what
 * {@link DEFAULT_FLATTEN_TOLERANCE_FRACTION} is a fraction of.
 *
 * The mean rather than the total, so the tolerance a route gets does not depend
 * on how many crossings its edge happens to span: two routes stepping the same
 * distance between layers get the same tolerance whether one of them is twice
 * as long. A route with one segment gets that segment.
 */
function meanSegmentLength(points: readonly Vec2[]): number {
  let total = 0;
  let previous: Vec2 | undefined;
  for (const point of points) {
    if (previous !== undefined) total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total / (points.length - 1);
}

/**
 * A polyline through the same points, bent: the centripetal Catmull-Rom spline
 * through `points`, flattened to `toleranceWorld`.
 *
 * Every input point survives into the output, at its own coordinate. Two points
 * come back unchanged, because a one-sided tangent at both ends is the straight
 * line and subdividing it produces its own endpoints.
 *
 * Exported for the tests, which assert the curve's properties (through every
 * point, no kink at a join, within tolerance of the curve) on the polyline
 * rather than through the vertices it later becomes. It takes a cleaned
 * centreline: two consecutive identical points make a zero knot width and a
 * `NaN` tangent, which is what {@link cleanCentreline} exists to remove.
 */
export function smoothCentreline(points: readonly Vec2[], toleranceWorld: number): Vec2[] {
  const out: Vec2[] = [];
  const span = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): void => {
    if (out.length === 0) out.push({ x: p1.x, y: p1.y });
    const [b1, b2] = catmullRomControls(p0, p1, p2, p3);
    flattenCubic(out, p1, b1, b2, p2, toleranceWorld, 0);
  };

  // A four point window carried in locals rather than read back out of the
  // array, so nothing here can index past an end: `from` and `to` are the span
  // being drawn, `before` and the loop's `point` are the neighbours that shape
  // its two tangents. A missing neighbour at either end is the one-sided case
  // `catmullRomControls` takes as the endpoint repeated.
  let before: Vec2 | undefined;
  let from: Vec2 | undefined;
  let to: Vec2 | undefined;
  for (const point of points) {
    if (from !== undefined && to !== undefined) span(before ?? from, from, to, point);
    before = from;
    from = to;
    to = point;
  }
  if (from !== undefined && to !== undefined) span(before ?? from, from, to, to);
  return out;
}

/**
 * Walks one cleaned centreline, appending its vertices and triangles.
 *
 * ## The joins, which is what M4.5 is actually about
 *
 * At an interior point the two adjacent segments have unit left normals `a` and
 * `b`. The boundary that stays parallel to both meets at the point
 * `bisector * miter`, where the bisector is the normalised `a + b` and the
 * miter length is `1 / cos(turn / 2)`. That length is `2 / |a + b|`, which is
 * where the arithmetic below comes from: `|a + b|` is `2 cos(turn / 2)` for two
 * unit vectors, so the miter needs no trigonometry and no normalisation of its
 * own, and the test that decides whether to miter at all is the same quantity
 * compared against `2 / miterLimit`.
 *
 * **Under the limit the corner is ONE rib.** Both sides share it, the two
 * quads meeting there share its vertices, and there is no seam and no overlap.
 *
 * **Over the limit the corner is TWO ribs and a fan**, and the shape of that
 * fallback is the whole of "joins that do not pinch". Each segment keeps its
 * own rib, at its own normal, so every boundary vertex stays exactly one half
 * width from ITS OWN segment's centreline: nothing narrows, which is what a
 * pinch is. The outer side of the turn would then be a missing triangle, so the
 * gap is filled from the centreline point out to the two outer vertices. The
 * inner side overlaps instead of gapping, and that is deliberate: a shared
 * inner vertex is the alternative, and at a hairpin it sits far up the bisector
 * inside the ribbon's own doubled-back body, which is exactly the fold the
 * ROADMAP entry names.
 *
 * **The fan gets a midpoint past 120 degrees, and that number is a ramp
 * width.** A flat chord across the corner would be one triangle, and `across`
 * would run from 0 at the centreline to 1 at the chord over a distance of
 * `expand * cos(turn / 2)` rather than `expand`, so the one-pixel coverage
 * ramp of {@link ribbonCoverage} is compressed by that cosine: half a pixel at
 * a 120 degree turn, a sixth of one at 160. On the campaign that is not a
 * corner case, which is what settled it: 43% of its routes contain a join past
 * 120 degrees and 4,952 joins turn past 160, so a flat chord would put a hard
 * aliased edge on thousands of hairpin tips. Splitting the fan so that no
 * facet spans more than 120 degrees holds the ramp at half a pixel or better,
 * and since a turn is under 180 degrees that is at most ONE extra vertex per
 * bevelled corner. Its direction is the normalised bisector, which the miter
 * test has already computed.
 *
 * The fan therefore rounds the corner rather than cutting across it, and the
 * outer boundary sits at one half width all the way round instead of dipping
 * to `cos(turn / 2)` of it in the middle. That is a better join than the bevel
 * this started as, for one vertex.
 *
 * **The overlap costs one pixel and it is worth doing the blending.** Two
 * draws of one colour compose to `1 - (1 - a1)(1 - a2)`, which is at least
 * either alpha alone, so the overlap can only make a fragment MORE opaque.
 * Through most of the wedge one of the two is a fully covered interior fragment
 * and the result is the ribbon's own colour. The exception is where the two
 * antialiased edges cross, which is a spot about a pixel across at the inside
 * of the corner, and there the wedge reads as opaque where a single draw would
 * have read about three quarters. That is the whole of the artefact, against a
 * fold that would be visible at any width.
 *
 * A 180 degree reversal is the degenerate case of the same path: `a + b` is
 * zero, the miter length is infinite, the limit sends it to the fallback, and
 * the fan is skipped because an exact reversal has no turn direction, so
 * neither side is the outside. The result is a butt-ended reversal rather than
 * a `NaN`. No divisor here is ever the zero that produced it: the division by
 * `|a + b|` for the miter happens only on the branch that has established it is
 * at least `2 / miterLimit`, and the fan's midpoint falls back to the direction
 * of travel, which is where the bisector would have pointed had it had a
 * direction.
 *
 * ## Where this mesh stops being well formed, measured
 *
 * A mitred corner moves each of its two vertices ALONG the segments it joins,
 * back along one and forward along the other, by `expand * tan(turn / 2)`.
 * `expand` is the half width the VERTEX STAGE uses, which is the visible half
 * width plus {@link RIBBON_AA_PADDING_PIXELS} and not the visible one.
 *
 * The quad between two joins inverts into a bow tie, one triangle back-facing
 * and so invisible under `FrontSide`, once
 *
 * ```
 * segment length on screen < expand * |tan(turn in / 2) + tan(turn out / 2)|
 * ```
 *
 * **The turns are SIGNED and the sum is taken before the absolute value**,
 * which is the correction a review made to the first version of this
 * paragraph. Two turns the same way add, so they invert soonest; two turns the
 * opposite way subtract, and cancel EXACTLY only when their magnitudes match.
 * A 119 degree turn against a 30 degree one back is 3.57 pixels at
 * `expand` 2.5, not zero. The first version of this claimed opposite turns
 * never invert, and the test pinning it happened to use 90 against 90, which
 * is the one case where the cancellation is exact.
 *
 * The formula is exact rather than an estimate: the tests measure the last
 * length that inverts at four same-way angles and three unequal opposite pairs,
 * to within 0.005 world units. With the default miter limit each term is at
 * most `tan(60 degrees)`, so the worst case is `3.46 * (halfWidth + 1)`
 * pixels, 8.7 for a 3 pixel ribbon. A route's FIRST and LAST segments have a
 * join at one end only, so their bound is the single term.
 *
 * A Sugiyama dummy chain alternates its bends as it steps through the layers,
 * so its turns partly cancel, but the reason it clears the bound is the
 * simpler one: its segments are a rank apart. At `rankSep` 50 and the ladder
 * scene's fitted zoom of about 0.45 CSS pixels per world unit, that is 22
 * pixels against a worst case of 8.7.
 *
 * **Nothing here can clamp it, and that is the screen-space width decision
 * again.** The bound is in pixels, the segment is in world units, and no
 * tessellation knows the zoom. The fix, if a screenshot ever shows a hole, is
 * one more per-vertex float carrying the corner's own cap in world units,
 * `min(previous, next) / (2 * tan(turn / 2))`, and a `min` against it in the
 * vertex stage. That trades the hole for the ribbon narrowing through a tight
 * corner, which is what every line renderer does at this scale, and it costs
 * one attribute and one instruction.
 */
function tessellateCentreline(
  out: RibbonBuilder,
  points: readonly Vec2[],
  miterLimit: number,
): void {
  // `|a + b|` at or above this mitres, below it bevels. The comparison is on
  // the bisector's LENGTH so that the miter length, which is unbounded on the
  // other branch, is never computed there. See the docstring.
  const bisectorFloor = 2 / miterLimit;

  let previous: Segment | undefined;
  let rib: Rib | undefined;
  for (const segment of segmentsOf(points)) {
    if (previous === undefined || rib === undefined) {
      rib = pushRib(out, segment.from, -segment.dy, segment.dx, 1, segment.arcFrom);
      previous = segment;
      continue;
    }

    const inX = -previous.dy;
    const inY = previous.dx;
    const outX = -segment.dy;
    const outY = segment.dx;
    const sumX = inX + outX;
    const sumY = inY + outY;
    const bisector = Math.hypot(sumX, sumY);

    if (bisector >= bisectorFloor) {
      // Mitred: one shared corner at `bisector direction * miter length`, which
      // is `(sum / bisector) * (2 / bisector)` and so needs no normalisation.
      const mitred = pushRib(out, segment.from, sumX, sumY, 2 / (bisector * bisector), segment.arcFrom);
      bridgeRibs(out, rib, mitred);
      rib = mitred;
      previous = segment;
      continue;
    }

    const incoming = pushRib(out, segment.from, inX, inY, 1, segment.arcFrom);
    bridgeRibs(out, rib, incoming);
    const outgoing = pushRib(out, segment.from, outX, outY, 1, segment.arcFrom);
    const cross = previous.dx * segment.dy - previous.dy * segment.dx;
    if (cross !== 0) {
      // Turning left puts the outside of the corner on the right, so the arc
      // runs along the NEGATIVE normals; turning right mirrors both.
      const side = cross > 0 ? -1 : 1;
      const centre = pushVertex(out, segment.from, 0, 0, 0, segment.arcFrom);
      const first = cross > 0 ? incoming.right : incoming.left;
      const last = cross > 0 ? outgoing.right : outgoing.left;
      const facets: number[] = [first];
      if (bisector < 1) {
        // Past 120 degrees the arc gets a midpoint, which is the normalised
        // bisector on the outer side, or the direction of travel when the two
        // normals cancel and the bisector has no direction of its own. See the
        // ramp paragraph in this function's docstring for the 120.
        const midX = bisector > 0 ? sumX / bisector : previous.dx;
        const midY = bisector > 0 ? sumY / bisector : previous.dy;
        facets.push(
          pushVertex(out, segment.from, side * midX, side * midY, side, segment.arcFrom),
        );
      }
      facets.push(last);
      for (let facet = 1; facet < facets.length; facet += 1) {
        const from = facets[facet - 1];
        const to = facets[facet];
        if (from === undefined || to === undefined) continue;
        // Counter-clockwise either way: a left turn walks the right side from
        // the incoming normal round to the outgoing one, a right turn walks
        // the left side the other way.
        if (cross > 0) out.index.push(centre, from, to);
        else out.index.push(centre, to, from);
      }
    }
    rib = outgoing;
    previous = segment;
  }

  if (previous === undefined || rib === undefined) return;
  const end = pushRib(out, previous.to, -previous.dy, previous.dx, 1, previous.arcTo);
  bridgeRibs(out, rib, end);
}

/** Resolves and validates the options once, so the walk below reads no defaults. */
function requireRibbonOptions(options: RibbonOptions | undefined): {
  readonly smooth: boolean;
  readonly miterLimit: number;
  /** Absolute world units, or undefined to take the relative default per route. */
  readonly flattenToleranceWorld: number | undefined;
} {
  const curve = options?.curve ?? 'polyline';
  if (curve !== 'polyline' && curve !== 'smooth') {
    throw new RangeError(`options.curve has to be "polyline" or "smooth", got ${String(curve)}`);
  }
  return {
    smooth: curve === 'smooth',
    miterLimit: requireAtLeast(options?.miterLimit ?? DEFAULT_MITER_LIMIT, 1, 'options.miterLimit'),
    flattenToleranceWorld:
      options?.flattenToleranceWorld === undefined
        ? undefined
        : requirePositive(options.flattenToleranceWorld, 'options.flattenToleranceWorld'),
  };
}

/**
 * Turns routes into one mesh's worth of ribbon geometry.
 *
 * The whole scene in one pass, because the scene is one draw: see the module
 * docstring on why edges are not instanced. Nothing here reads a camera or a
 * zoom, which is the property that makes the result durable, so the only thing
 * that invalidates it is a layout that moved.
 *
 * Order is the caller's order. Vertices are appended route by route, so a
 * range's vertices are contiguous and so are its triangles, and a caller can
 * fill a colour attribute or a picking id over a slice without a lookup table.
 *
 * **One call is one STYLE, not one scene, and that follows from two decisions
 * elsewhere.** Whether there is a dash at all is a material-build branch (see
 * {@link RibbonCoverageInput.dash}), and M4.3 settled that layering has to come
 * from separate meshes drawn in a chosen order rather than from ordering within
 * one draw, because a slot's position is not durable. So a scene that wants
 * dashed routed edges under solid overlay lines, or a highlighted path over
 * dimmed ones, calls this once per group and draws the results in the order it
 * wants them. Sorting routes into groups inside this function would bake a
 * drawing decision into a tessellator.
 *
 * A caller that wants dashes NOT phase locked to each other can offset one
 * route's phase by adding to its slice of {@link RibbonGeometry.arc}, which is
 * what the ranges make cheap: `arc` feeds nothing but the dash, so an offset
 * there is a phase and nothing else. Worth doing, because every route starting
 * at arc zero means every edge leaving a node breaks at the same distance from
 * it, and at one flow speed a whole scene marches in step.
 */
export function tessellateRibbons(
  routes: Iterable<RibbonRoute>,
  options?: RibbonOptions,
): RibbonGeometry {
  const resolved = requireRibbonOptions(options);
  const out: RibbonBuilder = { position: [], offset: [], across: [], arc: [], index: [] };
  const ranges: RibbonRange[] = [];

  for (const route of routes) {
    const vertexStart = out.across.length;
    const indexStart = out.index.length;
    const cleaned = cleanCentreline(route.points, `route "${route.id}"`);
    // Flattened points go through the cleaner a second time, which is not
    // belt and braces: `segmentsOf` divides by a segment's length, and the
    // subdivision of a span shorter than the tolerance can put two of its
    // output points at one place. One zero-length segment there is a `NaN` in
    // every vertex after it, and a `NaN` in a bounding sphere is a scene that
    // does not draw at all.
    const centreline =
      resolved.smooth && cleaned.length >= 2
        ? cleanCentreline(
            smoothCentreline(
              cleaned,
              resolved.flattenToleranceWorld ??
                DEFAULT_FLATTEN_TOLERANCE_FRACTION * meanSegmentLength(cleaned),
            ),
            `route "${route.id}" flattened`,
          )
        : cleaned;
    if (centreline.length >= 2) tessellateCentreline(out, centreline, resolved.miterLimit);
    ranges.push({
      id: route.id,
      vertexStart,
      vertexCount: out.across.length - vertexStart,
      indexStart,
      indexCount: out.index.length - indexStart,
    });
  }

  return {
    position: new Float32Array(out.position),
    offset: new Float32Array(out.offset),
    across: new Float32Array(out.across),
    arc: new Float32Array(out.arc),
    index: new Uint32Array(out.index),
    ranges,
    vertexCount: out.across.length,
    indexCount: out.index.length,
  };
}

/**
 * The nine primitives of `sdf.ts` plus `fract`, which is the ONE operation the
 * dash needs and the nine cannot express.
 *
 * A tenth primitive is a cost this file would rather not pay, and it is paid
 * here rather than in `sdf.ts` for a reason worth stating: `Arith` is the
 * interface every shape formula is written over, and widening it would put an
 * operation in `tslArith` that no shape uses and that the shape tests would
 * carry forever. A dash is periodic, periodicity needs a wrap, and a wrap needs
 * a `floor` somewhere. Declaring the extension beside its only consumer keeps
 * `sdf.ts`'s count of nine honest and keeps this one at exactly ten.
 *
 * `fract` rather than `floor` because it is the WGSL intrinsic and the JS
 * definition matches it exactly, including for negative inputs: both are
 * `x - floor(x)`, so a flow that has run backwards past zero wraps the same way
 * on both backends. `x - Math.trunc(x)` does not, which is why the
 * implementation below is spelled out.
 */
export interface DashArith<T> extends Arith<T> {
  /** `x - floor(x)`, in `[0, 1)` for every finite input including negatives. */
  fract(a: T): T;
}

/** The ten primitives on plain numbers: what `test/ribbon.test.ts` runs the dash through. */
export const numberDashArith: DashArith<number> = {
  literal: (value) => value,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  abs: (a) => Math.abs(a),
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  sqrt: (a) => Math.sqrt(a),
  fract: (a) => a - Math.floor(a),
};

/** The dash pattern at one fragment. Every field is in DEVICE pixels except {@link duty}. */
export interface RibbonDash<T> {
  /** {@link RibbonGeometry.arc} at this fragment, converted to device pixels. */
  readonly arcPixels: T;

  /** The length of one dash plus one gap. */
  readonly periodPixels: T;

  /** The fraction of the period that is drawn, in `(0, 1)`. See {@link requireRibbonStyle}. */
  readonly duty: T;

  /**
   * How far the pattern has travelled towards the TARGET, in pixels. Advance it
   * with {@link advanceDashFlow}; increasing it moves the dashes along the
   * route's authored direction, which is what makes the animation read as
   * direction and is why this package draws no arrowheads.
   */
  readonly flowPixels: T;
}

/** What a ribbon's fragment stage needs. Both widths are in DEVICE pixels. */
export interface RibbonCoverageInput<T> {
  /**
   * The interpolated {@link RibbonGeometry.across}: `+1` and `-1` at the
   * geometry's own boundary, which is the visible edge plus
   * {@link RIBBON_AA_PADDING_PIXELS}.
   */
  readonly across: T;

  /** Half the ribbon's visible width. */
  readonly halfWidthPixels: T;

  /**
   * The dash pattern, or nothing for a solid ribbon.
   *
   * Omitting it removes the dash arithmetic from the expression tree
   * ENTIRELY, rather than switching it off with a value. That branch is taken
   * when a material is built and never per fragment, so a solid ribbon's
   * shader contains no `fract` and no divide it does not use, and a caller
   * cannot express "solid" as a duty that happens to round to one.
   *
   * `?: T | undefined` rather than `?: T`, as everything optional on this
   * surface is: see {@link RibbonOptions} for the argument.
   */
  readonly dash?: RibbonDash<T> | undefined;
}

/**
 * The signed distance from a fragment to the nearest edge of its dash, in
 * device pixels: negative inside a dash, positive in a gap.
 *
 * **Measured from the middle of the period, which is the whole of the
 * spelling.** `fract` puts the fragment somewhere in `[0, 1)` of the period,
 * subtracting a half centres the dash in it, and the absolute value makes the
 * distance symmetric, so the leading edge of every dash gets the same ramp as
 * its trailing edge. Measured from the START of the period instead, the
 * distance across the wrap belongs to the wrong dash, and every dash's leading
 * edge is a hard step with its ramp only on the trailing side.
 *
 * A gap narrower than a pixel is antialiased as a distance rather than as a
 * coverage, which is the same approximation `outlineCoverage` documents for a
 * hairline band: a gap of a tenth of a pixel dips the alpha to about 0.4 rather
 * than to 0.9. That is the reason {@link requireRibbonStyle} keeps the duty
 * cycle strictly below 1 and asks for a solid ribbon to be spelled as no dash
 * at all, since at a duty of 1 the gap has no width and the dip would be a
 * half-alpha seam once per period along a line that is supposed to be solid.
 */
export function dashDistance<T>(m: DashArith<T>, dash: RibbonDash<T>): T {
  const half = m.literal(0.5);
  const phase = m.div(m.sub(dash.arcPixels, dash.flowPixels), dash.periodPixels);
  const fromCentre = m.abs(m.sub(m.fract(phase), half));
  return m.mul(m.sub(fromCentre, m.mul(dash.duty, half)), dash.periodPixels);
}

/**
 * How much of a device pixel the ribbon covers: the width and the dash pattern
 * as ONE signed distance, put through the same {@link fillCoverage} every shape
 * in this package uses.
 *
 * The whole function is in device pixels, so the `aaWidth` handed to the
 * coverage is the literal 1: one pixel is one unit here by construction. That
 * is the screen-space width decision paying for itself. Nothing in this
 * expression is a derivative, a uniform about the camera, or a fold of the kind
 * `antialiasWidth` exists to route around.
 *
 * Across the ribbon the distance is
 * `|across| * (halfWidth + padding) - halfWidth`: `across` reaches 1 at the
 * geometry's edge, and the geometry is built one pixel proud of the visible
 * one, so the ramp is entirely inside the triangles and never clipped by them.
 * Along the ribbon it is {@link dashDistance}, when there is a dash at all.
 *
 * `max` of the two is the standard distance-field intersection and the same
 * idiom `outlineCoverage` uses. It means the corner where a dash ends at the
 * ribbon's edge is antialiased by ONE ramp: a product of two coverages would
 * read 0.25 there where this reads 0.5, which is a notch at the end of every
 * dash in the drawing.
 *
 * ## The one boundary this does NOT ramp, stated rather than discovered
 *
 * {@link RIBBON_AA_PADDING_PIXELS} pads the geometry ACROSS the ribbon and
 * nothing pads it along, so a route's first and last ribs sit exactly on its
 * endpoints and there is no along-axis term here to fade them. A butt cap is
 * therefore a hard edge, and on a route running at an angle it is a staircase
 * one pixel deep. It is the one boundary in this package that a distance field
 * does not soften. Tolerable because M2.8 attaches both ends of every routed
 * edge to a node's BORDER, so the cap is drawn against the box it arrives at,
 * and the overlay edges stage 2 draws between tiles end the same way. Fixing it
 * needs an along-axis distance, which needs the route's length at every vertex:
 * another attribute, and worth it only if a screenshot says so.
 *
 * A bevel's outer chord used to be the second one, compressing this ramp by
 * `cos(turn / 2)`. {@link tessellateCentreline} fans the corner instead, which
 * holds every facet at 120 degrees or less and the ramp at half a pixel or
 * better, so that deferral is closed rather than outstanding.
 */
export function ribbonCoverage<T>(m: DashArith<T>, input: RibbonCoverageInput<T>): T {
  const expand = m.add(input.halfWidthPixels, m.literal(RIBBON_AA_PADDING_PIXELS));
  const across = m.sub(m.mul(m.abs(input.across), expand), input.halfWidthPixels);
  const distance = input.dash === undefined ? across : m.max(across, dashDistance(m, input.dash));
  return fillCoverage(m, distance, m.literal(1));
}

/**
 * Moves a dash pattern one frame along, wrapped into `[0, period)`.
 *
 * **The wrap is the function.** An unwrapped accumulator is a number that grows
 * without bound, and this one is multiplied into a float32 varying: at 60
 * frames a second and 40 pixels a second, an hour of an idle tab reaches
 * 144,000 pixels, where a float32 resolves about 0.01 of one, and the dash
 * pattern quantises visibly before that. Wrapping loses nothing, because the
 * pattern is periodic and `phase` in {@link ribbonCoverage} takes a `fract` of
 * it anyway.
 *
 * A negative `speedPixelsPerSecond` flows the pattern back towards the source,
 * which is the natural way to draw a reversed edge, so the wrap is a modulo
 * that returns a positive residue rather than a remainder that keeps the sign.
 *
 * `dtSeconds` is not clamped here. A backgrounded tab hands back a delta of
 * many seconds, and for a periodic pattern that is not a hazard: the result is
 * still in range, and the only visible consequence is that the dashes are
 * somewhere else when the tab comes back, which they would be anyway. M4.6's
 * integrator is where a long frame does need an opinion.
 */
/** What {@link ribbonWidthAt} needs to decide a frame's width. */
export interface RibbonWidthInput {
  /**
   * How wide the ribbon would be if it DID scale with the scene, as a half
   * width in world units.
   *
   * The quantity a scene actually has an opinion about: an edge between boxes
   * tens of units across is a world unit or two wide, and saying so is what
   * lets the two rules below be arithmetic rather than taste.
   */
  readonly worldHalfWidth: number;

  /** The camera's zoom times the device pixel ratio. */
  readonly pixelsPerWorldUnit: number;

  /** The thinnest the ribbon may be drawn. Below about 0.5 the ramp eats it. */
  readonly minHalfWidthPixels: number;

  /** The widest it may be drawn, which is what stops a deep zoom paving the viewport. */
  readonly maxHalfWidthPixels: number;
}

/** A width to draw at, and the alpha that keeps it honest. See {@link ribbonWidthAt}. */
export interface RibbonWidth {
  readonly halfWidthPixels: number;
  /** A multiplier for the ribbon's own alpha, at most 1. */
  readonly alpha: number;
}

/**
 * The half width and alpha for one frame: a constant pixel width is the right
 * DEFAULT and this is the correction at the two ends where it is wrong.
 *
 * The module docstring records why the width is in screen space and what it
 * costs, and this function is the remedy it names. Both rules are one line:
 *
 * ```
 * halfWidthPixels = clamp(worldHalfWidth * pixelsPerWorldUnit, min, max)
 * alpha           = min(1, ideal / min)
 * ```
 *
 * **The fade is the half that matters, and it conserves ink.** Below the floor
 * the ribbon is being drawn WIDER than the scene says it is, because a ramp
 * needs half a pixel either side and a thinner band would fade out entirely
 * rather than get thinner. Drawing it at the floor and fading its alpha by the
 * same ratio puts the same total coverage on screen as the honest width would
 * have: `halfWidthPixels * alpha` is exactly `ideal` everywhere the fade is
 * engaged. That identity is the test, and it is what stops the far view being
 * a mat of edge ink: the campaign has 110.9M world units of centreline, which
 * at the zoom floor is far more line than there is viewport, and the fix is
 * for each line to carry less of it rather than for any line to disappear.
 *
 * The ceiling is the duller end and needs no fade: a ribbon that would be forty
 * pixels wide at card zoom is clamped to the maximum and stays opaque, because
 * there is no ink being conserved, only a slab nobody asked for.
 *
 * Nothing here reads a camera: `pixelsPerWorldUnit` is passed in, so this is
 * arithmetic a test can run at every zoom in one loop rather than behaviour
 * that needs a frame.
 */
export function ribbonWidthAt(input: RibbonWidthInput): RibbonWidth {
  requirePositive(input.worldHalfWidth, 'worldHalfWidth');
  requirePositive(input.pixelsPerWorldUnit, 'pixelsPerWorldUnit');
  requireAtLeast(input.minHalfWidthPixels, 0.5, 'minHalfWidthPixels');
  requireAtLeast(input.maxHalfWidthPixels, input.minHalfWidthPixels, 'maxHalfWidthPixels');

  const ideal = input.worldHalfWidth * input.pixelsPerWorldUnit;
  const halfWidthPixels = Math.min(
    Math.max(ideal, input.minHalfWidthPixels),
    input.maxHalfWidthPixels,
  );
  return { halfWidthPixels, alpha: Math.min(1, ideal / input.minHalfWidthPixels) };
}

export function advanceDashFlow(
  flowPixels: number,
  speedPixelsPerSecond: number,
  dtSeconds: number,
  periodPixels: number,
): number {
  requireFinite(flowPixels, 'flowPixels');
  requireFinite(speedPixelsPerSecond, 'speedPixelsPerSecond');
  requireFinite(dtSeconds, 'dtSeconds');
  requirePositive(periodPixels, 'periodPixels');
  const advanced = flowPixels + speedPixelsPerSecond * dtSeconds;
  return advanced - Math.floor(advanced / periodPixels) * periodPixels;
}

/**
 * A dash pattern as a CALLER declares it, in DEVICE pixels: the shape of the
 * pattern, without the per-fragment quantities.
 *
 * The counterpart of {@link RibbonDash}, which is what a fragment evaluates,
 * and named rather than inlined into {@link RibbonStyle} so that the code
 * mapping one to the other can annotate its parameter. The difference between
 * the two is where the difference between a declaration and a frame is:
 * `speedPixelsPerSecond` is a rate a caller chooses once, `flowPixels` is
 * where that rate has got to, and {@link advanceDashFlow} is the step between
 * them.
 */
export interface RibbonDashStyle {
  /** One dash plus one gap. */
  readonly periodPixels: number;
  /** The drawn fraction of the period, strictly inside `(0, 1)`. */
  readonly duty: number;
  /** How fast the pattern travels towards the target. Negative flows the other way. */
  readonly speedPixelsPerSecond: number;
}

/** How a ribbon is drawn: its width, and its dash pattern if it has one. All DEVICE pixels. */
export interface RibbonStyle {
  /** Half the visible width. Below about 0.5 the ribbon is thinner than the ramp that draws it. */
  readonly halfWidthPixels: number;

  /**
   * The dash pattern, or nothing for a solid ribbon. See
   * {@link RibbonCoverageInput.dash} for what the absence buys, and
   * {@link RibbonOptions} for why this is `?: T | undefined` and not `?: T`.
   */
  readonly dash?: RibbonDashStyle | undefined;
}

/**
 * Rejects a style a ribbon cannot be drawn with, naming the field.
 *
 * The boundary the module docstring names, and it is a separate function
 * because {@link ribbonCoverage} must not contain one: a check inside a
 * coverage function costs ALU on every fragment and cannot throw anywhere a
 * caller would see it.
 *
 * `halfWidthPixels` is floored at half a pixel rather than at zero. Below that
 * the visible band is narrower than the one pixel ramp that draws it, so the
 * ribbon does not get thinner, it gets fainter and then disappears, which is a
 * caller's arithmetic bug arriving as an empty screen.
 *
 * `duty` is STRICTLY inside `(0, 1)` at both ends, and each end rules out a
 * different way of asking for a ribbon with no pattern on it. At 0 every dash
 * has no length and the ribbon draws nothing. At 1 every gap has no width, and
 * a zero-width gap is still a boundary to a distance field, so
 * {@link fillCoverage} reads exactly half a pixel of coverage at it: a solid
 * line with a half-alpha seam once per period. A ribbon with no dashes is
 * spelled by leaving {@link RibbonStyle.dash} out, which removes the
 * arithmetic rather than neutralising it.
 */
export function requireRibbonStyle(style: RibbonStyle, field = 'style'): RibbonStyle {
  requireAtLeast(style.halfWidthPixels, 0.5, `${field}.halfWidthPixels`);
  if (style.dash === undefined) return style;
  requirePositive(style.dash.periodPixels, `${field}.dash.periodPixels`);
  if (!(style.dash.duty > 0) || style.dash.duty >= 1) {
    throw new RangeError(
      `${field}.dash.duty has to be a number above 0 and below 1, got ${String(style.dash.duty)}`,
    );
  }
  requireFinite(style.dash.speedPixelsPerSecond, `${field}.dash.speedPixelsPerSecond`);
  return style;
}
