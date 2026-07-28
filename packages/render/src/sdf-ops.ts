/**
 * The small arithmetic every signed distance field and every piece of shading
 * in this package is written over.
 *
 * **Why an interface rather than nine calls to `Math`.** The shapes are
 * authored in TSL, which means the real implementation is a graph of three.js
 * nodes compiled to WGSL, and nothing in Node can execute one: there is no
 * device, and M4.1 already settled that this package does not acquire one to
 * run a test. The usual answer is to write the maths twice, once in TSL for the
 * GPU and once in TypeScript for the suite, and then the suite tests the copy.
 * A copy that drifts still passes.
 *
 * So the maths is written ONCE, generically, over this interface, and the
 * interface is implemented twice: {@link numberOps} over plain numbers, which
 * is what `test/sdf.test.ts` and `test/shading.test.ts` exercise, and the TSL
 * ops in `sdf-tsl.ts`, which is what the shader compiles. Every line the GPU
 * runs is a line the suite ran, over a different arithmetic. There is no second
 * copy to drift.
 *
 * **What that costs, stated so nobody is surprised.** The operations here are
 * the intersection of what TSL offers and what a number can do, so this is a
 * scalar algebra: no vectors, no swizzles, no `select`, no control flow. A
 * distance field written this way spells `length(q)` as `sqrt(qx * qx + qy *
 * qy)`, which is the same WGSL either way. Anything that genuinely needs a
 * vector type or a derivative (`fwidth`, above all) stays OUT of the generic
 * maths and is supplied by the caller as a value: see `shading.ts`, which takes
 * a filter width rather than computing one.
 */

/**
 * The nine operations. Deliberately the smallest set that spells both shapes
 * and all three shading layers, because every operation added here has to be
 * implemented for both backends and has to mean exactly the same thing in each.
 *
 * `min` and `max` are the only ones with a wrinkle worth naming: WGSL's `min`
 * and `max` are unspecified for `NaN` inputs and `Math.min`/`Math.max`
 * propagate it, so neither backend promises anything for a `NaN`, and no caller
 * should hand one in. Every input this package takes from a user is validated
 * before it reaches here.
 */
export interface SdfOps<T> {
  /** A compile-time constant. On the GPU this is a literal in the shader. */
  literal(value: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  min(a: T, b: T): T;
  max(a: T, b: T): T;
  abs(a: T): T;
  sqrt(a: T): T;
}

/**
 * A point, an extent, or anything else with two components, in whatever
 * arithmetic `T` is.
 *
 * Not `Vec2` from `types.ts`, which is two `number`s and is part of the public
 * surface. This one is generic precisely so the same field can be a number in a
 * test and a TSL node in a shader, and it is internal for the reason the whole
 * of `types.ts` gives: a three.js type must not reach a caller.
 */
export interface Pair<T> {
  readonly x: T;
  readonly y: T;
}

/**
 * The plain-number implementation: the reference the suite runs.
 *
 * Every method is the IEEE 754 double version of the WGSL operation the TSL ops
 * emit, which is an equivalence on ordinary values and not a promise about
 * denormals, infinities or `NaN`. WGSL is free to compute in 32-bit float where
 * this computes in 64-bit, so a test asserting an exact bit pattern here would
 * be asserting something about doubles that the GPU never promised. The tests
 * assert tolerances, and the tolerances are stated where they are used.
 */
export const numberOps: SdfOps<number> = {
  literal: (value) => value,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  abs: (a) => Math.abs(a),
  sqrt: (a) => Math.sqrt(a),
};
