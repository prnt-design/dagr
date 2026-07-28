import { float, vec2, vec3 } from 'three/tsl';
import { JoinNode, MathNode, VarNode } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  circleDistance,
  fillCoverage,
  glowCoverage,
  numberArith,
  outlineCoverage,
  roundedRectDistance,
  smoothstepBetween,
} from '../src/sdf.js';
import {
  antialiasWidth,
  circleSDF,
  roundedRectSDF,
  shapeShading,
  tslArith,
} from '../src/sdf-nodes.js';

/**
 * That the shader's node graph is CONSTRUCTIBLE, and nothing whatsoever about
 * what it computes.
 *
 * Said plainly because the distinction is the whole reason `sdf.ts` is written
 * the way it is. A TSL graph builds in Node with no device: `float(1).add(2)`
 * returns a node with `isNode === true`. It does not evaluate. `getNodeType`
 * needs a `NodeBuilder` and code generation needs a real renderer backend, so
 * there is no way in this process to ask what a graph's value is, and every
 * assertion below is therefore of the form "this expression tree got built
 * without throwing". What each tree MEANS is covered by `test/sdf.test.ts`
 * running the same formulas through `numberArith`, and the remaining gap (that
 * the nine adapters here spell the nine primitives correctly, that WGSL agrees
 * with `Math` about them, and that a pixel arrives on screen at all) is closed by
 * the committed screenshot the orchestrator takes with a browser, and by nothing
 * in this file.
 *
 * One shape of test here is doing more work than it looks like. `Fn` DEFERS its
 * body: calling `roundedRectSDF(...)` builds a call node and does not run the
 * arithmetic inside, so an `Fn` whose body is nonsense still calls cleanly in
 * Node. So the bodies are also built directly, by calling the generic formulas
 * from `sdf.ts` with `tslArith`, which constructs every node eagerly. That is the
 * assertion that a mistyped adapter or a formula the node types reject cannot
 * survive.
 */

/** A node-typed float, for the arguments below. */
const one = float(1);
const two = float(2);

/**
 * Strips the `VarNode` every TSL function wraps its result in.
 *
 * TSL returns `VarNode(MathNode(...))` rather than the `MathNode` itself, so that
 * a subexpression used twice becomes one variable in the generated shader instead
 * of two copies of the expression. Every structural assertion below therefore has
 * to look through one layer, and doing it in one helper keeps that fact in one
 * place rather than in every test.
 */
function unwrap(node: Node): Node {
  return node instanceof VarNode ? node.node : node;
}

/** The `MathNode` method a node applies, or undefined if it is not one. */
function methodOf(node: Node): string | undefined {
  const inner = unwrap(node);
  return inner instanceof MathNode ? inner.method : undefined;
}

describe('tslArith', () => {
  it('implements exactly the primitives numberArith implements', () => {
    // The point of this test: an operation added to one backend and not the
    // other is a test failure here rather than a crash on a GPU nobody in CI
    // has. `Arith<T>` makes the two the same interface to the compiler, but a
    // missing member on an object literal is only an error if the literal is
    // annotated, and this catches the case where somebody widens the type.
    expect(Object.keys(tslArith).sort()).toEqual(Object.keys(numberArith).sort());
  });

  it('lifts a plain number into a node rather than passing it through', () => {
    // `literal` is the one adapter that changes the KIND of value. If it were the
    // identity, every constant in every formula would reach TSL as a JavaScript
    // number, which mostly works (TSL coerces) and fails exactly where a formula
    // starts with a literal, since `2 - node` is not a method call on anything.
    expect(typeof tslArith.literal(0.5)).not.toBe('number');
    expect(tslArith.literal(0.5).isNode).toBe(true);
  });

  it('builds a node for each of the nine primitives', () => {
    expect(tslArith.add(one, two).isNode).toBe(true);
    expect(tslArith.sub(one, two).isNode).toBe(true);
    expect(tslArith.mul(one, two).isNode).toBe(true);
    expect(tslArith.div(one, two).isNode).toBe(true);
    expect(tslArith.abs(one).isNode).toBe(true);
    expect(tslArith.min(one, two).isNode).toBe(true);
    expect(tslArith.max(one, two).isNode).toBe(true);
    expect(tslArith.sqrt(two).isNode).toBe(true);
  });
});

describe('the shared formulas over tslArith', () => {
  it('builds the rounded rect distance eagerly, body and all', () => {
    const d = roundedRectDistance(tslArith, one, two, float(50), float(20), float(4));
    expect(d.isNode).toBe(true);
  });

  it('builds the circle distance eagerly', () => {
    expect(circleDistance(tslArith, one, two, float(20)).isNode).toBe(true);
  });

  it('builds the ramp and all three coverages eagerly', () => {
    const aaWidth = float(0.01);
    expect(smoothstepBetween(tslArith, float(0), one, two).isNode).toBe(true);
    expect(fillCoverage(tslArith, one, aaWidth).isNode).toBe(true);
    expect(outlineCoverage(tslArith, one, two, aaWidth).isNode).toBe(true);
    expect(glowCoverage(tslArith, one, float(6), aaWidth).isNode).toBe(true);
  });
});

describe('antialiasWidth', () => {
  it('builds a node', () => {
    expect(antialiasWidth(vec2(1, 2)).isNode).toBe(true);
  });

  it('differentiates the POSITION, which has no fold, and not the distance', () => {
    // The defect this signature exists to prevent, found on a real device after
    // three other personas had passed the file. Every distance in `sdf.ts` folds:
    // `roundedRectDistance` runs both coordinates through `abs`, `circleDistance`
    // squares them. So on the 2x2 fragment quad containing a shape's centre, where
    // both symmetry axes cross, all four fragments see the SAME distance, the
    // finite difference is ~0 on both axes, and an `aaWidth` taken from the
    // distance gradient collapses to nearly nothing. `bandWorld` is
    // `outlinePixels * aaWidth`, so the inset outline vanishes exactly there.
    //
    // It is invisible on large shapes, whose centre is deep in the fill where the
    // outline is zero anyway, and severe on small ones: a 4 pixel circle measured
    // on a real device flipped between all fill and all outline on alternate pan
    // phases, because whether the centre lands on an even or odd quad boundary
    // depends on the shape's sub-pixel position. `test/sdf.test.ts` executes the
    // fold itself over `numberArith`; this asserts the graph that avoids it.
    //
    // The position is the right quantity because it is what the interpolator
    // hands the fragment before any of the arithmetic runs, so there is no `abs`
    // and no square anywhere in front of the derivative.
    const position = vec2(1, 2);
    const outer = unwrap(antialiasWidth(position));
    expect(outer).toBeInstanceOf(MathNode);
    if (!(outer instanceof MathNode)) throw new Error('unreachable');
    expect(outer.method).toBe('max');

    // A `max` with one operand is not a `max`, so the second is asserted present
    // rather than assumed: three types `bNode` as nullable and a unary MathNode
    // would otherwise reach the loop below as a single branch and pass it.
    expect(outer.bNode).not.toBeNull();
    if (outer.bNode === null) throw new Error('unreachable');
    const branches = [unwrap(outer.aNode), unwrap(outer.bNode)];
    const operands: unknown[] = [];
    for (const branch of branches) {
      expect(branch).toBeInstanceOf(MathNode);
      if (!(branch instanceof MathNode)) throw new Error('unreachable');
      expect(branch.method).toBe('length');

      const join = unwrap(branch.aNode);
      expect(join).toBeInstanceOf(JoinNode);
      if (!(join instanceof JoinNode)) throw new Error('unreachable');
      expect(join.nodes).toHaveLength(2);
      expect(join.nodes.map((node) => methodOf(node))).toEqual(['dFdx', 'dFdy']);

      // Both derivatives in one branch must differentiate the SAME component, or
      // the branch is measuring a diagonal rather than one axis of the pixel.
      const [dx, dy] = join.nodes.map((node) => {
        const derivative = unwrap(node);
        if (!(derivative instanceof MathNode)) throw new Error('unreachable');
        return derivative.aNode;
      });
      expect(dx).toBe(dy);
      operands.push(dx);
    }

    // And the two branches must differentiate DIFFERENT components, or this is one
    // axis measured twice and the other never, which is a `max` that cannot see a
    // pixel stretched along the axis it dropped.
    expect(operands[0]).not.toBe(operands[1]);
  });

  it('is the LENGTH of the gradient and not fwidth, checked structurally', () => {
    // The one place this file inspects a graph's shape instead of only its
    // existence, and it is worth the coupling. `fwidth(d)` builds just as happily
    // as `length(vec2(dFdx(d), dFdy(d)))` and differs from it by up to 41% on a
    // diagonal, which is every point of every rounded corner: the visible symptom
    // is corners blurrier than the sides they join, at every zoom, which is a
    // thing a reviewer would look straight past on a screenshot. So the decision
    // gets a test rather than only a paragraph.
    //
    // What is asserted: the outermost operation is a `length`, and its argument
    // joins exactly two components which are `dFdx` and `dFdy` of something. What
    // is NOT asserted: that the something is the distance, or that WGSL's
    // `length` does what its name says.
    //
    // Brittle by design. It reads `method`, `aNode` and `nodes`, which are three's
    // node fields rather than a public API surface, so a three release that
    // renames them fails this test loudly. That is the correct outcome: this file
    // depends on those graphs and would rather find out here than in a screenshot.
    const outer = unwrap(antialiasWidth(vec2(1, 2)));
    if (!(outer instanceof MathNode)) throw new Error('unreachable');
    const branch = unwrap(outer.aNode);
    expect(branch).toBeInstanceOf(MathNode);
    if (!(branch instanceof MathNode)) throw new Error('unreachable');
    expect(branch.method).toBe('length');

    const join = unwrap(branch.aNode);
    expect(join).toBeInstanceOf(JoinNode);
    if (!(join instanceof JoinNode)) throw new Error('unreachable');
    expect(join.nodes).toHaveLength(2);
    expect(join.nodes.map((node) => methodOf(node))).toEqual(['dFdx', 'dFdy']);
  });

  it('has no factor in front of the quantity it differentiates', () => {
    // Where every remaining factor error lives: `dFdx(mul(p.x, 2))` builds the
    // same node kinds in the same places and doubles every antialiasing ramp in
    // the shader, because `aaWidth` would then be two world units per pixel rather
    // than one. Measured against the previous, distance-differentiating version of
    // this function: that mutation left all 67 tests in the two sdf suites green.
    //
    // A ramp at the wrong width is not a subtle artefact. Halved, it is a hard
    // edge with one intermediate sample, which is the aliasing this milestone
    // exists to remove, and it reads like a driver problem rather than a factor.
    //
    // Asserted as "the operand is a leaf that is not itself arithmetic": a swizzle
    // of the position, not a `mul` or an `add` wrapping one.
    const outer = unwrap(antialiasWidth(vec2(1, 2)));
    if (!(outer instanceof MathNode)) throw new Error('unreachable');
    if (outer.bNode === null) throw new Error('unreachable');
    for (const branchNode of [outer.aNode, outer.bNode]) {
      const branch = unwrap(branchNode);
      if (!(branch instanceof MathNode)) throw new Error('unreachable');
      const join = unwrap(branch.aNode);
      if (!(join instanceof JoinNode)) throw new Error('unreachable');
      for (const component of join.nodes) {
        const derivative = unwrap(component);
        expect(derivative).toBeInstanceOf(MathNode);
        if (!(derivative instanceof MathNode)) throw new Error('unreachable');
        expect(unwrap(derivative.aNode)).not.toBeInstanceOf(MathNode);
      }
    }
  });
});

describe('the composable SDF nodes', () => {
  it('build a call node for a rounded rect', () => {
    expect(roundedRectSDF(vec2(1, 2), vec2(100, 40), float(4)).isNode).toBe(true);
  });

  it('build a call node for a circle', () => {
    expect(circleSDF(vec2(1, 2), float(20)).isNode).toBe(true);
  });

  it('have no opinion about material assembly', () => {
    // A property of the module rather than of a value: these two export a
    // distance and nothing else, so `shapeShading` below can be pointed at either
    // one, or at a distance field M4.5 has not written yet, without either of
    // them knowing what a material is.
    expect(typeof roundedRectSDF).toBe('function');
    expect(typeof circleSDF).toBe('function');
  });
});

describe('shapeShading', () => {
  /** Every input the shading node needs, with three distinguishable colours. */
  const input = {
    distance: float(-3),
    position: vec2(1, 2),
    fillColor: vec3(1, 0.72, 0.01),
    outlineColor: vec3(0.01, 0.19, 0.28),
    glowColor: vec3(0.98, 0.52, 0),
    glowAlpha: float(0.45),
    outlinePixels: two,
    glowWorld: float(6),
  };

  it('builds a colour and an alpha from a distance', () => {
    const shading = shapeShading(input);
    expect(shading.color.isNode).toBe(true);
    expect(shading.alpha.isNode).toBe(true);
  });

  it('composites the alpha with a max and the colour with a mix', () => {
    // The two compositing decisions, as far as a Node test can see them, and the
    // division of labour is the point. The ALPHA is `shapeAlpha` in `sdf.ts` over
    // the nine primitives, so `test/sdf.test.ts` executes it and asserts the 0.5
    // at the boundary that the `over` chain would inflate to 0.725; all this
    // assertion adds is that the graph handed to the material is that function's
    // and not an `over` chain rebuilt here.
    //
    // The COLOUR cannot be executed anywhere in Node, because `mix` on a `vec3` is
    // not one of the nine and adding it would put a tenth unexecutable line in
    // `tslArith` for a single call site. So this is the whole of the evidence for
    // the colour: the outermost operation is a `mix`, which rules out an `add` or
    // a `mul` blend but says nothing about the order of the three layers. The
    // screenshot is the rest of it.
    const shading = shapeShading(input);
    expect(methodOf(shading.alpha)).toBe('max');
    expect(methodOf(shading.color)).toBe('mix');
  });

  it('takes a distance rather than a shape, so any field can go through it', () => {
    // The seam that matters for M4.5: the compositing is written once and knows
    // nothing about rectangles or circles. Both of these build the whole graph
    // eagerly, so a compositing expression the node types reject fails here.
    const throughRect = shapeShading({
      ...input,
      distance: roundedRectDistance(tslArith, one, two, float(50), float(20), float(4)),
    });
    const throughCircle = shapeShading({
      ...input,
      distance: circleDistance(tslArith, one, two, float(20)),
    });
    expect(throughRect.alpha.isNode).toBe(true);
    expect(throughCircle.alpha.isNode).toBe(true);
  });
});
