import { MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Camera2D } from '../src/camera.js';
import { quadPadding, shapeQuadSize } from '../src/sdf.js';
import {
  CRISPNESS_LADDER,
  createShapeMeshes,
  shapeQuadBounds,
  shapeSize,
} from '../src/shape-scene.js';
import type { ShapeDescriptor } from '../src/shape-scene.js';

/**
 * The demo scene, checked as arithmetic and as bookkeeping.
 *
 * Two halves, and the split is M4.1's testing rule applied unchanged. The
 * LAYOUT of the ladder is arithmetic on plain numbers (where each shape sits, how
 * big its quad is, whether two quads overlap, whether the whole thing fits in a
 * given camera's view), and all of it is checkable here. The MESHES are three.js
 * objects built with no device, so what can be checked is that the right number
 * of the right things were constructed, with the geometry sized from the padded
 * quad and not from the shape, and that every one of them turns up in the list
 * the renderer disposes.
 *
 * What is on the far side of the line: whether any of it appears, in the right
 * colour, at the right crispness. The shader is the whole point of M4.2 and none
 * of it runs here, which is why the coverage arithmetic is tested separately over
 * numbers (`test/sdf.test.ts`) and why the orchestrator's screenshot is the rest
 * of the evidence.
 */

/** The demo's measured canvas: 1102 by 598 CSS pixels at full page width. */
const demoViewport = { width: 1102, height: 598, devicePixelRatio: 2 } as const;

/** Does one axis-aligned box overlap another? Extents, so it is four comparisons. */
function overlaps(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

describe('the crispness ladder', () => {
  it('is six shapes: a rounded rect and a circle at each of three scales', () => {
    expect(CRISPNESS_LADDER).toHaveLength(6);
    expect(CRISPNESS_LADDER.filter((shape) => shape.kind === 'roundedRect')).toHaveLength(3);
    expect(CRISPNESS_LADDER.filter((shape) => shape.kind === 'circle')).toHaveLength(3);
  });

  it('spans exactly 100:1 in shape size, so one frame shows both zoom extremes', () => {
    // The reason the scene is a ladder rather than one shape. A texture atlas
    // baked at one scale is crisp at one zoom; the claim M4.2 makes is that an
    // SDF is crisp at every zoom, and a scene that only contains 100 unit shapes
    // cannot show the difference however many screenshots are taken of it.
    const widths = CRISPNESS_LADDER.map((shape) => shapeSize(shape).width);
    expect(widths).toEqual([10, 4, 100, 40, 1000, 400]);

    // 100:1 between the RUNGS, which is the claim: three decades of rounded rect,
    // three of circle, each family a factor of ten apart.
    const rectWidths = CRISPNESS_LADDER.filter((shape) => shape.kind === 'roundedRect').map(
      (shape) => shapeSize(shape).width,
    );
    expect(rectWidths).toEqual([10, 100, 1000]);
    expect(Math.max(...rectWidths) / Math.min(...rectWidths)).toBe(100);

    // The extremes across both families are wider still, at 250:1, because the
    // smallest circle is 4 units and the largest rect is 1000. Recorded rather
    // than claimed as the design target, so the two numbers do not get confused.
    expect(Math.max(...widths) / Math.min(...widths)).toBe(250);
  });

  it('puts the smallest rounded rect on the origin, 10 world units across', () => {
    // Two constraints at once, both measured rather than chosen. The default
    // camera looks at the origin, so the smallest rung has to be there for zoom
    // 100 to be a close-up of anything. And 10 world units at zoom 100 is 1000
    // CSS pixels against the demo's measured 1102 pixel canvas, which fills the
    // view with 9% left over for the side edges to stay on screen: the demo's own
    // suite pins the 6 to 11 unit band this has to sit in, so a change here fails
    // there rather than drifting.
    const smallest = CRISPNESS_LADDER[0];
    expect(smallest?.kind).toBe('roundedRect');
    expect(smallest?.center).toEqual({ x: 0, y: 0 });
    expect(shapeSize(smallest as ShapeDescriptor)).toEqual({ width: 10, height: 4 });
  });

  it('frames the smallest rect at zoom 100 on the demo canvas, edges included', () => {
    const camera = new Camera2D({ viewport: demoViewport, zoom: 100 });
    const view = camera.visibleWorldBounds();
    const size = shapeSize(CRISPNESS_LADDER[0] as ShapeDescriptor);
    expect(size.width / 2).toBeLessThan(view.maxX);
    expect(size.height / 2).toBeLessThan(view.maxY);
    // And it fills the view rather than sitting in the middle of it: at least
    // 85% of the canvas width, or zoom 100 stops being a close-up of an edge.
    expect((size.width / 2) / view.maxX).toBeGreaterThan(0.85);
  });

  it('grows to the right in decades, so zooming out reframes the next rung', () => {
    // The property that makes one camera enough. The rect centres are 0, 100 and
    // 1000, the same decade steps as the sizes, so a factor of ten out from the
    // default centre brings the next rung into frame without a pan. It also
    // means the smallest shape stays at the centre of every frame, which is where
    // a reviewer looking for aliasing will look first.
    const rectCenters = CRISPNESS_LADDER.filter((shape) => shape.kind === 'roundedRect').map(
      (shape) => shape.center.x,
    );
    expect(rectCenters).toEqual([0, 100, 1000]);
    for (const shape of CRISPNESS_LADDER) {
      expect(shape.center.y).toBe(0);
    }
  });

  it('gives the two shape families different fill hues', () => {
    // Otherwise the ladder is six boxes of one colour and a reviewer cannot tell
    // which primitive drew which shape.
    const fills = new Set(CRISPNESS_LADDER.map((shape) => shape.style.fillColor));
    expect(fills.size).toBe(2);
    expect(CRISPNESS_LADDER[0]?.style.fillColor).toBe(0xffb703);
  });

  it('scales each shape glow with its shape, and keeps the outline in pixels', () => {
    // A glow is a property of the shape (world units) and an outline is a
    // property of the screen (CSS pixels). A halo that stayed 1 world unit wide
    // while its shape grew a hundredfold would be invisible on the largest rung,
    // and an outline that grew with the shape would be a border drawn by a
    // geometry pipeline, which is the thing an SDF exists not to need.
    for (const shape of CRISPNESS_LADDER) {
      expect(shape.style.outlinePixels).toBe(2);
      expect(shape.style.glowWorld).toBeCloseTo(shapeSize(shape).height / 4, 12);
    }
  });
});

describe('the ladder as geometry', () => {
  it('has no two quads overlapping anywhere, so the scene has zero overdraw', () => {
    // The strongest form of "nothing overlaps", and stronger than it needs to be
    // on purpose. A quad contains its shape AND the whole of its glow, so
    // disjoint quads mean disjoint glows a fortiori, and they also mean no
    // fragment in this scene is ever blended over another one. That matters
    // because the materials are transparent with `depthWrite: false`, where
    // overlapping coplanar quads would make the frame depend on draw order.
    const bounds = CRISPNESS_LADDER.map((shape) => shapeQuadBounds(shape));
    for (let i = 0; i < bounds.length; i += 1) {
      for (let j = i + 1; j < bounds.length; j += 1) {
        const a = bounds[i];
        const b = bounds[j];
        if (a === undefined || b === undefined) throw new Error('unreachable');
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it('fits inside the view at zoom 0.1, which is the demo minimum', () => {
    // Both canvases: the 1000 by 600 the brief assumed (world 10000 by 6000) and
    // the 1102 by 598 the demo measured (world 11020 by 5980). The smaller one is
    // the binding constraint on the vertical axis, so both are asserted rather
    // than the one that happens to be current.
    for (const viewport of [
      { width: 1000, height: 600, devicePixelRatio: 1 },
      demoViewport,
    ]) {
      const view = new Camera2D({ viewport, zoom: 0.1 }).visibleWorldBounds();
      for (const shape of CRISPNESS_LADDER) {
        const quad = shapeQuadBounds(shape);
        expect(quad.minX).toBeGreaterThan(view.minX);
        expect(quad.maxX).toBeLessThan(view.maxX);
        expect(quad.minY).toBeGreaterThan(view.minY);
        expect(quad.maxY).toBeLessThan(view.maxY);
      }
    }
  });

  it('pads every quad by the glow plus the fill ramp allowance', () => {
    for (const shape of CRISPNESS_LADDER) {
      const size = shapeSize(shape);
      const quad = shapeQuadBounds(shape);
      const padding = quadPadding(shape.style);
      expect(quad.maxX - quad.minX).toBeCloseTo(size.width + 2 * padding, 12);
      expect(quad.maxY - quad.minY).toBeCloseTo(size.height + 2 * padding, 12);
    }
  });

  it('names the descriptor when a quad cannot be sized, not just the field', () => {
    // `shapeQuadBounds` is advertised for overlap and fits-in-view tests, so it is
    // a place a caller's bad number surfaces without going through
    // `createShapeMeshes`, and M4.4 will call it on layout-derived descriptors. It
    // used to report `style.glowWorld`, which in a scene of six identical styles
    // says nothing about which shape to look at.
    const rect = CRISPNESS_LADDER[2];
    if (rect === undefined) throw new Error('unreachable');
    expect(rect.label).toBe('rect-100');
    const bad: ShapeDescriptor = { ...rect, style: { ...rect.style, glowWorld: -1 } };
    expect(() => shapeQuadBounds(bad)).toThrow(RangeError);
    expect(() => shapeQuadBounds(bad)).toThrow(/rect-100\.style\.glowWorld/);
  });

  it('describes a circle by its radius, so its size cannot contradict itself', () => {
    const circle = CRISPNESS_LADDER.find((shape) => shape.kind === 'circle');
    expect(circle).toBeDefined();
    expect(shapeSize(circle as ShapeDescriptor)).toEqual({ width: 4, height: 4 });
  });
});

describe('createShapeMeshes', () => {
  it('builds one mesh per descriptor, positioned on the z = 0 plane', () => {
    const { meshes } = createShapeMeshes();
    expect(meshes).toHaveLength(CRISPNESS_LADDER.length);
    meshes.forEach((mesh, index) => {
      const shape = CRISPNESS_LADDER[index];
      expect(mesh.position.x).toBe(shape?.center.x);
      expect(mesh.position.y).toBe(shape?.center.y);
      expect(mesh.position.z).toBe(0);
    });
  });

  it('sizes the plane from the PADDED quad and not from the shape', () => {
    // The bug this test exists for. A plane the size of the shape clips the glow
    // entirely, since a halo lives outside the boundary by definition, and clips
    // the outer half of the fill's own antialiasing ramp along a rectangle that
    // has nothing to do with the shape. Both look like a rendering artefact and
    // neither throws.
    const { meshes } = createShapeMeshes();
    meshes.forEach((mesh, index) => {
      const shape = CRISPNESS_LADDER[index];
      if (shape === undefined) throw new Error('unreachable');
      const quad = shapeQuadSize(shapeSize(shape), shape.style);
      const geometry = mesh.geometry;
      // `instanceof` rather than a cast, so the narrowing is checked at runtime
      // and the assertion below is about a real `PlaneGeometry`. A cast here would
      // also pass against a `BufferGeometry` with no `parameters` at all.
      expect(geometry).toBeInstanceOf(PlaneGeometry);
      if (!(geometry instanceof PlaneGeometry)) throw new Error('unreachable');
      expect(geometry.parameters.width).toBeCloseTo(quad.width, 12);
      expect(geometry.parameters.height).toBeCloseTo(quad.height, 12);
      expect(geometry.parameters.width).not.toBe(shapeSize(shape).width);
    });
  });

  it('hands back every geometry and every material to be disposed, once each', () => {
    // Two per shape, and no duplicates: the renderer disposes exactly this list,
    // so a resource missing from it is a leak per mount and a resource in it twice
    // is a double free.
    const { meshes, resources } = createShapeMeshes();
    expect(resources).toHaveLength(meshes.length * 2);
    expect(new Set(resources).size).toBe(resources.length);
    for (const mesh of meshes) {
      expect(resources).toContain(mesh.geometry);
      expect(resources).toContain(mesh.material);
    }
  });

  it('makes every material a transparent SDF material that does not write depth', () => {
    const { meshes } = createShapeMeshes();
    for (const mesh of meshes) {
      const material = mesh.material;
      expect(material).toBeInstanceOf(MeshBasicNodeMaterial);
      if (!(material instanceof MeshBasicNodeMaterial)) throw new Error('unreachable');
      expect(material.transparent).toBe(true);
      // three leaves `depthWrite` on when `transparent` is set, and left on, a
      // fragment with alpha 0 still writes depth and occludes whatever is drawn
      // behind it afterwards. Invisible in this scene (the quads are disjoint) and
      // exactly wrong for M4.5's layering, which is why it is turned off now
      // rather than found later.
      expect(material.depthWrite).toBe(false);
      expect(material.colorNode?.isNode).toBe(true);
      expect(material.opacityNode?.isNode).toBe(true);
    }
  });

  it('builds the shader graph for both shape kinds', () => {
    // Constructibility only. Nothing here evaluates a node: see the docstring in
    // `test/sdf-nodes.test.ts` for what that does and does not prove.
    const rect = CRISPNESS_LADDER.find((shape) => shape.kind === 'roundedRect');
    const circle = CRISPNESS_LADDER.find((shape) => shape.kind === 'circle');
    if (rect === undefined || circle === undefined) throw new Error('unreachable');
    const { meshes } = createShapeMeshes([rect, circle]);
    expect(meshes).toHaveLength(2);
  });

  it('rejects a corner radius past half the smaller dimension, naming the shape', () => {
    // Validated here, at the boundary where a descriptor becomes geometry, and
    // not inside the distance function the GPU calls per fragment. See the module
    // docstring in `sdf.ts`.
    const rect = CRISPNESS_LADDER[0];
    if (rect === undefined) throw new Error('unreachable');
    const bad: ShapeDescriptor = {
      kind: 'roundedRect',
      label: 'too-round',
      center: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      cornerRadius: 30,
      style: rect.style,
    };
    expect(() => createShapeMeshes([bad])).toThrow(RangeError);
    expect(() => createShapeMeshes([bad])).toThrow(/too-round/);
    expect(() => createShapeMeshes([bad])).toThrow(/cornerRadius/);
  });

  it('rejects a style that cannot describe a shape, naming the shape', () => {
    const rect = CRISPNESS_LADDER[0];
    if (rect === undefined) throw new Error('unreachable');
    const bad: ShapeDescriptor = {
      ...rect,
      label: 'bad-glow',
      style: { ...rect.style, glowWorld: -5 },
    };
    expect(() => createShapeMeshes([bad])).toThrow(RangeError);
    expect(() => createShapeMeshes([bad])).toThrow(/bad-glow/);
    expect(() => createShapeMeshes([bad])).toThrow(/glowWorld/);
  });

  it('rejects a circle by its RADIUS, quoting the number the caller wrote', () => {
    // This was the only rejection test in the file that asserted nothing but the
    // error class, and the reason was that there was no string worth asserting: a
    // circle's radius went through the rounded rect's size check, so `radius: -1`
    // came back as `circle-10.size.width has to be above zero, got -2`. That names
    // a field a circle descriptor does not have and reports the diameter rather
    // than the radius, which sends a reader to look for a `size` they never wrote.
    const circle = CRISPNESS_LADDER.find((shape) => shape.kind === 'circle');
    if (circle === undefined) throw new Error('unreachable');
    expect(circle.label).toBe('circle-10');
    for (const radius of [0, -1, Number.NaN]) {
      expect(() => createShapeMeshes([{ ...circle, radius }])).toThrow(RangeError);
      expect(() => createShapeMeshes([{ ...circle, radius }])).toThrow(/circle-10\.radius/);
      expect(() => createShapeMeshes([{ ...circle, radius }])).not.toThrow(/size/);
    }
    // The radius, not its double: `-1` is what the caller typed and `-2` is what
    // the old message reported.
    expect(() => createShapeMeshes([{ ...circle, radius: -1 }])).toThrow(/got -1$/);
  });
});
