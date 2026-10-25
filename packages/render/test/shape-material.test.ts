import { describe, expect, it } from 'vitest';
import { shapeQuadSize } from '../src/sdf.js';
import { normalizeShape } from '../src/shape.js';
import { createShapeMesh } from '../src/shape-material.js';
import type { ShapeInstance } from '../src/shape.js';

/**
 * What can be checked about a material without a GPU, which is less than the
 * material does and more than nothing.
 *
 * `sdf-nodes.ts` says why the node graph itself is not tested: Node has no
 * WebGPU, a node graph cannot be executed, and emitting WGSL headlessly does
 * not work on three 0.185.1. So nothing here proves the shading is right. What
 * it does prove is every decision made in plain JavaScript on the way to the
 * shading: the quad's size, where the mesh sits, the blending state that
 * decides whether the alpha the shader computes means anything, and the fact
 * that each call owns its own resources. Every one of those is a decision this
 * file makes rather than three, and every one of them is silent when wrong: a
 * material with `transparent` left false draws the glow's transparent tail as
 * an opaque rectangle, and there is no error anywhere.
 */

/** A rounded rect with every optional field left out. */
const plainRect: ShapeInstance = {
  kind: 'rounded-rect',
  center: { x: 0, y: 0 },
  size: { width: 100, height: 50 },
  style: { fillColor: 0x336699 },
};

/** Builds a mesh from an unnormalized instance, the way the renderer does. */
function meshFor(shape: ShapeInstance): ReturnType<typeof createShapeMesh> {
  return createShapeMesh(normalizeShape(shape));
}

describe('createShapeMesh geometry', () => {
  it('sizes the quad with shapeQuadSize, not with the shape size', () => {
    // The quad is deliberately bigger than the shape: the outline straddles the
    // boundary, the glow reaches past it, and the antialiasing ramp needs room
    // on top of both. Sizing this plane from `size` would clip all three.
    const shape: ShapeInstance = {
      ...plainRect,
      style: { fillColor: 0x336699, outlineWidth: 4, glowRadius: 6 },
    };
    const { geometry } = meshFor(shape);
    const quad = shapeQuadSize({ width: 100, height: 50 }, 4, 6);
    expect(geometry.parameters.width).toBe(quad.width);
    expect(geometry.parameters.height).toBe(quad.height);
    expect(geometry.parameters.width).toBeGreaterThan(100);
  });

  it('pads even a plain shape, because its own ramp needs the room', () => {
    const { geometry } = meshFor(plainRect);
    expect(geometry.parameters.width).toBe(shapeQuadSize(plainRect.size, 0, 0).width);
    expect(geometry.parameters.width).toBeGreaterThan(100);
  });

  it('is one quad, not a tessellated plane', () => {
    // The distance field is evaluated per fragment, so extra vertices buy
    // nothing and cost a bigger buffer on every shape in the scene.
    const { geometry } = meshFor(plainRect);
    expect(geometry.parameters.widthSegments).toBe(1);
    expect(geometry.parameters.heightSegments).toBe(1);
  });

  it('sizes a circle from its own square quad', () => {
    const circle: ShapeInstance = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      size: { width: 80, height: 80 },
      style: { fillColor: 0x336699, glowRadius: 5 },
    };
    const { geometry } = meshFor(circle);
    const quad = shapeQuadSize({ width: 80, height: 80 }, 0, 5);
    expect(geometry.parameters.width).toBe(quad.width);
    expect(geometry.parameters.height).toBe(quad.height);
  });
});

describe('createShapeMesh placement', () => {
  it('puts the mesh at the shape centre, on the z = 0 plane', () => {
    // The quad is centred on the shape, so `positionLocal.xy` is the
    // shape-local point the distance field wants, with no offset anywhere. z is
    // 0 because that is the plane `CAMERA_NEAR` and `CAMERA_FAR` bracket.
    const { object } = meshFor({ ...plainRect, center: { x: 12, y: -34 } });
    expect(object.position.x).toBe(12);
    expect(object.position.y).toBe(-34);
    expect(object.position.z).toBe(0);
  });

  it('hands back the same geometry and material the mesh holds', () => {
    // The renderer disposes what it is given, so a mesh holding a different
    // geometry than the one returned would leak the one on screen and dispose
    // one nothing was drawing.
    const { object, geometry, material } = meshFor(plainRect);
    expect(object.geometry).toBe(geometry);
    expect(object.material).toBe(material);
  });

  it('gives every shape its own geometry and material', () => {
    // Sharing either would make the renderer's per-shape disposal a double
    // free: `setShapes` disposes each entry it drops, and two entries pointing
    // at one geometry would dispose it twice while a third still drew it.
    const first = meshFor(plainRect);
    const second = meshFor(plainRect);
    expect(first.geometry).not.toBe(second.geometry);
    expect(first.material).not.toBe(second.material);
    expect(first.object).not.toBe(second.object);
  });
});

describe('createShapeMesh blending state', () => {
  it('is transparent, because the shading returns real alpha', () => {
    // Not a style preference. The shading node is transparent outside the
    // shape, fades to nothing across the glow, and carries `fillOpacity`
    // through the whole result. With `transparent` false three disables
    // blending and the alpha is discarded, so the quad reads as a solid
    // rectangle of fill colour: the exact failure that looks like a shader bug.
    const { material } = meshFor(plainRect);
    expect(material.transparent).toBe(true);
  });

  it('does not write depth, so one quad cannot punch a hole in the next', () => {
    // Quads overlap wherever glows do, and most of a quad is transparent. A
    // transparent fragment that wrote depth would reject whatever is drawn
    // behind it afterwards, so a shape would erase its neighbour's glow along
    // an invisible rectangle.
    const { material } = meshFor(plainRect);
    expect(material.depthWrite).toBe(false);
  });

  it('shades from a node rather than from a flat colour', () => {
    // As much as a GPU-free test can say about the shading: the node graph
    // exists and is what the material draws through. What it computes is
    // checked in `test/sdf.test.ts`, against the CPU twins the nodes
    // transcribe.
    for (const kind of ['rounded-rect', 'circle'] as const) {
      const { material } = meshFor({
        ...plainRect,
        kind,
        size: { width: 60, height: 60 },
      });
      expect(material.colorNode).not.toBeNull();
      expect(material.colorNode).toBeDefined();
    }
  });

  it('builds without a device, which is what makes the suite above possible', () => {
    // TSL builds a node graph rather than compiling a shader, so everything
    // here is plain object construction until a renderer walks it. If that ever
    // stops being true this test is where it shows, rather than in a browser.
    expect(() => {
      const { geometry, material } = meshFor(plainRect);
      geometry.dispose();
      material.dispose();
    }).not.toThrow();
  });
});
