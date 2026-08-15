import type { Size, Vec2 } from './types.js';
import { requireCircleRadius, requireCornerRadius } from './sdf.js';
import {
  requireColor,
  requireFinite,
  requireIntegerAtLeast,
  requireNonNegative,
} from './validate.js';

/**
 * What one instance is, as floats, and the arrays those floats live in.
 *
 * The other half of M4.3's pure core. `instance-buffer.ts` decides WHICH slot an
 * instance occupies; this file decides what is written there, in what order, and
 * with which units, and it holds the `Float32Array`s while it does. A typed
 * array is not a GPU resource: `instanced-scene.ts` wraps these in three's
 * `InstancedBufferAttribute` and nothing in this file knows that happened, so
 * every claim below is checkable in `test/instance-attributes.test.ts` with no
 * device.
 *
 * ## What is per instance, and what is per mesh
 *
 * Per INSTANCE: where the shape is, how big it is, its corner radius, its glow
 * reach, and TWO colours. Per MESH, as uniforms in
 * {@link InstancedFamilyStyle}: the outline colour, the outline width and the
 * glow's alpha.
 *
 * The split is not arbitrary and it is the one the campaign demo needs. A node's
 * colour and size are DATA, straight off the node's kind: an encounter is small
 * and one colour, a chapter is large and another, and that per-kind variation is
 * exactly what makes a far view read as structure instead of confetti. An
 * outline width in device pixels and a glow alpha are DESIGN, one decision for
 * the whole drawing, and making them per-instance would be twelve more bytes per
 * node to say the same number 3,010 times.
 *
 * The glow's REACH is on the instance side of that line and its ALPHA is not,
 * which looks inconsistent until the quad is considered: reach is in world units
 * and sizes the padded quad (see `quadPadding` in `sdf.ts`), so a shared reach
 * would either strand a small shape inside a huge quad or clip a large shape's
 * halo. The crispness ladder is the case that proves it, with glow reaches of 1,
 * 10 and 100 world units in one family.
 *
 * ## Colours are converted here, and getting that wrong is silent
 *
 * A colour reaching a shader as a UNIFORM goes through three's `Color`, which
 * converts sRGB to the linear working space on the way. A colour reaching a
 * shader as a vertex ATTRIBUTE goes through nothing at all: whatever floats are
 * in the buffer are the floats the fragment shader mixes. So the conversion
 * three was doing has to happen here, and {@link linearFromHex} is it, spelled
 * exactly the way `three/src/math/ColorManagement.js` spells it so the two
 * cannot disagree. `test/instance-attributes.test.ts` asserts the agreement
 * against a real `Color` rather than against a copy of the formula.
 *
 * Skipping it does not throw and does not look broken: every colour comes out
 * lighter and flatter, most visibly in the mid tones, which is the kind of
 * difference a reviewer attributes to their monitor.
 */

/** One named block of floats per instance: the vertex attribute's name and width. */
export interface InstanceChannel {
  /** The attribute name the shader reads. See `instanced-scene.ts`. */
  readonly name: string;
  /** Floats per instance. */
  readonly components: number;
}

/**
 * The layout, in the order the arrays are created and the tests read them.
 *
 * Six attributes and twelve floats per instance, which is 48 bytes: the
 * campaign's 3,010 nodes are 144 KB of instance data. Six separate attributes
 * rather than three wider ones packed by hand, because a packed layout saves
 * attribute slots (WebGL2 guarantees 16 and a plane's own position, normal and
 * uv take three of them) and costs every reader of this file a swizzle to work
 * out which float is which. Nine free slots is not a budget under pressure.
 *
 * `instanceColor` is deliberately NOT one of these names: three's `InstancedMesh`
 * uses it for its own per-instance colour, and a name collision on a geometry
 * attribute is resolved by whoever wrote it last.
 */
export const INSTANCE_CHANNELS: readonly InstanceChannel[] = [
  /** The shape's centre, in world units. */
  { name: 'instanceOffset', components: 2 },
  /** The shape's full size, in world units. A circle's is its diameter, twice. */
  { name: 'instanceSize', components: 2 },
  /** The corner radius, in world units. Written and ignored for a circle. */
  { name: 'instanceCornerRadius', components: 1 },
  /** The halo's reach past the boundary, in world units. Sizes the quad. */
  { name: 'instanceGlowWorld', components: 1 },
  /** The interior colour, LINEAR, three components. See {@link linearFromHex}. */
  { name: 'instanceFillColor', components: 3 },
  /** The halo's colour, linear. */
  { name: 'instanceGlowColor', components: 3 },
];

/** Floats per instance across every channel: 12, and derived so it cannot drift. */
export const INSTANCE_FLOATS = INSTANCE_CHANNELS.reduce(
  (total, channel) => total + channel.components,
  0,
);

/**
 * What every instance drawn in ONE call shares, as uniforms.
 *
 * The residue of `ShapeStyle` after the per-instance fields are taken out of it,
 * and it stays a separate type rather than a `Pick<ShapeStyle, ...>` because the
 * two records are read at different rates and by different code: this one is
 * three uniforms set once per mesh, and the rest is twelve floats per node.
 */
export interface InstancedFamilyStyle {
  /** The inset outline's colour, as `0xRRGGBB`. */
  readonly outlineColor: number;
  /** The halo's alpha where it meets the boundary, in `[0, 1]`. */
  readonly glowAlpha: number;
  /** The inset outline's width, in DEVICE pixels. See `ShapeStyle`. */
  readonly outlinePixels: number;
}

/**
 * One instance's own data, as a discriminated union on the shape it draws.
 *
 * The same argument `ShapeDescriptor` makes in `shape-scene.ts`, and it holds
 * harder here. A circle carries a RADIUS and a rounded rect carries a SIZE and a
 * corner radius, so there is no way to write a circle whose width and height
 * disagree. Flattened into one record with a rule that a circle's size is
 * square, the rule would be enforced by a runtime check at best, and violating
 * it draws a circle of the wrong radius inside a quad of the right height rather
 * than raising anything.
 *
 * The union is on the INSTANCE and the family is on the MESH, which is the same
 * discriminant read twice. {@link requireShapeInstance} is where the two are
 * checked against each other, and a circle handed to a rounded-rect mesh is a
 * `RangeError` rather than a shape drawn with somebody else's distance function.
 */
export type ShapeInstance =
  | {
      readonly kind: 'roundedRect';
      /**
       * What a `RangeError` about this instance names, if the caller has a name
       * worth using. The same field {@link ShapeDescriptor} carries and for the
       * same reason: `chapter-3.size` is a line somebody can find, and `size` in
       * a scene of three thousand instances is a search. Optional, because a
       * caller with nothing better to say gets the instance's handle instead.
       */
      readonly label?: string;
      /** The shape's centre, in world units. */
      readonly center: Vec2;
      /** The shape's full size, in world units. */
      readonly size: Size;
      /** The corner radius, in world units, at most half the smaller dimension. */
      readonly cornerRadius: number;
      /** The interior colour, as `0xRRGGBB`. */
      readonly fillColor: number;
      /** The halo's colour, as `0xRRGGBB`. */
      readonly glowColor: number;
      /** The halo's reach past the boundary, in world units. */
      readonly glowWorld: number;
    }
  | {
      readonly kind: 'circle';
      /** See the rounded rect's `label`. */
      readonly label?: string;
      readonly center: Vec2;
      /** The radius, in world units. */
      readonly radius: number;
      readonly fillColor: number;
      readonly glowColor: number;
      readonly glowWorld: number;
    };

/** Which distance function a mesh draws with, and therefore which instances it takes. */
export type ShapeFamily = ShapeInstance['kind'];

/**
 * sRGB `0xRRGGBB` to the three linear components a shader mixes.
 *
 * The constants are three's, from `ColorManagement.js`: `0.0773993808` is
 * `1 / 12.92`, and `0.9478672986` with `0.0521327014` is `(c + 0.055) / 1.055`
 * distributed. Copied at that precision rather than written as the textbook
 * formula so that the floats this produces are bit-comparable with the ones a
 * `Color` uniform produces, which is what lets a test assert the agreement
 * instead of asserting a tolerance.
 *
 * The threshold is `c < 0.04045`, matching three exactly. The two branches meet
 * to within 3e-8 there, so which side of it a value lands on is not visible; the
 * reason to match is that a divergence would be invisible for the same reason
 * and would therefore never be found.
 */
export function linearFromHex(hex: number, field: string): [number, number, number] {
  return linearComponents(requireColor(hex, field));
}

/**
 * The conversion without the check, for the one caller that has already made it:
 * {@link InstanceAttributeData.write} validates the whole instance before it
 * packs any of it, and re-checking each colour there would be the double
 * validation `shape-scene.ts` records as a cost at six shapes and would be
 * paying it three thousand times.
 */
function linearComponents(value: number): [number, number, number] {
  return [
    srgbToLinear(((value >> 16) & 0xff) / 255),
    srgbToLinear(((value >> 8) & 0xff) / 255),
    srgbToLinear((value & 0xff) / 255),
  ];
}

function srgbToLinear(component: number): number {
  return component < 0.04045
    ? component * 0.0773993808
    : Math.pow(component * 0.9478672986 + 0.0521327014, 2.4);
}

/**
 * Rejects an instance that cannot be drawn by a mesh of `family`, naming the
 * field and the instance it came from.
 *
 * The boundary, on the same terms `requireShapeStyle` sets in `sdf.ts`: this is
 * the last place an instance's numbers are a caller's numbers rather than twelve
 * floats in a buffer with no owner. Past here a `NaN` is an attribute a driver
 * accepts and a shape that does not appear.
 *
 * `field` is what makes that usable at campaign scale. `node/chapter-3.size` is
 * a line somebody can find; `size` in a scene of three thousand instances is a
 * search.
 */
export function requireShapeInstance(
  instance: ShapeInstance,
  family: ShapeFamily,
  field: string,
): ShapeInstance {
  if (instance.kind !== family) {
    throw new RangeError(
      `${field}.kind has to be ${family} to be drawn by a ${family} mesh, got ${instance.kind}`,
    );
  }
  requireFinite(instance.center.x, `${field}.center.x`);
  requireFinite(instance.center.y, `${field}.center.y`);
  requireNonNegative(instance.glowWorld, `${field}.glowWorld`);
  requireColor(instance.fillColor, `${field}.fillColor`);
  requireColor(instance.glowColor, `${field}.glowColor`);

  // Delegated to `sdf.ts` rather than restated, and the field arguments are what
  // make delegating possible: both checks take the name of the field the CALLER
  // wrote, so the same bound reports through `chapter-3.cornerRadius` here and
  // through `rect-100.cornerRadius` for a descriptor. Restating them was the
  // first draft and it left two copies of "at most half the smaller dimension",
  // which is the bound past which opposite corner arcs overlap and the field
  // stops being a distance to anything.
  if (instance.kind === 'circle') {
    requireCircleRadius(instance.radius, `${field}.radius`);
    return instance;
  }
  requireCornerRadius(
    instance.cornerRadius,
    instance.size,
    `${field}.cornerRadius`,
    `${field}.size`,
  );
  return instance;
}

/** A shape's full size in world units, whichever way the instance spells it. */
export function instanceSize(instance: ShapeInstance): Size {
  if (instance.kind === 'circle') {
    const diameter = instance.radius * 2;
    return { width: diameter, height: diameter };
  }
  return instance.size;
}

/**
 * The `Float32Array` behind every channel, sized to a capacity in instances.
 *
 * Deliberately dumb about what a slot MEANS: it holds arrays, writes one slot,
 * copies one slot over another, and reallocates. Which slot is live is
 * `InstanceBuffer`'s question and it is asked nowhere in this file, so the two
 * halves of the bookkeeping can be tested against each other rather than through
 * each other.
 */
export class InstanceAttributeData {
  readonly channels: readonly InstanceChannel[];
  #capacity: number;
  #arrays: Map<string, Float32Array>;

  constructor(capacity: number, channels: readonly InstanceChannel[] = INSTANCE_CHANNELS) {
    this.#capacity = requireIntegerAtLeast(capacity, 1, 'capacity');
    this.channels = channels;
    this.#arrays = allocate(channels, this.#capacity);
  }

  /** How many instances the arrays hold, live or not. */
  get capacity(): number {
    return this.#capacity;
  }

  /**
   * One channel's array, by name.
   *
   * The array itself rather than a copy, because `instanced-scene.ts` hands it
   * straight to an `InstancedBufferAttribute` and a copy would be a buffer that
   * never sees a write. Anything reading it is reading live data.
   */
  channel(name: string): Float32Array {
    const array = this.#arrays.get(name);
    if (array === undefined) throw new RangeError(`no instance channel named ${name}`);
    return array;
  }

  /**
   * Validates one instance against the mesh's family and writes every channel of
   * it into one slot.
   *
   * A circle's corner radius is written as 0 rather than left as whatever the
   * previous occupant of the slot had. The value is unread by the circle
   * shader, so leaving it would be correct today and would be a stale float
   * waiting for the day a shader reads it, which is the sort of thing that gets
   * found through a picture rather than a test.
   */
  write(slot: number, instance: ShapeInstance, family: ShapeFamily, field: string): void {
    this.#requireSlot(slot);
    const validated = requireShapeInstance(instance, family, field);
    const size = instanceSize(validated);
    const fill = linearComponents(validated.fillColor);
    const glow = linearComponents(validated.glowColor);

    this.#write2('instanceOffset', slot, validated.center.x, validated.center.y);
    this.#write2('instanceSize', slot, size.width, size.height);
    this.channel('instanceCornerRadius')[slot] =
      validated.kind === 'circle' ? 0 : validated.cornerRadius;
    this.channel('instanceGlowWorld')[slot] = validated.glowWorld;
    this.#write3('instanceFillColor', slot, fill);
    this.#write3('instanceGlowColor', slot, glow);
  }

  /**
   * Copies every channel of one slot over another, which is what makes
   * swap-with-last a data operation rather than only a bookkeeping one.
   *
   * Copying a slot onto itself is rejected rather than treated as a no-op. It is
   * always a caller acting on an `InstanceRemoval` whose `movedFrom` was `null`,
   * which means the freed instance was already last and there was nothing to
   * move; performing it silently is how an off-by-one in that branch survives.
   */
  moveSlot(from: number, to: number): void {
    this.#requireSlot(from);
    this.#requireSlot(to);
    if (from === to) {
      throw new RangeError(`moveSlot cannot copy slot ${String(from)} onto itself`);
    }
    for (const { name, components } of this.channels) {
      const array = this.channel(name);
      array.copyWithin(to * components, from * components, (from + 1) * components);
    }
  }

  /**
   * Reallocates every channel at a new capacity, keeping the instances that
   * still fit.
   *
   * Whole new arrays rather than a resizable buffer, because the consumer is a
   * GPU attribute whose backing array is fixed at construction anyway: growing
   * in place would still mean a new attribute, so there is nothing to be saved
   * by pretending otherwise. Shrinking keeps the first `capacity` slots, which
   * are exactly the live ones, since `InstanceBuffer` never leaves a hole.
   */
  resize(capacity: number): void {
    // An INTEGER, checked here as well as where the number is computed. A
    // fractional capacity is truncated PER CHANNEL by `new Float32Array(n *
    // components)`, so a 1-component channel comes out a slot shorter than a
    // 2-component one and the writes falling off the short one are discarded
    // with nothing thrown. `InstanceBuffer` floors its halving so it cannot
    // produce one; this is the check that says so rather than assuming it.
    const next = requireIntegerAtLeast(capacity, 1, 'capacity');
    if (next === this.#capacity) return;
    const grown = allocate(this.channels, next);
    const kept = Math.min(next, this.#capacity);
    for (const { name, components } of this.channels) {
      const target = grown.get(name);
      if (target === undefined) throw new Error('unreachable: one array per channel');
      target.set(this.channel(name).subarray(0, kept * components));
    }
    this.#arrays = grown;
    this.#capacity = next;
  }

  #write2(name: string, slot: number, x: number, y: number): void {
    const array = this.channel(name);
    array[slot * 2] = x;
    array[slot * 2 + 1] = y;
  }

  #write3(name: string, slot: number, values: readonly [number, number, number]): void {
    const array = this.channel(name);
    array[slot * 3] = values[0];
    array[slot * 3 + 1] = values[1];
    array[slot * 3 + 2] = values[2];
  }

  /**
   * A slot outside the arrays is a `RangeError` rather than a write JavaScript
   * discards. Out-of-bounds assignment to a typed array is a silent no-op, so an
   * instance written past the end never appears at all, with nothing in the
   * console and a shape missing from a picture that has thousands.
   */
  #requireSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.#capacity) {
      throw new RangeError(
        `slot has to be an integer in [0, ${String(this.#capacity)}), got ${String(slot)}`,
      );
    }
  }
}

function allocate(
  channels: readonly InstanceChannel[],
  capacity: number,
): Map<string, Float32Array> {
  return new Map(
    channels.map((channel) => [channel.name, new Float32Array(capacity * channel.components)]),
  );
}
