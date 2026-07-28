import { context } from 'three/tsl';
import {
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  StandardNodeLibrary,
  WGSLNodeBuilder,
} from 'three/webgpu';
import type { Camera, Node, Renderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { numberOps } from '../src/sdf-ops.js';
import * as sdf from '../src/sdf.js';
import {
  circleFragment,
  circleSDF,
  linearRgb,
  roundedRectFragment,
  roundedRectSDF,
  shapeShading,
  tslOps,
} from '../src/sdf-tsl.js';
import type { FloatNode, Vec4Node } from '../src/sdf-tsl.js';
import { SHOWCASE_STYLE } from '../src/shapes.js';

/**
 * The TSL instantiation of the shape algebra, checked as far as Node can reach.
 *
 * ## What these tests DO establish
 *
 * - Every operation in `tslOps` builds a three.js node rather than throwing or
 *   returning a number, so the second implementation of `SdfOps` is complete at
 *   runtime as well as at compile time.
 * - The shape functions here call the SAME generic functions `test/sdf.test.ts`
 *   and `test/shading.test.ts` exercise over doubles. That is pinned with a spy
 *   rather than trusted: a rewrite that retyped the distance formula in TSL
 *   would leave the graphs looking fine and this suite red, which is the entire
 *   reason the maths is written once.
 * - The graphs COMPILE TO WGSL. three 0.185.1's `WGSLNodeBuilder` runs in plain
 *   Node behind a five-property stub renderer (see {@link compileFragmentWgsl}),
 *   so the shader source the GPU would be handed is a string this suite can
 *   read. That turns "a node graph was built" into "a shader was generated, and
 *   it contains the `fwidth`, the `sqrt` and the colour literals intended".
 *
 * ## What is therefore still UNVERIFIED, stated plainly rather than left to be
 * discovered
 *
 * - That the generated WGSL is VALID. A `WGSLNodeBuilder` emits source; only
 *   `createShaderModule` on a real adapter decides whether a driver accepts it,
 *   and nothing here has an adapter.
 * - That any pixel comes out the colour these literals describe. three's output
 *   pass encodes the frame from linear to sRGB on the way to the canvas, and no
 *   test here runs that pass. `linearRgb` agreeing with `new Color(hex)` is the
 *   strongest available statement without a device: it says this package feeds
 *   the pipeline the same working-space numbers M4.1's material uniform did, so
 *   the two ambers match or they are both wrong together.
 * - That the blend state is right, that the glow is not clipped by its own
 *   quad, and that an edge is crisp at 0.1x and at 100x. Those are screenshot
 *   claims and the orchestrating run owns the screenshots.
 * - Anything NUMERIC about agreement between the two backends. WGSL computes in
 *   32-bit float where `numberOps` computes in 64-bit doubles, and nothing here
 *   executes the generated source. The argument for agreement is structural
 *   (same function, same ops, same call order) and it is the spy tests that
 *   carry it, not a comparison of values.
 */

/**
 * The generic distance functions, spied through to the real implementations.
 *
 * `vi.mock` is hoisted, so this covers the whole file; every call passes
 * straight on to the original, which is what makes it a pin rather than a
 * stand-in. What it catches is a `sdf-tsl.ts` that stops CALLING these, which is
 * exactly what somebody retyping `length(max(q, 0)) + min(max(q.x, q.y), 0) - r`
 * in TSL would do.
 */
vi.mock('../src/sdf.js', async (importOriginal) => {
  // `typeof sdf` rather than an inline `import()` type: the flat config forbids
  // those, and the namespace import below is the same module's type anyway.
  const actual = await importOriginal<typeof sdf>();
  return {
    roundedRectDistance: vi.fn(actual.roundedRectDistance),
    circleDistance: vi.fn(actual.circleDistance),
  };
});

/**
 * The three members of three's `NodeBuilder` this harness drives.
 *
 * `@types/three` 0.185 declares five properties of `NodeBuilder` and none of the
 * build path: no `build`, no `fragmentShader`, no `camera`. That is a gap in the
 * hand-written types rather than a statement about the runtime, so the harness
 * names what it uses and casts once. If three renames one of them the cast keeps
 * compiling and the test throws, which is the right way round for a harness: a
 * loud failure rather than a shader that silently means something else.
 */
interface ShaderBuild {
  camera: Camera;
  build(): void;
  readonly fragmentShader: string;
}

/**
 * Compiles a fragment node to WGSL, with no GPU anywhere.
 *
 * **This was expected to be impossible and is not, which is worth the
 * paragraph.** three's `WGSLNodeBuilder` is exported from `three/webgpu`, and
 * its `build()` reads a renderer for exactly five things: a `contextNode`, a
 * node library to map the material's type, the current render target, a backend
 * object, and a tone mapping mode. Not one of them touches a device, so an
 * object literal is enough and the builder emits real shader source. A camera
 * has to be assigned separately (something on the output path asks it whether it
 * is an array camera), and that is the whole of the setup. Measured by removing
 * things until it broke, not guessed: a `Scene` is not needed, and neither is
 * assigning `material`, which the constructor takes off the mesh.
 *
 * The casts are the one weakening: the stub is not a `Renderer`, and only the
 * properties the build path reads are present. They are narrow, they are in one
 * place, and if three ever reads a sixth the build throws rather than quietly
 * returning a shader that means something else, which is the failure mode a test
 * harness is allowed to have.
 */
function compileFragmentWgsl(
  fragment: Vec4Node,
  options: { premultipliedAlpha?: boolean } = {},
): string {
  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = fragment;
  material.transparent = true;
  material.premultipliedAlpha = options.premultipliedAlpha ?? false;

  const mesh = new Mesh(new PlaneGeometry(1, 1), material);

  const stubRenderer = {
    contextNode: context(),
    library: new StandardNodeLibrary(),
    getRenderTarget: () => null,
    backend: {},
    toneMapping: 0,
  } as unknown as Renderer;

  const builder = new WGSLNodeBuilder(mesh, stubRenderer) as unknown as ShaderBuild;
  builder.camera = new OrthographicCamera();
  builder.build();
  return builder.fragmentShader;
}

/** A TSL node, as far as anything outside three can tell. */
function isNode(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { isNode?: boolean }).isNode === true
  );
}

/** A point in the shape's own local space, as two `float` nodes. */
function point(x: number, y: number): { x: FloatNode; y: FloatNode } {
  return { x: tslOps.literal(x), y: tslOps.literal(y) };
}

describe('tslOps', () => {
  it('implements every operation the algebra declares', () => {
    // The runtime half of `SdfOps<Node<'float'>>`; the annotation in
    // `sdf-tsl.ts` is what enforces the signatures. This catches a method that
    // typechecks and is undefined, which an object literal cannot produce but a
    // refactor through a spread can.
    expect(Object.keys(tslOps).sort()).toEqual([
      'abs',
      'add',
      'div',
      'literal',
      'max',
      'min',
      'mul',
      'sqrt',
      'sub',
    ]);
  });

  it('returns a node from every operation', () => {
    const a = tslOps.literal(3);
    const b = tslOps.literal(4);
    const results: Node[] = [
      tslOps.literal(1),
      tslOps.add(a, b),
      tslOps.sub(a, b),
      tslOps.mul(a, b),
      tslOps.div(a, b),
      tslOps.min(a, b),
      tslOps.max(a, b),
      tslOps.abs(a),
      tslOps.sqrt(a),
    ];
    for (const value of results) expect(isNode(value)).toBe(true);
    expect(results).toHaveLength(9);
  });

  it('lifts a literal to a shader constant rather than to a uniform', () => {
    // The M4.3 boundary, made checkable. A uniform here would be a per-instance
    // parameter in all but name, and the roadmap is explicit that M4.2 must not
    // take that decision. A constant folds into the shader source instead,
    // which is what every WGSL assertion below reads back.
    const wgsl = compileFragmentWgsl(
      circleFragment(7, { ...SHOWCASE_STYLE, glowWidth: 0, outlineWidth: 0 }),
    );
    expect(wgsl).toContain('7.0');
    expect(wgsl).not.toContain('var<uniform>');
  });
});

describe('roundedRectSDF and circleSDF', () => {
  it('build a node graph for a rounded rectangle without throwing', () => {
    expect(isNode(roundedRectSDF(point(0, 0), { width: 100, height: 40 }, 10))).toBe(true);
  });

  it('build a node graph for a circle without throwing', () => {
    expect(isNode(circleSDF(point(0, 0), 24))).toBe(true);
  });

  it('are the generic distance functions, not a second copy of the formula', () => {
    // The structural claim the whole design exists for. `sdf.ts` is tested
    // exhaustively over doubles, and that is only evidence about the shader if
    // the shader calls it.
    vi.mocked(sdf.roundedRectDistance).mockClear();
    vi.mocked(sdf.circleDistance).mockClear();

    roundedRectSDF(point(1, 2), { width: 100, height: 40 }, 10);
    circleSDF(point(1, 2), 24);

    expect(sdf.roundedRectDistance).toHaveBeenCalledTimes(1);
    expect(sdf.circleDistance).toHaveBeenCalledTimes(1);
  });

  it('hand the generic functions the TSL arithmetic and nothing else', () => {
    // A weaker version of this would only count calls, and would pass for an
    // implementation that called `roundedRectDistance(numberOps, ...)` and
    // lifted the answer, which is a compile-time constant rather than a
    // distance field.
    vi.mocked(sdf.roundedRectDistance).mockClear();
    roundedRectSDF(point(1, 2), { width: 100, height: 40 }, 10);
    const ops = vi.mocked(sdf.roundedRectDistance).mock.calls[0]?.[0];
    expect(ops).toBe(tslOps);
    expect(ops).not.toBe(numberOps);
  });

  it('lift the size and the radius, so the caller passes plain numbers', () => {
    // M4.3 owns per-instance attributes and uniforms. Everything M4.2 takes is
    // a number, and the lifting happens on this side of the boundary.
    vi.mocked(sdf.circleDistance).mockClear();
    circleSDF(point(0, 0), 24);
    expect(isNode(vi.mocked(sdf.circleDistance).mock.calls[0]?.[2])).toBe(true);
  });
});

describe('shapeShading', () => {
  it('builds a node without throwing', () => {
    expect(isNode(shapeShading(tslOps.literal(-1), tslOps.literal(0.5), SHOWCASE_STYLE))).toBe(
      true,
    );
  });

  it('produces a four-component node, which is what a fragment has to be', () => {
    // Read off the generated WGSL rather than off the node, because a node's
    // `nodeType` is resolved by the builder and is null until then. The output
    // struct is the honest place to look: it is what three writes to the colour
    // attachment.
    const wgsl = compileFragmentWgsl(
      shapeShading(tslOps.literal(-1), tslOps.literal(0.5), SHOWCASE_STYLE),
    );
    expect(wgsl).toContain('@location( 0 ) color: vec4<f32>');
    expect(wgsl).toContain('output.color = vec4<f32>(');
  });
});

describe('the fragment convenience', () => {
  it('calls fwidth, which is the one thing the generic maths cannot do', () => {
    // A screen-space derivative exists only in a fragment shader, and nothing
    // in Node can evaluate one. Keeping it here rather than in `shading.ts` is
    // what leaves `coverage` a function of two numbers and therefore testable.
    // This asserts the derivative actually reaches the shader: a filter width
    // hard-coded to a constant would look identical in every other test here
    // and would be blurry at every zoom but one.
    const wgsl = compileFragmentWgsl(
      roundedRectFragment({ width: 100, height: 40 }, 10, SHOWCASE_STYLE),
    );
    expect(wgsl).toContain('fwidth(');
  });

  it('reads the fragment position rather than taking a point', () => {
    expect(compileFragmentWgsl(circleFragment(24, SHOWCASE_STYLE))).toContain('positionLocal');
  });

  it('emits the square root both distance fields are written around', () => {
    expect(compileFragmentWgsl(circleFragment(24, SHOWCASE_STYLE))).toContain('sqrt(');
  });

  it('emits the quadrant fold a rounded rectangle needs and a circle does not', () => {
    // `abs` is the fold into the first quadrant, and only the rectangle has
    // one. A circle that grew an `abs` would mean the two shapes had been
    // merged into one formula somewhere, which is the drift this pair watches
    // for from the other side to the spy tests above.
    const rect = compileFragmentWgsl(
      roundedRectFragment({ width: 100, height: 40 }, 10, SHOWCASE_STYLE),
    );
    const circle = compileFragmentWgsl(circleFragment(24, SHOWCASE_STYLE));
    expect(rect).toContain('abs(');
    expect(circle).not.toContain('abs(');
  });
});

describe('colour space', () => {
  it('lifts a hex colour into the working space three renders in', () => {
    // The whole colour-space question in one assertion. three's working space
    // is Linear-sRGB and `new Color(hex)` decodes an sRGB hex into it, which is
    // what M4.1's `MeshBasicNodeMaterial({ color })` uniform held. Writing
    // 0xb7 / 255 straight into the fragment would skip that decode and the
    // output pass's sRGB encode would then land near 0xdc: a visibly lighter
    // amber that reads as a design change rather than as a bug.
    const expected = new Color(0xffb703);
    const amber = linearRgb(0xffb703);
    expect(amber.r).toBeCloseTo(expected.r, 12);
    expect(amber.g).toBeCloseTo(expected.g, 12);
    expect(amber.b).toBeCloseTo(expected.b, 12);
  });

  it('decodes rather than passing the byte through, which is the mistake it prevents', () => {
    // Pinned as an inequality too, since everything above would still pass if
    // `Color` ever stopped converting and both sides became the raw bytes.
    expect(linearRgb(0xffb703).g).not.toBeCloseTo(0xb7 / 255, 3);
    expect(linearRgb(0xffffff)).toEqual({ r: 1, g: 1, b: 1 });
    expect(linearRgb(0x000000)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('reaches the shader as the decoded value', () => {
    const wgsl = compileFragmentWgsl(circleFragment(24, SHOWCASE_STYLE));
    expect(wgsl).toContain(String(new Color(0xffb703).g));
    expect(wgsl).not.toContain(String(0xb7 / 255));
  });
});

describe('the material three would build around this fragment', () => {
  it('would premultiply a second time if the material flag were set', () => {
    // Measured against three 0.185.1's source, and this is the trap this suite
    // exists to keep shut. `NodeMaterial.setupOutput` calls
    // `premultiplyAlpha(outputNode)` whenever `material.premultipliedAlpha`
    // is true, on the `fragmentNode` branch as well as the lit one.
    // `shadeDistance` already returns premultiplied colour, so setting that
    // flag multiplies by the alpha twice and leaves a dark halo around every
    // antialiased edge, which reads as bad antialiasing rather than as a wrong
    // blend mode. `shapes.ts` sets the blend factors directly instead, which
    // gets the same equation with no second multiply.
    const fragment = circleFragment(24, SHOWCASE_STYLE);
    const plain = compileFragmentWgsl(fragment, { premultipliedAlpha: false });
    const doubled = compileFragmentWgsl(fragment, { premultipliedAlpha: true });

    // The shape of the evidence: with the flag on, three emits a helper and
    // wraps the output in it, and the helper is `rgb * a`. With the flag off
    // the shading composite goes straight into the output struct, already
    // premultiplied by `shadeDistance` exactly once.
    expect(doubled).toContain('color.xyz * vec3<f32>( color.w )');
    expect(plain).not.toContain('color.xyz * vec3<f32>( color.w )');
    expect(plain).toContain('output.color = vec4<f32>(');
    expect(doubled).not.toContain('output.color = vec4<f32>(');
  });
});

describe('the WGSL harness itself', () => {
  it('drives a real build, so the assertions above are not vacuous', () => {
    // A control. If the stub renderer ever stops driving a build, every `toContain`
    // in this file passes or fails for reasons that have nothing to do with the
    // shapes, so one test says the harness emits a fragment entry point at all.
    const wgsl = compileFragmentWgsl(circleFragment(1, SHOWCASE_STYLE));
    expect(wgsl).toContain('@fragment');
    expect(wgsl).toContain('fn main(');
  });
});
