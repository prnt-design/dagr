import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MITER_LIMIT,
  FAN_RADIUS_TOLERANCE,
  MAX_FAN_FACET_RADIANS,
  MIN_SEGMENT_WORLD,
  RIBBON_AA_PADDING_PIXELS,
  advanceDashFlow,
  numberDashArith,
  ribbonWidthAt,
  requireRibbonStyle,
  ribbonCoverage,
  smoothCentreline,
  tessellateRibbons,
} from '../src/ribbon.js';
import type { RibbonDash, RibbonGeometry, RibbonRoute } from '../src/ribbon.js';
import type { Vec2 } from '../src/types.js';

/**
 * M4.5's arithmetic, executed.
 *
 * Everything the ribbon shader evaluates is in `ribbon.ts` over
 * {@link DashArith}, so this file runs the real expression trees on plain
 * numbers: the joins, the flattening, the dash pattern and the coverage ramp.
 * `test/ribbon-nodes.test.ts` then asserts that the same trees BUILD in TSL,
 * and the committed screenshot is the only evidence that WGSL agrees with
 * `Math` about them.
 *
 * The properties worth naming, because they are the ones the ROADMAP entry
 * asks for and the ones a reviewer should check the assertions against:
 *
 * - **No pinch.** Every boundary vertex is exactly one half width from the
 *   SKELETON, at every turn angle and every miter limit: from the centreline of
 *   a segment it belongs to, or, for the midpoint of a fan, from the corner
 *   point the fan rounds. A ribbon that narrowed at a corner would fail that
 *   for the vertex that narrowed it.
 * - **No inversion.** Every triangle is wound counter-clockwise, so none of
 *   them is invisible under `FrontSide`. Bounded rather than unconditional, and
 *   the bound is MEASURED below rather than asserted: a mitred corner moves
 *   each vertex along the segments it joins by `expand * tan(turn / 2)`, where
 *   `expand` is the half width plus the antialiasing padding, and two turns in
 *   the SAME direction bracketing one segment both pull back on the same side
 *   of it while opposite turns partly cancel, so the sum is SIGNED and the
 *   absolute value comes after it. The last length that inverts is pinned at
 *   four same-way angles and three unequal opposite pairs. Equal and opposite
 *   is the one pair that cancels exactly, and an earlier version of this suite
 *   used it alone and read as proving that opposite turns never invert.
 * - **Scale freedom.** Nothing in the tessellation reads a zoom or a width, so
 *   the same vertices are correct at every camera. The tests exercise that by
 *   expanding one geometry at several half widths.
 */

/** An entry that must be there: the arrays are this file's own, indexed by its own arithmetic. */
function at(values: Float32Array | Uint32Array, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`no entry at index ${String(index)}`);
  return value;
}

/** A two point route, for the cases that need one and do not care about its shape. */
const straightPoints: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

/** One route through the tessellator, which is the shape of nearly every case below. */
function ribbonOf(points: readonly Vec2[], options?: Parameters<typeof tessellateRibbons>[1]) {
  return tessellateRibbons([{ id: 'e1', points }], options);
}

/** Where a vertex ends up on screen, in world units, at a given half width. */
function worldVertex(geometry: RibbonGeometry, index: number, halfWidth: number): Vec2 {
  return {
    x: at(geometry.position, index * 2) + at(geometry.offset, index * 2) * halfWidth,
    y: at(geometry.position, index * 2 + 1) + at(geometry.offset, index * 2 + 1) * halfWidth,
  };
}

/** Twice the signed area of a triangle: positive is counter-clockwise. */
function signedArea(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/** The perpendicular distance from a point to the infinite line through `a` and `b`. */
function distanceToLine(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx * (a.y - point.y) - dy * (a.x - point.x)) / Math.hypot(dx, dy);
}

/** Every triangle of a geometry, expanded to world positions at `halfWidth`. */
function triangles(geometry: RibbonGeometry, halfWidth: number): [Vec2, Vec2, Vec2][] {
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < geometry.indexCount; i += 3) {
    out.push([
      worldVertex(geometry, at(geometry.index, i), halfWidth),
      worldVertex(geometry, at(geometry.index, i + 1), halfWidth),
      worldVertex(geometry, at(geometry.index, i + 2), halfWidth),
    ]);
  }
  return out;
}

/**
 * A polyline that arrives along +x and TURNS by `degrees` at the origin, with
 * arms of `arm` world units. A tuple, so the sweeps below can name the two
 * segments without an index guard on each one.
 */
function corner(degrees: number, arm = 100): [Vec2, Vec2, Vec2] {
  const radians = (degrees * Math.PI) / 180;
  return [
    { x: -arm, y: 0 },
    { x: 0, y: 0 },
    { x: arm * Math.cos(radians), y: arm * Math.sin(radians) },
  ];
}

describe('tessellateRibbons: a straight ribbon', () => {
  const geometry = ribbonOf([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);

  it('is four vertices and two triangles', () => {
    expect(geometry.vertexCount).toBe(4);
    expect(geometry.indexCount).toBe(6);
    expect(geometry.position).toHaveLength(8);
    expect(geometry.offset).toHaveLength(8);
    expect(geometry.across).toHaveLength(4);
    expect(geometry.arc).toHaveLength(4);
  });

  it('puts both vertices of a rib on the centreline point they belong to', () => {
    // The offset is what moves them apart, and it does so in the vertex shader.
    // Two vertices at one position with opposite offsets is what makes the
    // width a camera decision rather than a tessellation one.
    expect([...geometry.position]).toEqual([0, 0, 0, 0, 100, 0, 100, 0]);
  });

  it('offsets left then right, perpendicular to the direction of travel', () => {
    // Left is `(-dy, dx)` of the unit direction, which for a run along +x is
    // +y. The order matters to `bridgeRibs`, whose winding depends on it. The
    // negative zeroes are `-dy` of a zero `dy`, written out rather than
    // normalised away: a signed zero costs a vertex shader nothing, and adding
    // an operation per vertex to erase one would be paying for tidiness.
    expect([...geometry.offset]).toEqual([-0, 1, 0, -1, -0, 1, 0, -1]);
    expect([...geometry.across]).toEqual([1, -1, 1, -1]);
  });

  it('measures arc length along the centreline, from zero', () => {
    expect([...geometry.arc]).toEqual([0, 0, 100, 100]);
  });

  it('winds both triangles counter-clockwise', () => {
    for (const triangle of triangles(geometry, 2)) {
      expect(signedArea(...triangle)).toBeGreaterThan(0);
    }
  });

  it('is the same geometry whatever the half width, because it holds none', () => {
    // The scale-freedom property stated as a test: expanding the same vertices
    // at 1 and at 40 gives similar shapes, so a camera can change the width
    // between two frames without re-tessellating anything.
    const thin = triangles(geometry, 1);
    const thick = triangles(geometry, 40);
    expect(thin).toHaveLength(thick.length);
    for (const [index, triangle] of thin.entries()) {
      const other = thick[index];
      if (other === undefined) throw new Error('unreachable');
      expect(signedArea(...other) / signedArea(...triangle)).toBeCloseTo(40, 6);
    }
  });
});

describe('tessellateRibbons: joins', () => {
  it('mitres a gentle corner into one shared rib', () => {
    // Three points, six vertices: the corner is ONE rib, so the two quads that
    // meet there share both its vertices and there is no seam to antialias
    // twice and no overlap to blend twice.
    const geometry = ribbonOf(corner(90));
    expect(geometry.vertexCount).toBe(6);
    expect(geometry.indexCount).toBe(12);
  });

  it('gives a mitred corner the length that keeps the boundary parallel', () => {
    // `1 / cos(turn / 2)`, which is the whole of the miter formula. A 90 degree
    // turn is 1.4142, and the same number read the other way is what the tests
    // below check as a distance: the corner vertex is one half width from BOTH
    // segments, which is what "does not pinch" means at a corner.
    const geometry = ribbonOf(corner(90));
    const offsetLength = Math.hypot(at(geometry.offset, 4), at(geometry.offset, 5));
    expect(offsetLength).toBeCloseTo(1 / Math.cos(Math.PI / 4), 12);
  });

  it('falls back past the miter limit, into two ribs and a fan', () => {
    // A 150 degree turn wants a miter of `1 / cos(75 degrees)` = 3.86, which is
    // over the limit of 2, so the corner becomes two ribs (four vertices), the
    // centreline vertex the fan is drawn from, and the arc between them: 150
    // degrees at `MAX_FAN_FACET_RADIANS` is five facets, so four more
    // vertices, thirteen in all and five triangles of fan.
    const geometry = ribbonOf(corner(150));
    expect(geometry.vertexCount).toBe(13);
    expect(geometry.indexCount).toBe(27);
    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const length = Math.hypot(at(geometry.offset, i * 2), at(geometry.offset, i * 2 + 1));
      expect(length).toBeLessThanOrEqual(1);
    }
  });

  it('fills the outer side of a bevel exactly, from the centreline', () => {
    // The wedge is the third triangle, and its three corners are the centreline
    // point and the two OUTER boundary vertices of the ribs either side. Those
    // are the same vertices the two quads use, so the outer boundary is
    // continuous: no gap to show the background through, no overlap to blend.
    const geometry = ribbonOf(corner(150));
    const wedge = [at(geometry.index, 6), at(geometry.index, 7), at(geometry.index, 8)];
    const [centre, first, second] = wedge;
    if (centre === undefined || first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    expect(at(geometry.across, centre)).toBe(0);
    expect(at(geometry.offset, centre * 2)).toBe(0);
    expect(at(geometry.offset, centre * 2 + 1)).toBe(0);
    // A left turn, so the outer side is the right one.
    expect(at(geometry.across, first)).toBe(-1);
    expect(at(geometry.across, second)).toBe(-1);

    // And both of them are vertices the quads either side already use, rather
    // than a second copy at the same coordinate: sharing is what leaves the
    // outer boundary with no seam to antialias twice.
    const uses = (vertex: number): number =>
      [...geometry.index].filter((value) => value === vertex).length;
    expect(uses(first)).toBeGreaterThan(1);
    expect(uses(second)).toBeGreaterThan(1);
  });

  it('keeps a fanned corner within the stated tolerance of the half width', () => {
    // The property the fan exists for, sampled where it can actually FAIL. A
    // fan is an inscribed polygon, so its boundary is exact at each facet's
    // ends and short by `1 - cos(span / 2)` in the middle: sampling vertices
    // only, as the no-pinch sweep does, cannot see it, because an offset is a
    // unit vector there by construction whatever the facet count.
    //
    // The first version of this fan used one midpoint past a hard-coded 120
    // degrees, which left a 179 degree turn two 89.5 degree facets and a
    // boundary at 0.710 of the half width, a 29% narrowing at exactly the
    // hairpins the fan was added for. The threshold was also unrelated to the
    // miter limit, so a limit between 1 and 2 bevelled some turns with no
    // midpoint at all: at 1.5 a 120 degree turn measured 0.500. Hence the
    // sweep over limits as well as angles.
    for (const miterLimit of [1, 1.5, 2, 4]) {
      for (const degrees of [30, 90, 120, 150, 170, 179, -150, -179]) {
        const geometry = ribbonOf(corner(degrees), { miterLimit });
        const outward = degrees < 0 ? 1 : -1;
        const fan: Vec2[] = [];
        for (let vertex = 0; vertex < geometry.vertexCount; vertex += 1) {
          const atCorner =
            at(geometry.position, vertex * 2) === 0 && at(geometry.position, vertex * 2 + 1) === 0;
          if (!atCorner || at(geometry.across, vertex) !== outward) continue;
          fan.push({ x: at(geometry.offset, vertex * 2), y: at(geometry.offset, vertex * 2 + 1) });
        }
        if (fan.length < 2) continue;

        // Ordered by angle to the first spoke, which is branch-cut safe where
        // `atan2` is not, then measured pair by pair: the boundary mid-facet
        // sits at `cos(span / 2)` of the half width.
        const first = fan[0];
        if (first === undefined) throw new Error('unreachable');
        const angles = fan
          .map((v) =>
            Math.acos(
              Math.min(1, Math.max(-1, (first.x * v.x + first.y * v.y) / Math.hypot(v.x, v.y))),
            ),
          )
          .sort((a, b) => a - b);
        for (let i = 1; i < angles.length; i += 1) {
          const previous = angles[i - 1];
          const current = angles[i];
          if (previous === undefined || current === undefined) throw new Error('unreachable');
          const span = current - previous;
          expect(span).toBeLessThanOrEqual(MAX_FAN_FACET_RADIANS + 1e-9);
          expect(Math.cos(span / 2)).toBeGreaterThanOrEqual(1 - FAN_RADIUS_TOLERANCE - 1e-9);
        }
      }
    }
  });

  it('winds the fan counter-clockwise whichever way the route turns', () => {
    for (const degrees of [150, -150, 179, -179]) {
      const geometry = ribbonOf(corner(degrees));
      for (const triangle of triangles(geometry, 2)) {
        expect(signedArea(...triangle)).toBeGreaterThan(0);
      }
    }
  });

  it('never narrows: every boundary vertex is one half width from a segment', () => {
    // THE no-pinch assertion, swept over the whole range of turns and both
    // directions. A vertex on the boundary (`across` of plus or minus one) has
    // to lie exactly one half width from the centreline of a segment it belongs
    // to. A join that pinched would pull one of them closer; a join that
    // spiked past the limit would push one further from every segment.
    const halfWidth = 2.5;
    for (let degrees = -179; degrees <= 179; degrees += 1) {
      if (degrees === 0) continue;
      const [start, bend, end] = corner(degrees);
      const geometry = ribbonOf([start, bend, end]);
      const segments: [Vec2, Vec2][] = [
        [start, bend],
        [bend, end],
      ];
      /** How far a point is from the join's own centreline point. */
      const fromBend = (point: Vec2): number => Math.hypot(point.x - bend.x, point.y - bend.y);
      // Winding over the same sweep, because `bridgeRibs` claims it and the
      // arms here are 100 world units against a bound of 4.3, which is well
      // inside the regime that claim is bounded by.
      for (const triangle of triangles(geometry, halfWidth)) {
        expect(signedArea(...triangle)).toBeGreaterThan(0);
      }
      for (let vertex = 0; vertex < geometry.vertexCount; vertex += 1) {
        if (at(geometry.across, vertex) === 0) continue;
        const world = worldVertex(geometry, vertex, halfWidth);
        // Three ways to be on the boundary, and every boundary vertex is on it
        // by one of them: a half width from either segment's centreline, or a
        // half width from the corner POINT, which is where a fan's midpoint
        // sits. The fan rounds the corner, so its arc is measured from the
        // corner rather than from a segment.
        const distances = [
          ...segments.map(([a, b]) => distanceToLine(world, a, b)),
          fromBend(world),
        ];
        // The tolerance is float32's, not the arithmetic's: the attributes are
        // `Float32Array`, so an offset built from coordinates of order 100
        // comes back with about 1e-5 of a world unit of rounding in it.
        expect(Math.min(...distances.map((d) => Math.abs(d - halfWidth)))).toBeLessThan(1e-4);
      }
    }
  });

  it('keeps every corner within the miter limit of the centreline', () => {
    // The other half of the same property: the boundary never travels further
    // from the centreline than the limit allows, so a sharp turn cannot throw a
    // dart across the drawing. Asserted at the default limit and at a limit of
    // 8, which mitres turns up to 166 degrees.
    for (const miterLimit of [DEFAULT_MITER_LIMIT, 8]) {
      for (let degrees = -179; degrees <= 179; degrees += 1) {
        if (degrees === 0) continue;
        const geometry = ribbonOf(corner(degrees), { miterLimit });
        for (let vertex = 0; vertex < geometry.vertexCount; vertex += 1) {
          const length = Math.hypot(at(geometry.offset, vertex * 2), at(geometry.offset, vertex * 2 + 1));
          expect(length).toBeLessThanOrEqual(miterLimit + 1e-12);
        }
      }
    }
  });

  it('bevels every corner at a miter limit of 1', () => {
    // The floor of the option, and the reason it is a floor: a limit of 1 says
    // "never travel further than a straight run would", which no turn at all
    // can satisfy, so every corner bevels. Useful as a way to see the fallback
    // on ordinary input, and cheap to state as a property.
    const geometry = ribbonOf(corner(20), { miterLimit: 1 });
    expect(geometry.vertexCount).toBe(9);
  });

  it('survives a 180 degree reversal with no wedge and no NaN', () => {
    // The degenerate join: the two normals cancel, the miter length is
    // infinite, the limit sends it to the bevel, and the wedge is skipped
    // because the centre and both outer vertices are collinear. What matters is
    // that nothing here is a division by the zero that produced it.
    const geometry = ribbonOf([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(geometry.vertexCount).toBe(8);
    expect([...geometry.offset].every((value) => Number.isFinite(value))).toBe(true);
    expect([...geometry.position].every((value) => Number.isFinite(value))).toBe(true);
  });

  it('moves a mitred corner along its segments by expand times tan(turn / 2)', () => {
    // The term the inversion bound is built from. `expand` here is whatever
    // scale the vertex stage applies, which in the shader is the half width
    // PLUS the antialiasing padding, so the bound below is quoted against that
    // number and not against the visible half width.
    const expand = 4;
    for (const degrees of [30, 60, 90, 119]) {
      // Vertex 2 is the LEFT side of the corner rib, and a left turn puts the
      // left side on the inside of it, which is the end pulled back along the
      // incoming segment.
      const inner = worldVertex(ribbonOf(corner(degrees)), 2, expand);
      expect(-inner.x).toBeCloseTo(expand * Math.tan((degrees * Math.PI) / 360), 5);
    }
  });

  it('inverts a quad only below the measured length, signed turn by signed turn', () => {
    // The bound stated exactly, because the previous version of this claim was
    // wrong in two ways at once and both understated it: it quoted the visible
    // half width where the vertex stage uses the padded one, and it counted
    // ONE end of the segment where two same-direction turns pull back on the
    // same side of it, while opposite turns partly cancel. Measured here to
    // 0.005 world units, against `expand * |tan(in / 2) + tan(out / 2)|`,
    // where the absolute value comes AFTER the sum: writing it without the
    // bars is the exact ambiguity that produced the original error.
    //
    // Opposite turns SUBTRACT rather than cancel, and only match exactly when
    // their magnitudes do. A Sugiyama dummy chain steps left, right, left as
    // it crosses the layers, so its turns do partly cancel, but what actually
    // keeps it clear of this bound is that its segments are a rank apart.
    const expand = 2.5;
    const wellFormed = (points: readonly Vec2[]): boolean =>
      triangles(ribbonOf(points), expand).every((triangle) => signedArea(...triangle) > 0);

    /** Turns of `into` then `outOf` degrees bracketing a segment of `length`. */
    const bracket = (into: number, outOf: number, length: number): Vec2[] => {
      const first = (into * Math.PI) / 180;
      const second = ((into + outOf) * Math.PI) / 180;
      const bend = { x: length * Math.cos(first), y: length * Math.sin(first) };
      return [
        { x: -200, y: 0 },
        { x: 0, y: 0 },
        bend,
        { x: bend.x + 200 * Math.cos(second), y: bend.y + 200 * Math.sin(second) },
      ];
    };

    const halfTan = (degrees: number): number => Math.tan((degrees * Math.PI) / 360);
    const boundOf = (into: number, outOf: number): number =>
      expand * Math.abs(halfTan(into) + halfTan(outOf));

    // Same way, so the two terms add. Bracketed at half a hundredth of a world
    // unit, which is where the formula is exact rather than approximate: a
    // percentage bracket would pass with the second decimal wrong.
    for (const degrees of [30, 60, 90, 119]) {
      const bound = boundOf(degrees, degrees);
      expect(wellFormed(bracket(degrees, degrees, bound - 0.005))).toBe(false);
      expect(wellFormed(bracket(degrees, degrees, bound + 0.005))).toBe(true);
    }

    // Opposite ways with UNEQUAL magnitudes, which is the case the first
    // version of this test missed: it used 90 against 90, where the two terms
    // cancel exactly, and read as proving that opposite turns never invert.
    // They do, at a shorter length than same-way turns rather than never.
    for (const [into, outOf] of [
      [119, -30],
      [119, -60],
      [40, -100],
    ] as const) {
      const bound = boundOf(into, outOf);
      expect(bound).toBeGreaterThan(0);
      expect(wellFormed(bracket(into, outOf, bound - 0.005))).toBe(false);
      expect(wellFormed(bracket(into, outOf, bound + 0.005))).toBe(true);
    }

    // Equal and opposite is the one case that does cancel, at any length.
    for (const length of [0.5, 2, 5, 20]) {
      expect(wellFormed(bracket(90, -90, length))).toBe(true);
      expect(wellFormed(bracket(30, -30, length))).toBe(true);
    }
  });

  it('winds every triangle of a many-bend chain counter-clockwise', () => {
    // What M2.4b's dummy chains turn into: an edge spanning many ranks is a
    // polyline with a point per rank, bending both ways. Half a device pixel of
    // width against 60 world units of segment is the regime the demo runs in.
    const points: Vec2[] = [];
    for (let rank = 0; rank <= 12; rank += 1) {
      points.push({ x: rank * 60, y: rank % 2 === 0 ? 0 : 45 });
    }
    const geometry = ribbonOf(points);
    for (const triangle of triangles(geometry, 1.5)) {
      expect(signedArea(...triangle)).toBeGreaterThan(0);
    }
    expect(at(geometry.arc, geometry.vertexCount - 1)).toBeCloseTo(12 * Math.hypot(60, 45), 4);
  });
});

describe('tessellateRibbons: routes that cannot be drawn', () => {
  it('gives a self loop an empty range rather than a NaN', () => {
    // `polylineRouteStage` in `@dagr/layout` documents a self loop as two
    // identical points at one node's centre, so this is the shortest route the
    // campaign contains and it has no direction at all.
    const geometry = ribbonOf([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(geometry.vertexCount).toBe(0);
    expect(geometry.indexCount).toBe(0);
    expect(geometry.ranges).toEqual([
      { id: 'e1', vertexStart: 0, vertexCount: 0, indexStart: 0, indexCount: 0 },
    ]);
  });

  it('gives an empty or single point route an empty range', () => {
    expect(ribbonOf([]).vertexCount).toBe(0);
    expect(ribbonOf([{ x: 1, y: 2 }]).vertexCount).toBe(0);
  });

  it('drops a repeated point instead of dividing by its zero length', () => {
    const withRepeat = ribbonOf([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
    ]);
    const without = ribbonOf([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect([...withRepeat.position]).toEqual([...without.position]);
    expect([...withRepeat.offset]).toEqual([...without.offset]);
  });

  it('drops a point closer than the minimum segment length', () => {
    const geometry = ribbonOf([
      { x: 0, y: 0 },
      { x: MIN_SEGMENT_WORLD / 2, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(geometry.vertexCount).toBe(4);
  });

  it('rejects a non-finite coordinate, naming the route and the index', () => {
    // A `NaN` coordinate does not draw a wrong picture, it draws none: three
    // computes a `NaN` bounding sphere, the frustum test rejects the mesh, and
    // a whole scene of ribbons vanishes with nothing logged. So it is a
    // `RangeError` at the boundary, per the package rule in `errors.ts`.
    expect(() =>
      ribbonOf([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 3 },
      ]),
    ).toThrow(/route "e1"\[1\]\.x/);
    expect(() =>
      ribbonOf([
        { x: 0, y: 0 },
        { x: 3, y: Number.POSITIVE_INFINITY },
      ]),
    ).toThrow(/route "e1"\[1\]\.y/);
  });

  it('rejects options it cannot honour, naming the field', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(() => ribbonOf(points, { miterLimit: 0.9 })).toThrow(/options\.miterLimit/);
    expect(() => ribbonOf(points, { flattenToleranceWorld: 0 })).toThrow(/options\.flattenTolerance/);
    expect(() =>
      ribbonOf(points, { curve: 'bezier' as unknown as 'smooth' }),
    ).toThrow(/options\.curve/);
  });
});

describe('tessellateRibbons: many routes', () => {
  const routes: RibbonRoute[] = [
    {
      id: 'a',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
    { id: 'b', points: [{ x: 4, y: 4 }] },
    {
      id: 'c',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 30 },
        { x: 20, y: 60 },
      ],
    },
  ];
  const geometry = tessellateRibbons(routes);

  it('reports one range per route, in input order, including the empty one', () => {
    expect(geometry.ranges.map((range) => range.id)).toEqual(['a', 'b', 'c']);
    expect(geometry.ranges.map((range) => range.vertexCount)).toEqual([4, 0, 6]);
  });

  it('partitions the arrays exactly, so a caller can write into a slice', () => {
    // What the ranges are FOR: colouring one edge, fading the overlay kinds, or
    // highlighting a hovered path is a write into a slice of an attribute
    // array, which needs the slices to tile the whole buffer with no gap.
    let vertices = 0;
    let indices = 0;
    for (const range of geometry.ranges) {
      expect(range.vertexStart).toBe(vertices);
      expect(range.indexStart).toBe(indices);
      vertices += range.vertexCount;
      indices += range.indexCount;
    }
    expect(vertices).toBe(geometry.vertexCount);
    expect(indices).toBe(geometry.indexCount);
  });

  it('indexes only vertices inside the route that emitted them', () => {
    for (const range of geometry.ranges) {
      for (let i = range.indexStart; i < range.indexStart + range.indexCount; i += 1) {
        expect(at(geometry.index, i)).toBeGreaterThanOrEqual(range.vertexStart);
        expect(at(geometry.index, i)).toBeLessThan(range.vertexStart + range.vertexCount);
      }
    }
  });

  it('restarts the arc length at zero for each route', () => {
    // Per route rather than per scene, which keeps the magnitude near the
    // length of one edge: the dash phase multiplies this by the zoom into a
    // float32 varying, and a scene-wide accumulator would spend its precision
    // on the offset rather than on the pattern.
    for (const range of geometry.ranges) {
      if (range.vertexCount === 0) continue;
      expect(at(geometry.arc, range.vertexStart)).toBe(0);
    }
  });
});

describe('smoothCentreline', () => {
  const points: Vec2[] = [
    { x: 0, y: 0 },
    { x: 50, y: 40 },
    { x: 130, y: 30 },
    { x: 180, y: 90 },
  ];

  it('passes through every control point', () => {
    // The property that makes a smoothed route still a LAYOUT: a dummy's
    // coordinate is where the order stage decided the edge crosses that rank,
    // so a curve that used the points as a cage and missed them would undo the
    // work it came from.
    const curve = smoothCentreline(points, 0.05);
    for (const point of points) {
      expect(curve.some((q) => q.x === point.x && q.y === point.y)).toBe(true);
    }
    expect(curve[0]).toEqual(points[0]);
    expect(curve.at(-1)).toEqual(points.at(-1));
  });

  it('leaves a two point route exactly straight', () => {
    // A one-sided tangent at both ends is the straight line, so `'smooth'` on a
    // route with no bend adds nothing. This is what lets the demo run overlay
    // edges and routed edges through the same call.
    const straight = smoothCentreline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 25 },
      ],
      0.05,
    );
    expect(straight).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 25 },
    ]);
  });

  it('leaves collinear points collinear', () => {
    const straight = smoothCentreline(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 100, y: 0 },
      ],
      0.05,
    );
    for (const point of straight) expect(point.y).toBe(0);
  });

  it('turns a corner into a curve with no kink at the control point', () => {
    // Centripetal Catmull-Rom is C1 at its knots, so the direction of travel
    // through a control point is continuous, and the two spans either side are
    // separate cubics that have to agree there. A tangent formula with the knot
    // spacing wrong (the uniform one, say) still passes through every point and
    // shows up here instead, as the corner the smoothing was supposed to
    // remove.
    //
    // What a chord can see of a tangent is the assertion's shape. Two chords
    // meeting at a knot differ by the curvature times their length even on a
    // perfectly smooth curve, so the number is not zero and a fixed bound would
    // be a magic constant. It HALVES when the step halves, which a real corner
    // would not do: the unsmoothed polyline turns 1.0 radians here whatever the
    // flattening.
    const angleAt = (tolerance: number): number => {
      const curve = smoothCentreline(points, tolerance);
      const knot = curve.findIndex((q) => q.x === 130 && q.y === 30);
      expect(knot).toBeGreaterThan(0);
      const before = curve[knot - 1];
      const here = curve[knot];
      const after = curve[knot + 1];
      if (before === undefined || here === undefined || after === undefined) {
        throw new Error('unreachable');
      }
      const incoming = Math.atan2(here.y - before.y, here.x - before.x);
      const outgoing = Math.atan2(after.y - here.y, after.x - here.x);
      return Math.abs(incoming - outgoing);
    };

    const coarse = angleAt(0.05);
    const fine = angleAt(0.001);
    expect(coarse).toBeLessThan(0.1);
    expect(fine / coarse).toBeGreaterThan(0.4);
    expect(fine / coarse).toBeLessThan(0.6);
  });

  it('stays within the tolerance of the curve it flattens', () => {
    // The tolerance is a promise about the drawing: a flattened curve is within
    // this many world units of the true one, which is half a device pixel while
    // `tolerance * pixelsPerWorldUnit <= 0.5`. Asserted by refining: a curve
    // flattened at a tenth of the tolerance is a stand-in for the true curve,
    // and every one of its points has to lie within the tolerance of the
    // coarser polyline.
    const coarse = smoothCentreline(points, 0.5);
    const fine = smoothCentreline(points, 0.005);
    for (const sample of fine) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let i = 1; i < coarse.length; i += 1) {
        const a = coarse[i - 1];
        const b = coarse[i];
        if (a === undefined || b === undefined) throw new Error('unreachable');
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.min(
          1,
          Math.max(0, ((sample.x - a.x) * dx + (sample.y - a.y) * dy) / (dx * dx + dy * dy)),
        );
        nearest = Math.min(nearest, Math.hypot(sample.x - (a.x + t * dx), sample.y - (a.y + t * dy)));
      }
      expect(nearest).toBeLessThanOrEqual(0.5);
    }
  });

  it('spends more points on a tighter tolerance', () => {
    expect(smoothCentreline(points, 0.005).length).toBeGreaterThan(
      smoothCentreline(points, 0.5).length,
    );
  });

  it('stops at the recursion cap, which bounds one span at 64 segments', () => {
    // The cap is the only thing between a pathological control polygon and the
    // stack, and deleting it left every other test green. A tolerance of 1e-9
    // on a scene-sized curve cannot be met at any depth, so every span
    // subdivides all the way: three spans of 2^6 segments each, plus the first
    // point, is 193.
    expect(smoothCentreline(points, 1e-9)).toHaveLength(3 * 64 + 1);
  });

  it('is deterministic, same points same polyline', () => {
    expect(smoothCentreline(points, 0.05)).toEqual(smoothCentreline(points, 0.05));
  });
});

describe('tessellateRibbons: the smooth curve', () => {
  it('draws the curve rather than the control polygon', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 130, y: 30 },
    ];
    const smooth = ribbonOf(points, { curve: 'smooth' });
    const polyline = ribbonOf(points);
    expect(smooth.vertexCount).toBeGreaterThan(polyline.vertexCount);
  });

  it('mitres every join of a flattened curve, because they are gentle', () => {
    // A flattening produces small turns by construction, so a smoothed route
    // is all mitres and no bevels, which is exactly two vertices per flattened
    // point. A bevel would add five, so the count is the assertion.
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 130, y: 30 },
      { x: 180, y: 90 },
    ];
    // An explicit tolerance on both sides, because the DEFAULT is relative to
    // each route's mean segment and this test wants one number it can hand to
    // both the tessellator and the flattener.
    const geometry = ribbonOf(points, { curve: 'smooth', flattenToleranceWorld: 0.05 });
    expect(geometry.vertexCount).toBe(2 * smoothCentreline(points, 0.05).length);
    for (const triangle of triangles(geometry, 1.5)) {
      expect(signedArea(...triangle)).toBeGreaterThan(0);
    }
  });
});

describe('ribbonCoverage', () => {
  /** A solid ribbon three device pixels wide, at its own centreline. */
  const solid = { across: 0, halfWidthPixels: 1.5 };

  /** The same ribbon with a dash pattern: twelve pixels, half of it drawn. */
  const dashed = {
    ...solid,
    dash: { arcPixels: 0, periodPixels: 12, duty: 0.5, flowPixels: 0 },
  };

  it('covers the middle of a solid ribbon completely', () => {
    expect(ribbonCoverage(numberDashArith, solid)).toBe(1);
  });

  it('takes a dash that is undefined by construction, and options too', () => {
    // A TYPE regression guard that happens to run. Under this repo's
    // `exactOptionalPropertyTypes`, `dash?: T` and `dash?: T | undefined` are
    // different types and the first rejects an explicitly undefined value,
    // which is exactly what a caller holding an optional style has. Written as
    // variables rather than literals because a literal `undefined` inline is
    // the one spelling the compiler lets through either way.
    const dash: RibbonDash<number> | undefined = undefined;
    expect(ribbonCoverage(numberDashArith, { ...solid, dash })).toBe(1);

    const curve: 'polyline' | 'smooth' | undefined = undefined;
    const flattenToleranceWorld: number | undefined = undefined;
    expect(
      tessellateRibbons([{ id: 'e1', points: straightPoints }], { curve, flattenToleranceWorld })
        .vertexCount,
    ).toBe(4);
  });

  it('has no dash arithmetic at all when there is no dash', () => {
    // The branch is taken when a material is built, not per fragment, so a
    // solid ribbon's shader carries no `fract` and none of the division around
    // it. Asserted through an arith that throws on `fract`, which is the one
    // primitive nothing but the dash uses, and so the only way from here to
    // observe an expression tree that was never built.
    const noDash: typeof numberDashArith = {
      ...numberDashArith,
      fract: () => {
        throw new Error('a solid ribbon evaluated the dash pattern');
      },
    };
    expect(() => ribbonCoverage(noDash, solid)).not.toThrow();
    expect(() => ribbonCoverage(noDash, dashed)).toThrow(/dash pattern/);
  });

  it('is exactly half at the visible edge, at every width', () => {
    // The property `fillCoverage` exists for, inherited here: a ribbon's
    // apparent edge sits where its width says it does. The visible edge is
    // where `|across| * (halfWidth + padding)` equals the half width, which is
    // inside the geometry by exactly the padding. Exact at 1.5 and to twelve
    // places across the sweep, and the residue is this test dividing by the
    // padded width and the coverage multiplying it back, not the ramp: the ramp
    // is exactly a half at a distance of exactly zero.
    const edgeAt = (halfWidthPixels: number): number =>
      halfWidthPixels / (halfWidthPixels + RIBBON_AA_PADDING_PIXELS);
    expect(ribbonCoverage(numberDashArith, { ...solid, across: edgeAt(1.5) })).toBe(0.5);
    for (const halfWidthPixels of [0.5, 1.5, 4, 20]) {
      const across = edgeAt(halfWidthPixels);
      expect(ribbonCoverage(numberDashArith, { halfWidthPixels, across })).toBeCloseTo(0.5, 12);
      expect(ribbonCoverage(numberDashArith, { halfWidthPixels, across: -across })).toBeCloseTo(
        0.5,
        12,
      );
    }
  });

  it('has faded out by the geometry boundary, so the ramp is never clipped', () => {
    // Why the geometry is built a pixel proud of the ribbon: the ramp is one
    // device pixel wide centred on the visible edge, so it needs half a pixel
    // of triangle outside that edge to finish in.
    expect(ribbonCoverage(numberDashArith, { ...solid, across: 1 })).toBe(0);
    expect(ribbonCoverage(numberDashArith, { ...solid, across: -1 })).toBe(0);
  });

  it('ramps over exactly one device pixel across the width', () => {
    const halfWidthPixels = 4;
    const scale = halfWidthPixels + RIBBON_AA_PADDING_PIXELS;
    const at = (fromCentre: number): number =>
      ribbonCoverage(numberDashArith, { halfWidthPixels, across: fromCentre / scale });
    expect(at(halfWidthPixels - 0.5)).toBe(1);
    expect(at(halfWidthPixels + 0.5)).toBe(0);
  });

  it('draws a dash centred in each period and a gap between', () => {
    const covered = (arcPixels: number): number =>
      ribbonCoverage(numberDashArith, { ...dashed, dash: { ...dashed.dash, arcPixels } });
    expect(covered(6)).toBe(1);
    expect(covered(0)).toBe(0);
    expect(covered(12)).toBe(0);
  });

  it('is exactly half at both ends of a dash, not only at one', () => {
    // The wrap-symmetry defect this spelling exists to avoid. Measured from the
    // START of the period, the distance across the wrap belongs to the wrong
    // dash and every dash's leading edge is a hard step with the ramp only on
    // its trailing side. Measured from the CENTRE, as here, the two ends are
    // the same expression with a sign.
    const covered = (arcPixels: number): number =>
      ribbonCoverage(numberDashArith, { ...dashed, dash: { ...dashed.dash, arcPixels } });
    expect(covered(3)).toBe(0.5);
    expect(covered(9)).toBe(0.5);
  });

  it('repeats exactly one period later', () => {
    const covered = (arcPixels: number): number =>
      ribbonCoverage(numberDashArith, {
        ...dashed,
        dash: { ...dashed.dash, periodPixels: 8, arcPixels },
      });
    for (const arcPixels of [0, 1, 2, 3, 5, 7]) {
      expect(covered(arcPixels)).toBe(covered(arcPixels + 8));
    }
  });

  it('moves the pattern towards the target as the flow grows', () => {
    // What makes the animation read as direction: `arc` runs source to target,
    // because `RoutedEdge.points` does, so the dash centred at `flow + period /
    // 2` travels that way as the flow advances. This is the whole reason this
    // package draws no arrowheads.
    const covered = (arcPixels: number, flowPixels: number): number =>
      ribbonCoverage(numberDashArith, { ...dashed, dash: { ...dashed.dash, arcPixels, flowPixels } });
    expect(covered(6, 0)).toBe(1);
    expect(covered(6, 3)).toBe(0.5);
    expect(covered(9, 3)).toBe(1);
    expect(covered(6, 6)).toBe(0);
  });

  it('intersects the width and the dash rather than multiplying them', () => {
    // At the corner where a dash ends AND the ribbon's edge is, the `max` of
    // the two distances gives one ramp of one pixel and a coverage of a half. A
    // product of two coverages would read 0.25 there, which is a notch at the
    // end of every dash in the drawing.
    const across = 1.5 / (1.5 + RIBBON_AA_PADDING_PIXELS);
    const corner = ribbonCoverage(numberDashArith, {
      ...dashed,
      across,
      dash: { ...dashed.dash, arcPixels: 3 },
    });
    expect(corner).toBe(0.5);
  });

  it('wraps a negative phase the way WGSL does', () => {
    // `fract` is `x - floor(x)` on both backends, so a flow that has run past
    // the arc length of a fragment lands in the same place on the GPU as it
    // does here. `x - trunc(x)` would not, which is why the number
    // implementation spells the floor out.
    expect(numberDashArith.fract(-0.25)).toBe(0.75);
    const covered = (arcPixels: number, flowPixels: number): number =>
      ribbonCoverage(numberDashArith, { ...dashed, dash: { ...dashed.dash, arcPixels, flowPixels } });
    expect(covered(-6, -12)).toBe(covered(6, 0));
  });

  it('reads a sub-pixel gap as a distance rather than as a coverage', () => {
    // The approximation `outlineCoverage` documents for a hairline band, stated
    // here because it is the reason a duty of 1 is rejected rather than
    // accepted as "solid". A gap a tenth of a pixel wide covers a tenth of the
    // pixel it sits in, and a distance field ramps to well below that.
    const gap = ribbonCoverage(numberDashArith, {
      ...dashed,
      dash: { ...dashed.dash, duty: 1 - 0.1 / 12, arcPixels: 0 },
    });
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(0.9);
  });
});

describe('advanceDashFlow', () => {
  it('advances by speed times the frame', () => {
    expect(advanceDashFlow(0, 60, 0.5, 100)).toBeCloseTo(30, 12);
  });

  it('wraps into the period rather than growing without bound', () => {
    // The reason the wrap is the function: an unwrapped accumulator reaches
    // 144,000 pixels after an hour at 40 pixels a second, where a float32
    // varying resolves about a hundredth of one and the pattern quantises.
    let flow = 0;
    for (let frame = 0; frame < 20_000; frame += 1) flow = advanceDashFlow(flow, 40, 1 / 60, 12);
    expect(flow).toBeGreaterThanOrEqual(0);
    expect(flow).toBeLessThan(12);
  });

  it('wraps a backwards flow to a positive residue', () => {
    // A negative speed flows towards the source, which is the natural way to
    // draw a reversed edge. A remainder that kept its sign would hand the
    // shader a negative uniform, which `fract` copes with and a reader does not.
    const flow = advanceDashFlow(2, -40, 1, 12);
    expect(flow).toBeGreaterThanOrEqual(0);
    expect(flow).toBeLessThan(12);
    expect(flow).toBeCloseTo(10, 12);
  });

  it('survives a backgrounded tab handing back a long frame', () => {
    const flow = advanceDashFlow(0, 40, 600, 12);
    expect(flow).toBeGreaterThanOrEqual(0);
    expect(flow).toBeLessThan(12);
  });

  it('rejects what it cannot advance, naming the field', () => {
    expect(() => advanceDashFlow(Number.NaN, 40, 1, 12)).toThrow(/flowPixels/);
    expect(() => advanceDashFlow(0, Number.NaN, 1, 12)).toThrow(/speedPixelsPerSecond/);
    expect(() => advanceDashFlow(0, 40, Number.POSITIVE_INFINITY, 12)).toThrow(/dtSeconds/);
    expect(() => advanceDashFlow(0, 40, 1, 0)).toThrow(/periodPixels/);
  });
});

describe('requireRibbonStyle', () => {
  const style = {
    halfWidthPixels: 1.5,
    dash: { periodPixels: 12, duty: 0.6, speedPixelsPerSecond: 24 },
  };

  it('passes a style a ribbon can be drawn with', () => {
    expect(requireRibbonStyle(style)).toBe(style);
  });

  it('passes a solid ribbon, which has no dash to check', () => {
    const noDash = { halfWidthPixels: 2 };
    expect(requireRibbonStyle(noDash)).toBe(noDash);
  });

  it('floors the half width at half a device pixel', () => {
    // Below that the visible band is narrower than the one pixel ramp drawing
    // it, so the ribbon does not get thinner, it gets fainter and then
    // disappears: a caller's arithmetic bug arriving as an empty screen.
    expect(() => requireRibbonStyle({ ...style, halfWidthPixels: 0.4 })).toThrow(
      /style\.halfWidthPixels/,
    );
    expect(requireRibbonStyle({ ...style, halfWidthPixels: 0.5 }).halfWidthPixels).toBe(0.5);
  });

  it('keeps the duty cycle strictly inside (0, 1)', () => {
    // Both ends rule out a different way of asking for a ribbon with no pattern
    // on it: at 0 nothing is drawn, and at 1 the gap has no width, which a
    // distance field still reads as a boundary and covers by exactly a half.
    // Solid is the absence of a dash, not a duty that rounds to one.
    for (const duty of [0, 1, 1.5, Number.NaN]) {
      expect(() => requireRibbonStyle({ ...style, dash: { ...style.dash, duty } })).toThrow(
        /style\.dash\.duty/,
      );
    }
    expect(requireRibbonStyle({ ...style, dash: { ...style.dash, duty: 0.999 } })).toBeDefined();
  });

  it('rejects a period and a speed it cannot use, naming the field', () => {
    expect(() =>
      requireRibbonStyle({ ...style, dash: { ...style.dash, periodPixels: 0 } }),
    ).toThrow(/style\.dash\.periodPixels/);
    expect(() =>
      requireRibbonStyle({ ...style, dash: { ...style.dash, speedPixelsPerSecond: Number.NaN } }),
    ).toThrow(/style\.dash\.speedPixelsPerSecond/);
  });

  it('names the field a caller passes, when it passes one', () => {
    expect(() =>
      requireRibbonStyle({ ...style, dash: { ...style.dash, duty: 2 } }, 'edgeStyle'),
    ).toThrow(/edgeStyle\.dash\.duty/);
  });
});

describe('ribbonWidthAt', () => {
  const limits = { minHalfWidthPixels: 0.5, maxHalfWidthPixels: 4 };

  it('draws the honest width between the floor and the ceiling', () => {
    const width = ribbonWidthAt({ worldHalfWidth: 2, pixelsPerWorldUnit: 1, ...limits });
    expect(width.halfWidthPixels).toBe(2);
    expect(width.alpha).toBe(1);
  });

  it('conserves ink below the floor, which is the whole point of the fade', () => {
    // The identity the far view depends on: a ribbon too thin to draw honestly
    // is drawn at the floor and faded by the same ratio, so the coverage it
    // puts on screen is the coverage the honest width would have. Swept across
    // three decades of zoom below the floor, since that is the range the
    // campaign's fitted view actually spans.
    for (const pixelsPerWorldUnit of [0.001, 0.01, 0.05, 0.1, 0.2, 0.249]) {
      const width = ribbonWidthAt({ worldHalfWidth: 2, pixelsPerWorldUnit, ...limits });
      expect(width.halfWidthPixels).toBe(0.5);
      expect(width.halfWidthPixels * width.alpha).toBeCloseTo(2 * pixelsPerWorldUnit, 12);
      expect(width.alpha).toBeLessThan(1);
    }
  });

  it('never fades above the floor, and never exceeds an alpha of 1', () => {
    for (const pixelsPerWorldUnit of [0.25, 0.5, 1, 10, 1000]) {
      expect(ribbonWidthAt({ worldHalfWidth: 2, pixelsPerWorldUnit, ...limits }).alpha).toBe(1);
    }
  });

  it('clamps at the ceiling without fading, because no ink is being conserved', () => {
    const width = ribbonWidthAt({ worldHalfWidth: 2, pixelsPerWorldUnit: 100, ...limits });
    expect(width.halfWidthPixels).toBe(4);
    expect(width.alpha).toBe(1);
  });

  it('is monotone in the zoom, so a pinch cannot make an edge jump', () => {
    let previous = 0;
    for (let zoom = 0.01; zoom < 20; zoom *= 1.2) {
      const width = ribbonWidthAt({ worldHalfWidth: 2, pixelsPerWorldUnit: zoom, ...limits });
      const drawn = width.halfWidthPixels * width.alpha;
      expect(drawn).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = drawn;
    }
  });

  it('rejects limits it cannot honour, naming the field', () => {
    const base = { worldHalfWidth: 2, pixelsPerWorldUnit: 1, ...limits };
    expect(() => ribbonWidthAt({ ...base, worldHalfWidth: 0 })).toThrow(/worldHalfWidth/);
    expect(() => ribbonWidthAt({ ...base, pixelsPerWorldUnit: 0 })).toThrow(/pixelsPerWorldUnit/);
    expect(() => ribbonWidthAt({ ...base, minHalfWidthPixels: 0.4 })).toThrow(
      /minHalfWidthPixels/,
    );
    expect(() => ribbonWidthAt({ ...base, maxHalfWidthPixels: 0.4 })).toThrow(
      /maxHalfWidthPixels/,
    );
  });
});
