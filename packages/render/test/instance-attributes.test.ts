import { Color } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  INSTANCE_CHANNELS,
  INSTANCE_FLOATS,
  InstanceAttributeData,
  instanceSize,
  linearFromHex,
  requireShapeInstance,
} from '../src/instance-attributes.js';
import type { ShapeInstance } from '../src/instance-attributes.js';

/**
 * What one instance becomes, as floats.
 *
 * The other device-free half of M4.3. Two things here are worth more than the
 * rest: the colour conversion, which is silently wrong if it is skipped and
 * which is asserted against a real three `Color` rather than against a second
 * copy of the formula, and `moveSlot`, which is the data half of swap-with-last
 * and is what makes a removal a picture that is still right.
 */

const rect: ShapeInstance = {
  kind: 'roundedRect',
  label: 'rect',
  center: { x: 10, y: -4 },
  size: { width: 100, height: 40 },
  cornerRadius: 10,
  fillColor: 0xffb703,
  glowColor: 0xfb8500,
  glowWorld: 10,
};

const circle: ShapeInstance = {
  kind: 'circle',
  label: 'circle',
  center: { x: -3, y: 7 },
  radius: 20,
  fillColor: 0x219ebc,
  glowColor: 0x8ecae6,
  glowWorld: 10,
};

describe('the layout', () => {
  it('is six channels and twelve floats per instance', () => {
    expect(INSTANCE_CHANNELS.map((channel) => channel.name)).toEqual([
      'instanceOffset',
      'instanceSize',
      'instanceCornerRadius',
      'instanceGlowWorld',
      'instanceFillColor',
      'instanceGlowColor',
    ]);
    expect(INSTANCE_FLOATS).toBe(12);
  });

  it('avoids the one attribute name three claims for itself', () => {
    // `InstancedMesh` uses `instanceColor` for its own per-instance colour, and a
    // name collision on a geometry attribute is resolved by whoever wrote it last.
    expect(INSTANCE_CHANNELS.map((channel) => channel.name)).not.toContain('instanceColor');
  });

  it('allocates one array per channel, sized to the capacity', () => {
    const data = new InstanceAttributeData(4);
    for (const channel of INSTANCE_CHANNELS) {
      expect(data.channel(channel.name)).toHaveLength(4 * channel.components);
    }
    expect(data.capacity).toBe(4);
  });

  it('rejects a channel it does not have, rather than returning nothing', () => {
    expect(() => new InstanceAttributeData(4).channel('instanceColor')).toThrow(RangeError);
  });
});

describe('colour conversion', () => {
  it('agrees with three, component for component, across the whole range', () => {
    // Asserted against a real `Color` rather than against a second copy of the
    // formula, because the reason this function exists is that a uniform colour
    // goes through three and an attribute colour goes through nothing: the two
    // paths have to produce the same floats or the same palette draws in two
    // different sets of colours depending on which side of the split it is on.
    const hexes = [
      0x000000, 0x010101, 0x0a0a0a, 0x0b0d10, 0x219ebc, 0x8ecae6, 0x023047, 0xfb8500, 0xffb703,
      0xffffff,
    ];
    for (const hex of hexes) {
      const expected = new Color().setHex(hex);
      expect(linearFromHex(hex, 'colour')).toEqual([expected.r, expected.g, expected.b]);
    }
  });

  it('is not the identity, which is the mistake it exists to prevent', () => {
    // Skipping the conversion does not throw and does not look broken: every
    // colour comes out lighter and flatter, most visibly in the mid tones.
    const [r] = linearFromHex(0x808080, 'colour');
    expect(r).toBeLessThan(0.5);
    expect(r).toBeGreaterThan(0.2);
  });

  it('reads the channels in RGB order', () => {
    expect(linearFromHex(0xff0000, 'colour')).toEqual([1, 0, 0]);
    expect(linearFromHex(0x00ff00, 'colour')).toEqual([0, 1, 0]);
    expect(linearFromHex(0x0000ff, 'colour')).toEqual([0, 0, 1]);
  });

  it('rejects anything that is not a 24-bit integer, naming the field', () => {
    for (const bad of [-1, 0x1000000, 1.5, Number.NaN]) {
      expect(() => linearFromHex(bad, 'style.fillColor')).toThrow(RangeError);
      expect(() => linearFromHex(bad, 'style.fillColor')).toThrow(/style\.fillColor/);
    }
  });
});

describe('validation', () => {
  it('accepts each kind on its own family', () => {
    expect(requireShapeInstance(rect, 'roundedRect', 'rect')).toBe(rect);
    expect(requireShapeInstance(circle, 'circle', 'circle')).toBe(circle);
  });

  it('refuses a circle handed to a rounded rect mesh, and the reverse', () => {
    // One mesh draws one distance function. Accepting the wrong kind would draw a
    // circle with a rounded rect's field, which is a shape, so nothing would look
    // broken enough to investigate.
    expect(() => requireShapeInstance(circle, 'roundedRect', 'c')).toThrow(RangeError);
    expect(() => requireShapeInstance(circle, 'roundedRect', 'c')).toThrow(/c\.kind/);
    expect(() => requireShapeInstance(rect, 'circle', 'r')).toThrow(RangeError);
  });

  it('rejects a corner radius past half the smaller dimension, naming the field', () => {
    const bad = { ...rect, cornerRadius: 30 } as ShapeInstance;
    expect(() => requireShapeInstance(bad, 'roundedRect', 'node-3')).toThrow(RangeError);
    expect(() => requireShapeInstance(bad, 'roundedRect', 'node-3')).toThrow(
      /node-3\.cornerRadius/,
    );
    expect(() => requireShapeInstance(bad, 'roundedRect', 'node-3')).toThrow(/\(20\)/);
  });

  it('rejects a circle by its RADIUS, quoting the number the caller wrote', () => {
    for (const radius of [0, -1, Number.NaN]) {
      const bad = { ...circle, radius } as ShapeInstance;
      expect(() => requireShapeInstance(bad, 'circle', 'circle-10')).toThrow(/circle-10\.radius/);
      expect(() => requireShapeInstance(bad, 'circle', 'circle-10')).not.toThrow(/size/);
    }
  });

  it('rejects a non-finite centre, a negative glow and a bad colour', () => {
    const cases: [ShapeInstance, RegExp][] = [
      [{ ...rect, center: { x: Number.NaN, y: 0 } }, /center\.x/],
      [{ ...rect, center: { x: 0, y: Infinity } }, /center\.y/],
      [{ ...rect, glowWorld: -1 }, /glowWorld/],
      [{ ...rect, fillColor: -1 }, /fillColor/],
      [{ ...rect, glowColor: 1.5 }, /glowColor/],
      [{ ...rect, size: { width: 0, height: 10 } }, /size\.width/],
      [{ ...rect, size: { width: 10, height: -1 } }, /size\.height/],
    ];
    for (const [bad, field] of cases) {
      expect(() => requireShapeInstance(bad, 'roundedRect', 'n')).toThrow(RangeError);
      expect(() => requireShapeInstance(bad, 'roundedRect', 'n')).toThrow(field);
    }
  });

  it('reads a circle as square by its diameter, so its size cannot contradict itself', () => {
    expect(instanceSize(circle)).toEqual({ width: 40, height: 40 });
    expect(instanceSize(rect)).toEqual({ width: 100, height: 40 });
  });
});

describe('writing a slot', () => {
  it('writes every channel of one instance where it belongs', () => {
    const data = new InstanceAttributeData(2);
    data.write(1, rect, 'roundedRect', 'rect');
    expect([...data.channel('instanceOffset').subarray(2, 4)]).toEqual([10, -4]);
    expect([...data.channel('instanceSize').subarray(2, 4)]).toEqual([100, 40]);
    expect(data.channel('instanceCornerRadius')[1]).toBe(10);
    expect(data.channel('instanceGlowWorld')[1]).toBe(10);
    expect([...data.channel('instanceFillColor').subarray(3, 6)]).toEqual(
      linearFromHex(0xffb703, 'fill').map((value) => Math.fround(value)),
    );
  });

  it('leaves every other slot alone', () => {
    const data = new InstanceAttributeData(3);
    data.write(1, rect, 'roundedRect', 'rect');
    expect([...data.channel('instanceOffset')]).toEqual([0, 0, 10, -4, 0, 0]);
  });

  it('writes a circle as a square of its diameter, with a zeroed corner radius', () => {
    // Zeroed rather than left as whatever the previous occupant had. The circle
    // shader does not read it, so leaving it would be correct today and a stale
    // float waiting for the day something does.
    const data = new InstanceAttributeData(1);
    data.write(0, rect, 'roundedRect', 'rect');
    expect(data.channel('instanceCornerRadius')[0]).toBe(10);
    data.write(0, circle, 'circle', 'circle');
    expect([...data.channel('instanceSize')]).toEqual([40, 40]);
    expect(data.channel('instanceCornerRadius')[0]).toBe(0);
  });

  it('refuses a slot outside the arrays rather than discarding the write', () => {
    // Out-of-bounds assignment to a typed array is a silent no-op, so an instance
    // written past the end never appears, with nothing in the console and one
    // shape missing from a picture that has thousands.
    const data = new InstanceAttributeData(2);
    expect(() => data.write(2, rect, 'roundedRect', 'rect')).toThrow(RangeError);
    expect(() => data.write(-1, rect, 'roundedRect', 'rect')).toThrow(/\[0, 2\)/);
    expect(() => data.write(0.5, rect, 'roundedRect', 'rect')).toThrow(RangeError);
  });

  it('validates before it writes, so a rejected instance leaves no half-written slot', () => {
    const data = new InstanceAttributeData(1);
    const bad = { ...rect, cornerRadius: 90 } as ShapeInstance;
    expect(() => data.write(0, bad, 'roundedRect', 'rect')).toThrow(RangeError);
    expect([...data.channel('instanceOffset')]).toEqual([0, 0]);
  });
});

describe('moving a slot', () => {
  it('copies every channel, which is the data half of swap-with-last', () => {
    // Skipping this copy leaves one instance drawing another's data with every
    // handle still resolving correctly: a picture that is wrong in a way no
    // assertion about handles would catch.
    const data = new InstanceAttributeData(3);
    data.write(0, rect, 'roundedRect', 'rect');
    data.write(2, { ...rect, center: { x: 99, y: 99 }, cornerRadius: 5 }, 'roundedRect', 'r2');
    data.moveSlot(2, 0);
    expect([...data.channel('instanceOffset').subarray(0, 2)]).toEqual([99, 99]);
    expect(data.channel('instanceCornerRadius')[0]).toBe(5);
  });

  it('refuses to copy a slot onto itself', () => {
    // Always a caller acting on a removal whose `movedFrom` was null, which means
    // there was nothing to move. Performing it silently is how an off-by-one in
    // that branch survives.
    const data = new InstanceAttributeData(2);
    expect(() => data.moveSlot(1, 1)).toThrow(RangeError);
    expect(() => data.moveSlot(0, 2)).toThrow(RangeError);
  });
});

describe('resizing', () => {
  it('keeps every instance that still fits when it grows', () => {
    const data = new InstanceAttributeData(2);
    data.write(0, rect, 'roundedRect', 'rect');
    data.write(1, circle, 'circle', 'circle');
    data.resize(8);
    expect(data.capacity).toBe(8);
    expect(data.channel('instanceOffset')).toHaveLength(16);
    expect([...data.channel('instanceOffset').subarray(0, 4)]).toEqual([10, -4, -3, 7]);
  });

  it('keeps the live prefix when it shrinks, because a live range has no holes', () => {
    const data = new InstanceAttributeData(4);
    data.write(0, rect, 'roundedRect', 'rect');
    data.write(3, circle, 'circle', 'circle');
    data.resize(2);
    expect(data.capacity).toBe(2);
    expect([...data.channel('instanceOffset')]).toEqual([10, -4, 0, 0]);
  });

  it('does nothing at the size it already has', () => {
    const data = new InstanceAttributeData(4);
    const before = data.channel('instanceOffset');
    data.resize(4);
    expect(data.channel('instanceOffset')).toBe(before);
  });

  it('rejects a capacity of zero or less', () => {
    expect(() => new InstanceAttributeData(0)).toThrow(RangeError);
    expect(() => new InstanceAttributeData(4).resize(-1)).toThrow(RangeError);
  });
});
