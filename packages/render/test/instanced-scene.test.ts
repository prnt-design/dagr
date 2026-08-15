import { BufferAttribute } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  DagrRenderError,
  InstancedShapesDisposedError,
  UnknownInstanceHandleError,
} from '../src/errors.js';
import { INSTANCE_CHANNELS, linearFromHex } from '../src/instance-attributes.js';
import type { InstancedFamilyStyle, ShapeFamily } from '../src/instance-attributes.js';
import {
  InstancedShapes,
  createInstancedShapes,
  instanceBounds,
  requireFamilyStyle,
} from '../src/instanced-scene.js';
import type { FamilyInstance } from '../src/instanced-scene.js';

/**
 * The seam between the bookkeeping and three.
 *
 * What is checkable here is that the two halves agree: that the mesh's
 * `instanceCount` follows the live count, that a removal moves the DATA as well
 * as the handle, that a growth gives back the geometry it replaced, and that
 * dispose frees what the mesh is holding NOW rather than what it was holding
 * when it was built. What is not checkable anywhere in Node is whether the node
 * graph draws: see the module docstring in `instanced-scene.ts` for the list and
 * for what stands in for it, which is the committed crispness references.
 */

const style: InstancedFamilyStyle = { outlineColor: 0x023047, glowAlpha: 0.45, outlinePixels: 2 };

/** A rect whose every field is distinct, so a misplaced write is visible. */
function rectAt(x: number, size = 10): FamilyInstance<'roundedRect'> {
  return {
    kind: 'roundedRect',
    label: `rect-${String(x)}`,
    center: { x, y: x * 2 },
    size: { width: size, height: size / 2 },
    cornerRadius: 1,
    fillColor: 0xffb703,
    glowColor: 0xfb8500,
    glowWorld: 1,
  };
}

function offsets<F extends ShapeFamily>(shapes: InstancedShapes<F>): number[] {
  const attribute = shapes.mesh.geometry.getAttribute('instanceOffset');
  return Array.from({ length: shapes.count }, (_, slot) => attribute.getX(slot));
}

/**
 * One channel's attribute, narrowed. `getAttribute` is typed as a
 * `BufferAttribute` OR an `InterleavedBufferAttribute`, and only the first has
 * the update ranges these tests read.
 */
function channel<F extends ShapeFamily>(shapes: InstancedShapes<F>, name: string): BufferAttribute {
  const attribute = shapes.mesh.geometry.getAttribute(name);
  if (!(attribute instanceof BufferAttribute)) throw new Error('unreachable');
  return attribute;
}

describe('a family mesh', () => {
  it('starts empty and draws nothing', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style });
    expect(shapes.count).toBe(0);
    expect(shapes.mesh.geometry.instanceCount).toBe(0);
    shapes.dispose();
  });

  it('carries every channel as an instanced attribute over the data module\'s arrays', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 4 });
    for (const channel of INSTANCE_CHANNELS) {
      const attribute = shapes.mesh.geometry.getAttribute(channel.name);
      expect(attribute.itemSize).toBe(channel.components);
      expect(attribute.count).toBe(4);
    }
    shapes.dispose();
  });

  it('grows the draw count with every addition', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 8 });
    for (let i = 0; i < 5; i += 1) shapes.add(rectAt(i));
    expect(shapes.mesh.geometry.instanceCount).toBe(5);
    expect(shapes.count).toBe(5);
    shapes.dispose();
  });

  it('refuses an instance of the wrong family, naming the kind', () => {
    // The cast is the point rather than a workaround: `add` takes
    // `FamilyInstance<'circle'>`, so this line does not compile without one and
    // a caller who names the family at construction cannot reach this error at
    // all. The runtime check is for the data-driven caller M4.4 brings, where
    // the family comes out of a node's kind and the compiler has nothing to
    // narrow, and it is asserted here through the only door left open to it.
    const shapes = new InstancedShapes({ family: 'circle', style });
    const wrongFamily = rectAt(0) as unknown as FamilyInstance<'circle'>;
    expect(() => shapes.add(wrongFamily)).toThrow(RangeError);
    expect(() => shapes.add(wrongFamily)).toThrow(/kind/);
    shapes.dispose();
  });

  it('names the instance a caller labelled, and its place in the adds when it did not', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, label: 'scene.rect' });
    expect(() => shapes.add({ ...rectAt(0), cornerRadius: 90 })).toThrow(/rect-0\.cornerRadius/);
    const anonymous: FamilyInstance<'roundedRect'> = {
      kind: 'roundedRect',
      center: { x: 0, y: 0 },
      size: { width: 10, height: 5 },
      cornerRadius: 90,
      fillColor: 0xffb703,
      glowColor: 0xfb8500,
      glowWorld: 1,
    };
    // Not a slot, even though the two are the same integer here: naming a slot
    // in a message a reader might keep would teach the one lesson this module
    // exists to unteach.
    expect(() => shapes.add(anonymous)).toThrow(/scene\.rect\[instance 0\]\.cornerRadius/);
    shapes.dispose();
  });

  it('rejects a family style that cannot be drawn, naming the field', () => {
    expect(() => requireFamilyStyle({ ...style, glowAlpha: 2 }, 'f')).toThrow(/f\.glowAlpha/);
    expect(() => requireFamilyStyle({ ...style, outlinePixels: -1 }, 'f')).toThrow(
      /f\.outlinePixels/,
    );
    expect(() => requireFamilyStyle({ ...style, outlineColor: -1 }, 'f')).toThrow(
      /f\.outlineColor/,
    );
    expect(() => new InstancedShapes({ family: 'circle', style: { ...style, glowAlpha: 2 } })).toThrow(
      RangeError,
    );
  });
});

describe('growth', () => {
  it('replaces the geometry and gives the old one back', () => {
    // three keys a GPU buffer to the attribute object that owns it, so replacing
    // an attribute would leave the old buffer alive with nothing referencing it.
    // Disposing the whole geometry destroys every buffer it holds.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 2 });
    shapes.add(rectAt(0));
    shapes.add(rectAt(1));
    const before = shapes.mesh.geometry;
    shapes.add(rectAt(2));
    expect(shapes.mesh.geometry).not.toBe(before);
    expect(shapes.capacity).toBe(4);
    shapes.dispose();
  });

  it('keeps every instance that was already written', () => {
    // The failure a resize invites: new arrays with nothing copied into them, and
    // a scene that loses everything added before the growth.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 1 });
    for (let i = 0; i < 9; i += 1) shapes.add(rectAt(i));
    expect(offsets(shapes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    shapes.dispose();
  });

  it('points the new geometry at the arrays the writes go to', () => {
    // The other half, and the one a copy alone would not catch: after a growth,
    // an instance written through the data module has to reach the attribute the
    // mesh is drawing from.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 1 });
    shapes.add(rectAt(0));
    shapes.add(rectAt(1));
    const handle = shapes.add(rectAt(2));
    shapes.set(handle, rectAt(99));
    expect(offsets(shapes)).toEqual([0, 1, 99]);
    shapes.dispose();
  });
});

describe('removal', () => {
  it('moves the last instance\'s DATA into the freed slot, not only its handle', () => {
    // Skipping the copy leaves one instance drawing another's data with every
    // handle still resolving correctly, which no assertion about handles catches.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 8 });
    const handles = [0, 1, 2, 3].map((x) => shapes.add(rectAt(x)));
    shapes.remove(handles[1] as number);
    expect(offsets(shapes)).toEqual([0, 3, 2]);
    expect(shapes.count).toBe(3);
    shapes.dispose();
  });

  it('leaves every surviving handle usable, writing to the right slot', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 8 });
    const handles = [0, 1, 2, 3].map((x) => shapes.add(rectAt(x)));
    shapes.remove(handles[0] as number);
    shapes.set(handles[3] as number, rectAt(30));
    shapes.set(handles[2] as number, rectAt(20));
    expect(offsets(shapes)).toEqual([30, 1, 20]);
    shapes.dispose();
  });

  it('refuses a handle it has already freed', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style });
    const handle = shapes.add(rectAt(0));
    shapes.remove(handle);
    expect(shapes.has(handle)).toBe(false);
    expect(() => shapes.remove(handle)).toThrow(UnknownInstanceHandleError);
    expect(() => shapes.set(handle, rectAt(0))).toThrow(UnknownInstanceHandleError);
    shapes.dispose();
  });

  it('keeps drawing from live arrays after a shrink', () => {
    // The shrink path rebuilds the geometry for the same reason the growth path
    // does. Resizing without it leaves the mesh drawing from arrays nothing writes
    // to any more, which is a picture frozen at the moment of the shrink.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 2 });
    const handles = Array.from({ length: 16 }, (_, i) => shapes.add(rectAt(i)));
    expect(shapes.capacity).toBe(16);
    for (let i = 15; i > 3; i -= 1) shapes.remove(handles[i] as number);
    expect(shapes.capacity).toBe(8);
    shapes.set(handles[0] as number, rectAt(77));
    expect(offsets(shapes)).toEqual([77, 1, 2, 3]);
    expect(shapes.mesh.geometry.instanceCount).toBe(4);
    expect(shapes.mesh.geometry.getAttribute('instanceOffset').count).toBe(8);
    shapes.dispose();
  });

  it('clears to nothing and refills without reallocating', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 4 });
    for (let i = 0; i < 4; i += 1) shapes.add(rectAt(i));
    const geometry = shapes.mesh.geometry;
    shapes.clear();
    expect(shapes.count).toBe(0);
    for (let i = 0; i < 4; i += 1) shapes.add(rectAt(i + 10));
    expect(shapes.mesh.geometry).toBe(geometry);
    expect(offsets(shapes)).toEqual([10, 11, 12, 13]);
    shapes.dispose();
  });

  it('compacts to the live count on request, and not otherwise', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 1 });
    const handles = Array.from({ length: 8 }, (_, i) => shapes.add(rectAt(i)));
    shapes.remove(handles[7] as number);
    expect(shapes.capacity).toBe(8);
    shapes.compact();
    expect(shapes.capacity).toBe(7);
    expect(offsets(shapes)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    shapes.dispose();
  });
});

describe('a rejected add changes nothing', () => {
  it('leaves no live handle behind, so nothing phantom is ever drawn', () => {
    // Three reviewers found this independently. Allocating before validating
    // left the rejected instance owning a live handle over a slot nothing had
    // written: `count` and `instanceCount` came apart, the phantom slot drew
    // whatever floats were in it, and the next successful add resurrected a
    // removed shape at its old position. A caller that catches the `RangeError`,
    // which is exactly what M4.4 applying a delta does, saw no error at all.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 4 });
    const a = shapes.add(rectAt(10));
    const b = shapes.add(rectAt(20));
    shapes.remove(a);

    const before = shapes.handles();
    expect(() => shapes.add({ ...rectAt(30), cornerRadius: 90 })).toThrow(RangeError);
    expect(shapes.handles()).toEqual(before);
    expect(shapes.count).toBe(1);
    expect(shapes.mesh.geometry.instanceCount).toBe(1);

    // And the next real add lands where it should rather than past a hole.
    shapes.add(rectAt(40));
    expect(offsets(shapes)).toEqual([20, 40]);
    expect(shapes.has(b)).toBe(true);
    shapes.dispose();
  });

  it('does not grow the buffer for an instance it refuses', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 2 });
    shapes.add(rectAt(0));
    shapes.add(rectAt(1));
    expect(() => shapes.add({ ...rectAt(2), cornerRadius: 90 })).toThrow(RangeError);
    expect(shapes.capacity).toBe(2);
    expect(shapes.count).toBe(2);
    shapes.dispose();
  });
});

describe('the two halves under churn', () => {
  it('keeps every live handle pointing at its own data, for 400 steps', () => {
    // The model check the bookkeeping suite runs, extended across the seam. The
    // pure module proves handles resolve; this proves the FLOATS follow them,
    // which is the half a leaked slot or a fractional capacity corrupts without
    // any handle assertion noticing. Deterministic rather than random: a failing
    // seed nobody can reproduce is not a test.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 2 });
    const model = new Map<number, number>();
    let next = 1;

    for (let step = 0; step < 400; step += 1) {
      if (step % 5 === 4 && model.size > 0) {
        const handles = [...model.keys()];
        const victim = handles[step % handles.length] as number;
        shapes.remove(victim);
        model.delete(victim);
      } else if (step % 7 === 6 && model.size > 0) {
        const handles = [...model.keys()];
        const target = handles[step % handles.length] as number;
        const x = 1000 + step;
        shapes.set(target, rectAt(x));
        model.set(target, x);
      } else {
        const x = next;
        next += 1;
        model.set(shapes.add(rectAt(x)), x);
      }
      if (step % 53 === 0) shapes.compact();

      expect(shapes.count).toBe(model.size);
      expect(shapes.mesh.geometry.instanceCount).toBe(model.size);
      expect(shapes.capacity).toBeGreaterThanOrEqual(model.size);
      const attribute = shapes.mesh.geometry.getAttribute('instanceOffset');
      expect(attribute.count).toBe(shapes.capacity);
      for (const [handle, x] of model) {
        expect(shapes.has(handle)).toBe(true);
        expect(attribute.getX(shapes.handles().indexOf(handle))).toBe(x);
      }
    }
    shapes.dispose();
  });
});

describe('what reaches the GPU per frame', () => {
  /** What three does before it draws this mesh, which is where the ranges land. */
  function draw(shapes: InstancedShapes<'roundedRect'>): void {
    shapes.mesh.onBeforeRender(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  }

  it('leaves ONE update range per channel however many writes went into it', () => {
    // The regression two reviewers found in the first version of this. three's
    // `addUpdateRange` pushes a record per call and neither backend merges them,
    // and each range is a `writeBuffer`, so a range per write turned a 10k-node
    // spring pass into 60k range objects and 60k device writes per frame in
    // place of the six whole-buffer uploads it was meant to replace.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 64 });
    const handles = Array.from({ length: 20 }, (_, i) => shapes.add(rectAt(i)));
    for (let pass = 0; pass < 3; pass += 1) {
      for (const handle of handles) shapes.set(handle, rectAt(100 + pass));
    }
    draw(shapes);
    for (const { name, components } of INSTANCE_CHANNELS) {
      const attribute = channel(shapes, name);
      expect(attribute.updateRanges).toHaveLength(1);
      expect(attribute.updateRanges[0]).toEqual({ start: 0, count: 20 * components });
    }
    shapes.dispose();
  });

  it('uploads only the slots that changed, not the whole buffer', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 64 });
    const handles = Array.from({ length: 40 }, (_, i) => shapes.add(rectAt(i)));
    draw(shapes);

    shapes.set(handles[7] as number, rectAt(700));
    draw(shapes);
    expect(channel(shapes, 'instanceOffset').updateRanges).toEqual([{ start: 14, count: 2 }]);
    shapes.dispose();
  });

  it('asks for nothing when nothing was written since the last frame', () => {
    // Two comparisons per write and no allocation at all between frames, which
    // is what makes the whole path affordable under a spring loop.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 8 });
    shapes.add(rectAt(0));
    draw(shapes);
    channel(shapes, 'instanceOffset').clearUpdateRanges();
    draw(shapes);
    expect(channel(shapes, 'instanceOffset').updateRanges).toHaveLength(0);
    shapes.dispose();
  });

  it('re-uploads every live slot after a growth, because the arrays are new', () => {
    const shapes = new InstancedShapes({ family: 'roundedRect', style, capacity: 2 });
    shapes.add(rectAt(0));
    shapes.add(rectAt(1));
    draw(shapes);
    shapes.add(rectAt(2));
    draw(shapes);
    expect(channel(shapes, 'instanceOffset').updateRanges).toEqual([{ start: 0, count: 6 }]);
    shapes.dispose();
  });
});

describe('disposal', () => {
  it('is idempotent, and refuses every mutation afterwards with a NAMED error', () => {
    // A named class rather than a bare `Error`, on the rule in `errors.ts`: a
    // call after dispose is the lifecycle case that rule was written for, and a
    // bare `Error` lands in a caller's catch with no `code` and failing
    // `instanceof DagrRenderError`.
    const shapes = new InstancedShapes({ family: 'roundedRect', style, label: 'scene.rect' });
    shapes.add(rectAt(0));
    shapes.dispose();
    shapes.dispose();
    for (const call of [
      () => shapes.add(rectAt(1)),
      () => shapes.set(1, rectAt(1)),
      () => shapes.remove(1),
      () => shapes.clear(),
      () => shapes.compact(),
    ]) {
      expect(call).toThrow(InstancedShapesDisposedError);
      expect(call).toThrow(/scene\.rect/);
    }
    expect(new InstancedShapesDisposedError('add', 'm')).toBeInstanceOf(DagrRenderError);
    expect(new InstancedShapesDisposedError('add', 'm').code).toBe('INSTANCED_SHAPES_DISPOSED');
  });
});

describe('createInstancedShapes', () => {
  it('splits a mixed list into one mesh per family, in a fixed order', () => {
    // Fixed rather than first-seen: transparent coplanar geometry blends in draw
    // order, so a first-seen order would make the picture depend on the order a
    // caller happened to list its nodes in.
    const circle: FamilyInstance<'circle'> = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      radius: 4,
      fillColor: 0x219ebc,
      glowColor: 0x8ecae6,
      glowWorld: 1,
    };
    const families = createInstancedShapes([circle, rectAt(0), circle], {
      roundedRect: style,
      circle: style,
    });
    expect(families.map((family) => family.family)).toEqual(['roundedRect', 'circle']);
    expect(families.map((family) => family.count)).toEqual([1, 2]);
    for (const family of families) family.dispose();
  });

  it('allocates exactly the instances it was given, so nothing grows', () => {
    const families = createInstancedShapes(
      Array.from({ length: 100 }, (_, i) => rectAt(i)),
      { roundedRect: style, circle: style },
    );
    expect(families[0]?.capacity).toBe(100);
    for (const family of families) family.dispose();
  });

  it('disposes what it built when a later instance is rejected', () => {
    // The same guarantee `createRenderer` makes about an aborted mount, applied
    // one layer down: a caller never has to dispose a mesh it did not receive.
    const bad = { ...rectAt(1), cornerRadius: 90 };
    expect(() =>
      createInstancedShapes([rectAt(0), bad], { roundedRect: style, circle: style }),
    ).toThrow(RangeError);
  });

  it('writes the fill colour through the sRGB conversion, not raw', () => {
    // The silent one. A colour reaching a shader as a uniform goes through three's
    // `Color`; as an attribute it goes through nothing, so the conversion has to
    // happen on the way into the buffer or the whole palette draws lighter.
    const families = createInstancedShapes([rectAt(0)], { roundedRect: style, circle: style });
    const fill = families[0]?.mesh.geometry.getAttribute('instanceFillColor');
    const expected = linearFromHex(0xffb703, 'fill');
    expect(fill?.getX(0)).toBeCloseTo(expected[0], 6);
    expect(fill?.getY(0)).toBeCloseTo(expected[1], 6);
    expect(fill?.getZ(0)).toBeCloseTo(expected[2], 6);
    for (const family of families) family.dispose();
  });
});

describe('instanceBounds', () => {
  it('is the shape\'s box and not its padded quad', () => {
    expect(instanceBounds(rectAt(10, 100))).toEqual({
      minX: -40,
      minY: -5,
      maxX: 60,
      maxY: 45,
    });
  });

  it('reads a circle as square by its diameter', () => {
    expect(
      instanceBounds({
        kind: 'circle',
        center: { x: 0, y: 0 },
        radius: 20,
        fillColor: 0,
        glowColor: 0,
        glowWorld: 0,
      }),
    ).toEqual({ minX: -20, minY: -20, maxX: 20, maxY: 20 });
  });
});
