import type { Pair, SdfOps } from './sdf-ops.js';

/**
 * The signed distance fields Dagr draws its nodes with.
 *
 * Both functions are generic over {@link SdfOps}, which is what lets `sdf-tsl.ts`
 * compile these exact lines into a fragment shader while `test/sdf.test.ts` runs
 * them over doubles. See `sdf-ops.ts` for why the maths is written once instead
 * of twice.
 *
 * ## What "signed distance" is promised to mean here
 *
 * The return value is a length IN THE SAME UNITS AS THE INPUTS: negative inside
 * the shape, exactly zero on its boundary, positive outside, and equal in
 * magnitude to the Euclidean distance to the nearest boundary point. That last
 * clause is the one that costs something to keep, and it is the reason for every
 * decision below that looks defensive and is not.
 *
 * Two properties follow from it, and both are pinned by the suite rather than
 * asserted here:
 *
 * **The eikonal property, `|grad d| = 1` almost everywhere.** This is what makes
 * derivative antialiasing correct. `shading.ts` divides a distance by a filter
 * width and treats the quotient as a number of pixels, which it only is if one
 * unit of the field is one unit of space in every direction. A field that merely
 * has the right sign still renders, and renders wrong: the edge thickens and
 * thins as it turns, most visibly around a corner, which is precisely where a
 * rounded rectangle spends its interest.
 *
 * **Homogeneity, `d(k p, k size, k r) = k d(p, size, r)`.** Together with
 * `coverage` being invariant when its two arguments scale together, this is the
 * whole of the "crisp at every zoom" claim: zooming multiplies every distance
 * and every filter width by the same factor, the ratio is unchanged, and the
 * pixel is unchanged. The suite asserts it over six orders of magnitude of
 * scale.
 *
 * ## Sizes are FULL extents
 *
 * `size` is the whole width and the whole height, centred on the origin, halved
 * inside. That is the vocabulary `@dagr/layout` hands out a node box in, and
 * making the caller pre-halve it would put a factor of two at every call site,
 * which is one of the few arithmetic mistakes that looks completely correct in
 * review.
 *
 * ## Nothing here throws
 *
 * This package's rule is that an out-of-range value gets a `RangeError` naming
 * the field, and `camera.ts` follows it everywhere. These functions cannot. They
 * run once per fragment inside a shader, where there is no stack to unwind, no
 * exception mechanism at all, and no caller to catch anything: the TSL backend
 * would not even compile a `throw`. So every value that would otherwise be
 * rejected is instead brought into range BY THE ARITHMETIC, with a `min` or a
 * `max` that the GPU runs as a single instruction. Where that happens it is
 * called out, along with what the out-of-range input would otherwise have done,
 * because a clamp that reads as a defensive check invites somebody to delete it.
 */

/**
 * The signed distance to an axis-aligned rounded rectangle of the given FULL
 * `size`, centred on the origin.
 *
 * The Inigo Quilez formulation, written scalar because {@link SdfOps} has no
 * vector type: `length(max(q, 0)) + min(max(q.x, q.y), 0) - r` becomes a square
 * root of a sum of two squares and one `min` of one `max`. The same WGSL comes
 * out either way. The shape it describes is the rectangle shrunk by `r` on every
 * side and then grown back by a disc of radius `r`, which is why subtracting `r`
 * at the end is a rounding rather than an inset: growing a set by `r` subtracts
 * `r` from its distance field everywhere.
 *
 * ## The radius clamp is a correctness fix, and it was measured
 *
 * `r` is forced into `[0, min(halfW, halfH)]` before it is used. This is not
 * tidiness and it is not a guard against silly input. Without it the formula
 * returns a number that IS NOT THE DISTANCE to its own zero set, and the error
 * is in the dangerous direction, too small:
 *
 *  - a 10 by 2 box with radius 3, at the point (6, 0), reports 1.4721 where the
 *    true distance to the boundary it draws is 1.7639, a 16.5 per cent
 *    underestimate;
 *  - a 2 by 2 box with radius 2, at (2, 0), reports 1.1623 against 1.2679.
 *
 * Both were measured against a reference that never reads the field's value, only
 * the sign changes along rays out of the point, and both are in
 * `test/sdf.test.ts`. Push the radius further and the shape does not merely
 * distort, it VANISHES: a 4 by 4 box with radius 10 is positive everywhere, so
 * there is no zero set left for the number to be a distance to.
 *
 * The mechanism, since it is not obvious: with `r` past half the short side the
 * inner rectangle has a negative half extent, so `q` is positive on that axis for
 * every point, and the formula degenerates into the distance to a circle centred
 * outside the shape. Folding into the first quadrant then reflects that circle
 * across the axes and leaves a genuine corner in the boundary, which the circle
 * formula keeps measuring straight past.
 *
 * The trap worth naming: this failure survives an eikonal test. The unclamped
 * field still has `|grad d| = 1` to 7.5e-11, because folding preserves gradient
 * magnitude, so a suite that checked only the gradient would have shipped it.
 * That is why the suite also compares against the distance to the zero set.
 *
 * The clamp is arithmetic rather than a `RangeError` for the reason given at the
 * top of this file: there is no throwing from a fragment. What the caller gets
 * instead is the nearest shape that exists, a stadium or a circle, which is also
 * what every CSS engine does with an over-large `border-radius`.
 *
 * ## A negative radius is clamped to zero, and that is also a correctness fix
 *
 * Checked, not assumed. A negative `r` makes the inner rectangle LARGER than the
 * outer one and then adds `|r|` back at the end, which is exact along the flat
 * edges and wrong at the corners: a 4 by 4 box with radius -1, at (4, 4),
 * reports 2.4142 where the distance to its own boundary is 2.8284. So it is not
 * a usable "sharper than sharp" corner, it is a corner the field lies about.
 * Zero is the nearest radius that describes a real shape, and at zero the
 * formula is exactly the box distance.
 *
 * ## Negative extents
 *
 * Not part of the task, decided here: each half extent is floored at zero, so a
 * negative width degenerates the box to a segment or a point rather than to an
 * inside-out rectangle whose field reports the origin as OUTSIDE a box the
 * caller believes they are standing in the middle of. Two `max` instructions,
 * and it also makes `min(halfW, halfH)` a legitimate upper bound for the radius
 * clamp instead of a possibly negative one.
 */
export function roundedRectDistance<T>(
  ops: SdfOps<T>,
  point: Pair<T>,
  size: Pair<T>,
  radius: T,
): T {
  const zero = ops.literal(0);
  const half = ops.literal(0.5);

  const halfWidth = ops.mul(ops.max(size.x, zero), half);
  const halfHeight = ops.mul(ops.max(size.y, zero), half);
  const cornerRadius = ops.max(ops.min(radius, ops.min(halfWidth, halfHeight)), zero);

  // The corner-relative offset: how far past the inner rectangle's corner the
  // point is, on each axis. Positive on both means the point is diagonally out
  // past a corner, where the answer is a genuine length; negative on both means
  // it is inside, where the answer is the largest (least negative) of the two.
  const qx = ops.add(ops.sub(ops.abs(point.x), halfWidth), cornerRadius);
  const qy = ops.add(ops.sub(ops.abs(point.y), halfHeight), cornerRadius);

  // Bound to locals rather than repeated inline: on the TSL backend every
  // expression is a NODE, so writing `max(qx, 0)` twice builds the clamp twice
  // and emits it twice into the shader.
  const outX = ops.max(qx, zero);
  const outY = ops.max(qy, zero);
  const outside = ops.sqrt(ops.add(ops.mul(outX, outX), ops.mul(outY, outY)));
  const inside = ops.min(ops.max(qx, qy), zero);

  // At most one of the two terms is non-zero at any point (both vanish only on
  // the inner rectangle's own boundary), which is what makes this a branchless
  // spelling of a two-case definition rather than a blend of two
  // approximations.
  return ops.sub(ops.add(outside, inside), cornerRadius);
}

/**
 * The signed distance to a circle of the given radius, centred on the origin.
 *
 * `sqrt(x^2 + y^2) - r`, and there is nothing to get wrong in it, which is
 * exactly why it is here: it is the independent second opinion the rounded
 * rectangle is checked against. A square whose radius is its half side IS the
 * disc inscribed in it, so the two functions have to agree everywhere, and they
 * share no algebra by which they could agree for the wrong reason. That
 * cross-check is the strongest single test in `test/sdf.test.ts`.
 *
 * They agree to a couple of ulps rather than bit for bit, and the reason is
 * worth knowing before somebody tries to tighten the test: the rectangle
 * computes `(|x| - halfW) + r` where the circle computes `|x|`, and with
 * `halfW = r` that subtraction cancels digits the addition cannot restore.
 * Measured over random cases: identical in about 97 per cent of them, and never
 * further apart than 4.4e-16 of the radius.
 *
 * A negative radius is clamped to zero, for consistency with
 * {@link roundedRectDistance} and for a reason of its own. Left alone it would
 * make `hypot(p) - r` positive at every point, a field whose zero set is empty
 * and which is therefore not the distance to anything: no boundary, so no signed
 * distance, so nothing downstream can antialias it correctly even in principle.
 * At zero it is the exact distance field of a point, which is the nearest shape
 * that exists. The alternative, leaving it alone so the shape simply never
 * draws, was considered and rejected: it makes the two shape functions disagree
 * about what a negative radius means, and a silent empty draw is harder to
 * recognise than a dot.
 */
export function circleDistance<T>(ops: SdfOps<T>, point: Pair<T>, radius: T): T {
  const lengthSquared = ops.add(ops.mul(point.x, point.x), ops.mul(point.y, point.y));
  return ops.sub(ops.sqrt(lengthSquared), ops.max(radius, ops.literal(0)));
}
