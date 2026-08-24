import { describe, expect, it } from 'vitest';
import { PickIdSpaceExhaustedError } from '../src/errors.js';
import {
  MAX_PICK_ID,
  NO_PICK_TAG,
  PICK_ID_BITS,
  PICK_KIND_TAGS,
  PickIdRegistry,
  decodePickPixel,
  encodePickId,
  pickReadbackPixel,
} from '../src/picking.js';
import type { PickKind } from '../src/picking.js';

/**
 * What a pick pixel says, and the pixel it is read from.
 *
 * The device-free half of M4.8, and this file is the whole of what "tested"
 * means for it: no adapter, no render target, no readback. That is not a
 * weakening of the claim, it is where M4.8a drew the line. An id that survives
 * a round trip through four bytes is arithmetic, the pixel a pointer lands on
 * is arithmetic, and which node an id still means is a `Map`. What M4.8b adds
 * is a pass that writes these bytes and a device that reads them back, and the
 * one thing this file cannot check is that three's readback measures y from the
 * bottom, which `pickReadbackPixel`'s docstring names as an assumption rather
 * than a fact.
 *
 * Two of the suites below exist to show a guard failing rather than passing,
 * which is the repo's rule for a check that is vacuous by construction. The
 * quantisation margin passes for every byte value there is, so the same suite
 * runs the alternative encoding it rules out and watches it lose a node. The
 * exhaustion branch is unreachable at any drawable scene size, so the registry
 * takes a capacity and the test reaches it with three ids.
 */

/** Every kind, so a test that iterates them fails to compile when one is added. */
const KINDS: readonly PickKind[] = ['node', 'edge', 'port'];

/** What a GPU does to a float on the way into an RGBA8 target. */
function quantiseUnorm8(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/** The next float32 above `value`, which is what one ulp of drift looks like. */
function nextFloat32Up(value: number): number {
  const buffer = new Float32Array([value]);
  const bits = new Uint32Array(buffer.buffer);
  bits[0] = (bits[0] ?? 0) + 1;
  return buffer[0] ?? 0;
}

/** A deterministic sequence, so a failure names an id somebody can re-run. */
function* lcg(count: number, modulus: number): Generator<number> {
  let state = 12345;
  for (let i = 0; i < count; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    yield (state % modulus) + 1;
  }
}

describe('encoding a pick id', () => {
  it('puts the id in three bytes and the kind in the fourth', () => {
    expect(encodePickId(0x123456, 'node')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
    expect(encodePickId(0x123456, 'edge')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 2 });
    expect(encodePickId(0x123456, 'port')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 3 });
  });

  it(
    'round-trips every id in the full 24-bit range, for one kind',
    // Sixteen million round trips, about four seconds on this box. The
    // explicit timeout is not slack for a slow assertion, it is the machine:
    // it runs two agents at once and the default five seconds is inside the
    // range a neighbour's build moves this by, which is a test that fails for
    // a reason that is not about the code.
    { timeout: 60_000 },
    () => {
      // The full range, because M4.8's entry asks for the full range and
      // because a sampled sweep would not distinguish a shift from a mask:
      // `id >>> 8` where `id >>> 16` was meant agrees with the correct answer
      // on every id under 65536, which is most of what a sampled test would
      // generate.
      const pixel = new Uint8Array(4);
      for (let id = 1; id <= MAX_PICK_ID; id += 1) {
        const bytes = encodePickId(id, 'node');
        pixel[0] = bytes.r;
        pixel[1] = bytes.g;
        pixel[2] = bytes.b;
        pixel[3] = bytes.a;
        const hit = decodePickPixel(pixel);
        if (hit?.id !== id || hit.kind !== 'node') {
          // Asserted inside the branch rather than on every iteration: sixteen
          // million `expect` calls take minutes, and one comparison takes none.
          expect(hit).toEqual({ id, kind: 'node' });
        }
      }
    },
  );

  it('round-trips every kind at the boundaries of the range', () => {
    for (const kind of KINDS) {
      for (const id of [1, 2, 255, 256, 65535, 65536, MAX_PICK_ID - 1, MAX_PICK_ID]) {
        const bytes = encodePickId(id, kind);
        expect(decodePickPixel([bytes.r, bytes.g, bytes.b, bytes.a])).toEqual({ id, kind });
      }
    }
  });

  it('refuses an id outside the range, naming the field', () => {
    expect(() => encodePickId(0, 'node')).toThrow(/^id has to be an integer between 1 and 16777215/);
    expect(() => encodePickId(-1, 'node')).toThrow(RangeError);
    expect(() => encodePickId(MAX_PICK_ID + 1, 'node')).toThrow(RangeError);
    expect(() => encodePickId(1.5, 'node')).toThrow(RangeError);
    expect(() => encodePickId(Number.NaN, 'node')).toThrow(RangeError);
  });

  it('cannot encode the value a cleared target reads as', () => {
    // The sentinel is not a reserved id that a caller has to remember to skip:
    // it is the absence of a tag, and 0 is refused above so that it cannot be
    // reached from the other direction either.
    expect(NO_PICK_TAG).toBe(0);
    expect(Object.values(PICK_KIND_TAGS).every((tag) => tag > NO_PICK_TAG)).toBe(true);
    expect(decodePickPixel([0, 0, 0, 0])).toBeNull();
  });

  it('states the width the three bytes carry', () => {
    expect(PICK_ID_BITS).toBe(24);
    expect(MAX_PICK_ID).toBe(2 ** PICK_ID_BITS - 1);
  });
});

describe('reading a pick pixel', () => {
  it('reads four bytes at an offset, from a typed array', () => {
    const readback = new Uint8Array([9, 9, 9, 9, 0x00, 0x01, 0x02, 2]);
    expect(decodePickPixel(readback, 4)).toEqual({ id: 0x000102, kind: 'edge' });
  });

  it('is a miss wherever nothing was drawn, whatever the colour channels hold', () => {
    // The tag is the authority and the colour is not consulted, so a pass that
    // cleared to something other than black still reads as a miss. The pass is
    // told to clear to all zeros anyway; this is what happens when it does not.
    expect(decodePickPixel([0, 0, 0, 0])).toBeNull();
    expect(decodePickPixel([13, 14, 15, 0])).toBeNull();
  });

  it('refuses a channel that is not a byte', () => {
    // The failure this catches is a caller handing over NORMALISED floats.
    // `[0.07, 0.2, 0.34, 0.004]` would truncate to id 0 in the shifts and then
    // report the tag as the problem, which is the one number in the pixel that
    // is closest to being right.
    expect(() => decodePickPixel([0.5, 0, 0, 1])).toThrow(/^pixel.r has to be an integer/);
    expect(() => decodePickPixel([0, 256, 0, 1])).toThrow(/^pixel.g has to be an integer/);
    expect(() => decodePickPixel([0, 0, -1, 1])).toThrow(/^pixel.b has to be an integer/);
    expect(() => decodePickPixel([0, 0, 0, 1.5])).toThrow(/^pixel.a has to be an integer/);
  });

  it('refuses a pixel with fewer than four channels left', () => {
    expect(() => decodePickPixel([1, 2, 3])).toThrow(RangeError);
    expect(() => decodePickPixel(new Uint8Array([1, 2, 3, 4]), 1)).toThrow(RangeError);
  });

  it('refuses a tag no kind claims', () => {
    // Reachable one way only: a pass drawing with the wrong material, or with
    // blending left on, which averages two tags into a third. Returning a miss
    // instead would hide a misconfigured pass for as long as the pass exists.
    expect(() => decodePickPixel([1, 2, 3, 4])).toThrow(/^pixel.a is not a pick kind/);
    expect(() => decodePickPixel([1, 2, 3, 255])).toThrow(RangeError);
  });

  it('refuses a tagged pixel whose id is zero', () => {
    // No instance is ever given id 0, so this is the other half of the blending
    // symptom: an alpha that survived a blend over colour channels that did not.
    expect(() => decodePickPixel([0, 0, 0, 1])).toThrow(/^pixel carries kind node with id 0/);
  });
});

describe('the margin a byte-valued channel has, and the one an index does not', () => {
  it('survives a thousand ulps of interpolation drift, at every byte value', () => {
    // Why the id is decomposed on the CPU rather than carried as one number.
    // Every vertex of an instance's quad holds the same channel value, so the
    // interpolated value differs from it only by the rounding of weights that
    // sum to about one. The write to an RGBA8 target then rounds to the nearest
    // 1/255, which is 0.00196 wide against a float32 ulp of at most 6e-8 here.
    for (let byte = 0; byte <= 255; byte += 1) {
      let drifted = byte / 255;
      for (let step = 0; step < 1000; step += 1) drifted = nextFloat32Up(drifted);
      expect(quantiseUnorm8(drifted)).toBe(byte);
    }
  });

  it('does not survive one ulp when the index is the interpolated value', () => {
    // The rejected alternative, shown losing. A float32 at 2^24 has an ulp of
    // exactly 1, so the same drift that is invisible above is a different node.
    const asOneNumber = Math.fround(MAX_PICK_ID);
    expect(nextFloat32Up(asOneNumber)).not.toBe(asOneNumber);
    expect(nextFloat32Up(asOneNumber) - asOneNumber).toBeGreaterThanOrEqual(1);
  });
});

describe('the pixel a pointer reads', () => {
  const css = { width: 400, height: 300 };

  it('turns the top-left CSS pixel into the bottom-left device pixel', () => {
    // The flip is the whole of this function's risk. Screen y grows downward
    // and three's readback measures y from the bottom of the target.
    expect(pickReadbackPixel({ x: 0, y: 0 }, css, { width: 400, height: 300 })).toEqual({
      x: 0,
      y: 299,
    });
  });

  it('turns the bottom-right CSS pixel into the top-right device pixel', () => {
    expect(pickReadbackPixel({ x: 399.9, y: 299.9 }, css, { width: 400, height: 300 })).toEqual({
      x: 399,
      y: 0,
    });
  });

  it('scales by the ratio between the two sizes rather than by a device pixel ratio', () => {
    // The ratio is never read here, which is the rule `camera.ts` sets: the
    // drawing buffer size is the one place it is allowed, and this takes that
    // size rather than deriving it a second time.
    expect(pickReadbackPixel({ x: 10, y: 10 }, css, { width: 800, height: 600 })).toEqual({
      x: 20,
      y: 579,
    });
    expect(pickReadbackPixel({ x: 10, y: 10 }, css, { width: 200, height: 150 })).toEqual({
      x: 5,
      y: 144,
    });
  });

  it('is not a question at all when the pointer is off the canvas', () => {
    // A miss and a pointer that left the canvas are different answers: a miss
    // clears a hover, and this should not, because the pointer may be over an
    // overlay element sitting on top of the canvas.
    const buffer = { width: 400, height: 300 };
    expect(pickReadbackPixel({ x: -0.5, y: 10 }, css, buffer)).toBeNull();
    expect(pickReadbackPixel({ x: 10, y: -0.5 }, css, buffer)).toBeNull();
    expect(pickReadbackPixel({ x: 400, y: 10 }, css, buffer)).toBeNull();
    expect(pickReadbackPixel({ x: 10, y: 300 }, css, buffer)).toBeNull();
  });

  it('never lands outside the buffer, at any ratio', () => {
    for (const scale of [0.25, 0.5, 1, 1.5, 2, 3]) {
      const buffer = {
        width: Math.max(1, Math.round(css.width * scale)),
        height: Math.max(1, Math.round(css.height * scale)),
      };
      for (const point of [
        { x: 0, y: 0 },
        { x: css.width - 1e-9, y: css.height - 1e-9 },
        { x: css.width / 2, y: css.height / 2 },
      ]) {
        const pixel = pickReadbackPixel(point, css, buffer);
        expect(pixel).not.toBeNull();
        expect(pixel?.x).toBeGreaterThanOrEqual(0);
        expect(pixel?.x).toBeLessThan(buffer.width);
        expect(pixel?.y).toBeGreaterThanOrEqual(0);
        expect(pixel?.y).toBeLessThan(buffer.height);
      }
    }
  });

  it('refuses a pointer or a size that is not a number it can use', () => {
    const buffer = { width: 400, height: 300 };
    expect(() => pickReadbackPixel({ x: Number.NaN, y: 0 }, css, buffer)).toThrow(
      /^pointer.x has to be a finite number/,
    );
    expect(() => pickReadbackPixel({ x: 0, y: 0 }, { width: 0, height: 300 }, buffer)).toThrow(
      /^cssSize.width has to be a finite number above zero/,
    );
    expect(() => pickReadbackPixel({ x: 0, y: 0 }, css, { width: 400, height: 0 })).toThrow(
      /^bufferSize.height has to be an integer of at least 1/,
    );
    expect(() => pickReadbackPixel({ x: 0, y: 0 }, css, { width: 1.5, height: 300 })).toThrow(
      /^bufferSize.width has to be an integer of at least 1/,
    );
  });
});

describe('the ids a scene hands out', () => {
  it('gives each key one id, from 1 up, and keeps giving it the same one', () => {
    const registry = new PickIdRegistry('node');
    expect(registry.idFor('a')).toBe(1);
    expect(registry.idFor('b')).toBe(2);
    expect(registry.idFor('a')).toBe(1);
    expect(registry.size).toBe(2);
  });

  it('resolves an id back to its key at the stamp the pass was drawn with', () => {
    const registry = new PickIdRegistry('node');
    const id = registry.idFor('chapter-3');
    const stamp = registry.stamp;
    expect(registry.keyFor(id, stamp)).toBe('chapter-3');
  });

  it('knows nothing about an id it never handed out', () => {
    const registry = new PickIdRegistry('node');
    registry.idFor('a');
    expect(registry.keyFor(9, registry.stamp)).toBeNull();
  });

  it('forgets a released key and its id', () => {
    const registry = new PickIdRegistry('node');
    const id = registry.idFor('a');
    expect(registry.release('a')).toBe(true);
    expect(registry.release('a')).toBe(false);
    expect(registry.keyFor(id, registry.stamp)).toBeNull();
    expect(registry.size).toBe(0);
  });

  it('refuses to answer a pick issued before the id changed hands', () => {
    // The whole reason the stamp exists. A readback answers a question about a
    // frame that has already been drawn, so between the draw and the answer the
    // id in the pixel may have been released and given to another node. The
    // wrong node is the one outcome not on offer.
    const registry = new PickIdRegistry('node');
    const id = registry.idFor('a');
    const stamp = registry.stamp;
    registry.release('a');
    expect(registry.idFor('b')).toBe(id);
    expect(registry.keyFor(id, stamp)).toBeNull();
    expect(registry.keyFor(id, registry.stamp)).toBe('b');
  });

  it('leaves a pick alone when some other id changed hands', () => {
    // The reason the stamp is compared per id rather than kept as one revision
    // for the whole registry: a scene that adds a node every frame would
    // otherwise refuse every pick in flight.
    const registry = new PickIdRegistry('node');
    const id = registry.idFor('a');
    const stamp = registry.stamp;
    registry.idFor('b');
    registry.release('b');
    registry.idFor('c');
    expect(registry.keyFor(id, stamp)).toBe('a');
  });

  it('reuses the id that has been out of service longest', () => {
    // First in, first out, which does not change what is correct: the stamp
    // above decides that. It changes how often a pick in flight is refused,
    // by giving the id in the pixel the whole free list to wait behind.
    const registry = new PickIdRegistry('node');
    registry.idFor('a');
    registry.idFor('b');
    registry.idFor('c');
    registry.release('a');
    registry.release('b');
    expect(registry.idFor('d')).toBe(1);
    expect(registry.idFor('e')).toBe(2);
    expect(registry.idFor('f')).toBe(4);
  });

  it('refuses a stamp that would switch the guard off', () => {
    // `Infinity` is greater than every assignment counter there will ever be,
    // so it answers every stale pick with a confident wrong node. It is also
    // what a caller gets from arithmetic on an uninitialised stamp.
    const registry = new PickIdRegistry('node');
    const id = registry.idFor('a');
    expect(() => registry.keyFor(id, Number.POSITIVE_INFINITY)).toThrow(
      /^stamp has to be an integer/,
    );
    expect(() => registry.keyFor(id, -1)).toThrow(RangeError);
    expect(() => registry.keyFor(id, 1.5)).toThrow(RangeError);
  });

  it('carries the kind it stamps every id with', () => {
    expect(new PickIdRegistry('edge').kind).toBe('edge');
  });

  it('runs out of ids rather than handing out one that is already spoken for', () => {
    // Unreachable at any scene a GPU draws: 16,777,215 live instances is 800MB
    // of instance data before a pick id is written. The capacity argument is
    // what makes the branch demonstrable, and it is the only reason it exists.
    const registry = new PickIdRegistry('node', 3);
    registry.idFor('a');
    registry.idFor('b');
    registry.idFor('c');
    expect(() => registry.idFor('d')).toThrow(PickIdSpaceExhaustedError);
    expect(() => registry.idFor('d')).toThrow(/^ran out of node pick ids at 3/);
    registry.release('b');
    expect(registry.idFor('d')).toBe(2);
  });

  it('refuses a capacity that is not an id count', () => {
    expect(() => new PickIdRegistry('node', 0)).toThrow(/^capacity has to be an integer/);
    expect(() => new PickIdRegistry('node', MAX_PICK_ID + 1)).toThrow(RangeError);
    expect(() => new PickIdRegistry('node', 1.5)).toThrow(RangeError);
  });

  it('survives a churn of adds and removes without losing a live key', () => {
    // The property the two maps have to keep together, run over a sequence
    // long enough to reuse every id several times.
    const registry = new PickIdRegistry('node', 8);
    const live = new Map<string, number>();
    let next = 0;
    for (const draw of lcg(400, 16)) {
      if (draw <= 8 && live.size > 0) {
        const [key] = live.keys();
        if (key !== undefined) {
          registry.release(key);
          live.delete(key);
        }
      } else if (live.size < 8) {
        const key = `n${String(next++)}`;
        live.set(key, registry.idFor(key));
      }
      expect(registry.size).toBe(live.size);
      for (const [key, id] of live) {
        expect(registry.keyFor(id, registry.stamp)).toBe(key);
      }
    }
  });
});
