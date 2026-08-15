import { float, vec2 } from 'three/tsl';
import { ConstNode, OperatorNode, VarNode } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { dashDistance, numberDashArith, ribbonCoverage } from '../src/ribbon.js';
import { ribbonAlpha, ribbonArcPixels, ribbonWorldPosition, tslDashArith } from '../src/ribbon-nodes.js';

/**
 * That M4.5's shader graphs are CONSTRUCTIBLE, and nothing whatsoever about
 * what they compute.
 *
 * The same division of labour `test/sdf-nodes.test.ts` sets out, for the same
 * reason: a TSL graph builds in Node with no device and does not evaluate, so
 * every assertion here is of the form "this expression tree got built without
 * throwing". What each tree MEANS is `test/ribbon.test.ts`, which runs the
 * identical formulas through `numberDashArith`. The gap left over is that the
 * ten adapters spell the ten primitives correctly and that WGSL agrees with
 * `Math` about them, which the committed screenshot closes and nothing here
 * does.
 *
 * One graph gets a structural assertion rather than only an existence one, and
 * it is the one piece of arithmetic in `ribbon-nodes.ts` that no Node test can
 * execute: the `vec2` multiply-add in {@link ribbonWorldPosition}.
 */

/** A node-typed float, for the arguments below. */
const halfWidthPixels = float(1.5);
const pixelsPerWorldUnit = float(2);

/** Strips the `VarNode` TSL wraps a result in, so a structural check sees the operation. */
function unwrap(node: Node): Node {
  return node instanceof VarNode ? node.node : node;
}

/** The operator a node applies, or undefined if it is not one. */
function operatorOf(node: Node): string | undefined {
  const inner = unwrap(node);
  return inner instanceof OperatorNode ? inner.op : undefined;
}

/**
 * The two components a constant `vec2` leaf carries.
 *
 * Which INPUT reached an operand is asserted by value rather than by identity,
 * and the reason is a property of TSL rather than a preference: the nodes a
 * caller holds are proxies, and an operand read back out of a built graph is a
 * different object with the same value. So the arguments below are given
 * distinguishable coordinates and this reads them back.
 */
function constVec2(node: Node): [number, number] | undefined {
  const inner = unwrap(node);
  if (!(inner instanceof ConstNode)) return undefined;
  const value: unknown = inner.value;
  if (typeof value !== 'object' || value === null) return undefined;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' ? [x, y] : undefined;
}

describe('tslDashArith', () => {
  it('implements exactly the primitives numberDashArith implements', () => {
    // An operation added to one backend and not the other is a failure here
    // rather than a crash on a GPU nobody in CI has. It also pins the count at
    // ten: `fract` is the one primitive `sdf.ts`'s nine do not have, and a
    // second addition to this list should have to argue for itself.
    expect(Object.keys(tslDashArith).sort()).toEqual(Object.keys(numberDashArith).sort());
    expect(Object.keys(tslDashArith)).toHaveLength(10);
  });

  it('lifts a plain number into a node rather than passing it through', () => {
    expect(typeof tslDashArith.literal(0.5)).not.toBe('number');
    expect(tslDashArith.literal(0.5).isNode).toBe(true);
  });

  it('builds a node for fract, which is the tenth', () => {
    expect(tslDashArith.fract(float(1.25)).isNode).toBe(true);
  });
});

describe('the shared formulas over tslDashArith', () => {
  it('builds the dash distance eagerly, every node of it', () => {
    // A plain function rather than an `Fn`, so this constructs the whole tree
    // the moment it is called: a formula the node types reject fails here
    // rather than at shader compilation on somebody's machine.
    const distance = dashDistance(tslDashArith, {
      arcPixels: float(30),
      periodPixels: float(12),
      duty: float(0.5),
      flowPixels: float(4),
    });
    expect(distance.isNode).toBe(true);
  });

  it('builds the coverage for a solid ribbon and for a dashed one', () => {
    const solid = ribbonCoverage(tslDashArith, { across: float(0.5), halfWidthPixels });
    const dashed = ribbonCoverage(tslDashArith, {
      across: float(0.5),
      halfWidthPixels,
      dash: {
        arcPixels: float(30),
        periodPixels: float(12),
        duty: float(0.5),
        flowPixels: float(4),
      },
    });
    expect(solid.isNode).toBe(true);
    expect(dashed.isNode).toBe(true);
  });
});

describe('ribbonWorldPosition', () => {
  const position = vec2(10, 20);
  const offset = vec2(0, 1);

  it('builds a vec2 node', () => {
    expect(
      ribbonWorldPosition({ position, offset, halfWidthPixels, pixelsPerWorldUnit }).isNode,
    ).toBe(true);
  });

  it('adds a scaled offset to the position, rather than to anything else', () => {
    // The one expression in this file no Node test can execute, so it is
    // asserted structurally instead. What is checked: the outermost operation
    // is an addition, its first operand is the POSITION attribute itself with
    // no arithmetic in front of it, and its second is a multiplication. That
    // rules out the two mistakes that would still build and still draw
    // something: expanding from the offset instead of the position (a scene
    // collapsed onto the origin), and adding the width instead of scaling by it
    // (every ribbon the same width in world units, which is the decision this
    // package took the other way).
    const world = ribbonWorldPosition({ position, offset, halfWidthPixels, pixelsPerWorldUnit });
    const outer = unwrap(world);
    expect(outer).toBeInstanceOf(OperatorNode);
    if (!(outer instanceof OperatorNode)) throw new Error('unreachable');
    expect(outer.op).toBe('+');
    expect(constVec2(outer.aNode)).toEqual([10, 20]);
    expect(outer.bNode).not.toBeNull();
    if (outer.bNode === null) throw new Error('unreachable');
    expect(operatorOf(outer.bNode)).toBe('*');
  });

  it('scales the offset by the half width the CAMERA implies, not by a constant', () => {
    // The other half of the same claim: the multiplier is a division, so it
    // carries the pixels per world unit. A ribbon whose width did not divide by
    // that would be in world units, which is the decision `ribbon.ts` records
    // taking the other way, and it would look correct at exactly one zoom.
    const world = ribbonWorldPosition({ position, offset, halfWidthPixels, pixelsPerWorldUnit });
    const outer = unwrap(world);
    if (!(outer instanceof OperatorNode) || outer.bNode === null) {
      throw new Error('unreachable');
    }
    const scaled = unwrap(outer.bNode);
    if (!(scaled instanceof OperatorNode) || scaled.bNode === null) {
      throw new Error('unreachable');
    }
    expect(constVec2(scaled.aNode)).toEqual([0, 1]);
    expect(operatorOf(scaled.bNode)).toBe('/');
  });

  it('expands by the half width PLUS the antialiasing padding', () => {
    // The pairing the module docstring says the shared import guarantees, and
    // it does not: dropping the `add` leaves a graph that builds, typechecks
    // and passes every other test here, while `ribbonCoverage` goes on
    // subtracting the padding it was promised. The ramp would then run out at
    // the geometry's own edge, and every ribbon in the drawing would be hard
    // edged, which is the one defect this constant exists to prevent.
    const world = ribbonWorldPosition({ position, offset, halfWidthPixels, pixelsPerWorldUnit });
    const outer = unwrap(world);
    if (!(outer instanceof OperatorNode) || outer.bNode === null) throw new Error('unreachable');
    const scaled = unwrap(outer.bNode);
    if (!(scaled instanceof OperatorNode) || scaled.bNode === null) throw new Error('unreachable');
    const perWorldUnit = unwrap(scaled.bNode);
    if (!(perWorldUnit instanceof OperatorNode)) throw new Error('unreachable');
    expect(perWorldUnit.op).toBe('/');
    expect(operatorOf(perWorldUnit.aNode)).toBe('+');
  });
});

describe('ribbonArcPixels', () => {
  it('is one multiply, in the vertex stage', () => {
    // Where it happens is the point: one multiply per vertex with the
    // interpolator carrying the result, which an orthographic camera makes
    // exact, against the same number computed once per fragment.
    const arc = ribbonArcPixels(float(30), pixelsPerWorldUnit);
    expect(arc.isNode).toBe(true);
    expect(operatorOf(arc)).toBe('*');
  });
});

describe('ribbonAlpha', () => {
  it('builds an alpha for a solid ribbon and for a dashed one', () => {
    expect(ribbonAlpha({ across: float(0.4), halfWidthPixels }).isNode).toBe(true);
    expect(
      ribbonAlpha({
        across: float(0.4),
        halfWidthPixels,
        dash: {
          arcPixels: float(30),
          periodPixels: float(12),
          duty: float(0.5),
          flowPixels: float(4),
        },
      }).isNode,
    ).toBe(true);
  });

  it('hands back an alpha and no colour, which is the seam', () => {
    // `shapeShading` returns both because a shape composites three layers. A
    // ribbon has one flat colour per edge, which the caller already owns as an
    // attribute or a uniform, so there is nothing here to composite it with and
    // this file stays out of the material assembly M4.3's instancing owns.
    const shading: unknown = ribbonAlpha({ across: float(0.4), halfWidthPixels });
    expect(shading).not.toHaveProperty('color');
  });
});
