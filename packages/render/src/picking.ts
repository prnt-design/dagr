import { PickIdSpaceExhaustedError } from './errors.js';
import type { Size, Vec2 } from './types.js';
import {
  requireFinitePoint,
  requireIntegerAtLeast,
  requireIntegerInRange,
  requirePositive,
} from './validate.js';

/**
 * What an instance writes into an id buffer, what one pixel of that buffer says
 * afterwards, and which pixel a pointer is asking about.
 *
 * **The half of M4.8 that needs no device, shipped ahead of the half that
 * does.** The same split M4.6 made: `spring.ts` is an integrator with no
 * consumer until M4.7 drives it, and this is an encoding with no pass until
 * M4.8b draws one. The reason to take it in that order twice is the same both
 * times and it is not tidiness. Everything here is decidable in Node, and
 * `test/picking.test.ts` decides it: the round trip over the FULL id range, the
 * flip a pointer coordinate goes through, and which node an id still means
 * after the scene has moved on. What M4.8b adds is a material, an offscreen
 * target and an asynchronous readback, none of which this box can run, since
 * its headless Chromium has no WebGPU. Writing them in the same increment would
 * put unverifiable code and verifiable code behind the same green tick.
 *
 * ## An id, and not a slot or a handle
 *
 * A pick pass draws every instance in a colour that names it, reads back one
 * pixel, and turns that colour into something the caller can act on. The
 * question is what the colour names, and the package already has two candidates
 * that both fail:
 *
 * - The SLOT is what the GPU already knows, so writing it costs nothing at all:
 *   a shader reads its own instance index and needs no attribute. But
 *   `instance-buffer.ts` removes by swapping the last live instance into the
 *   freed slot, so a slot means a different instance after any removal, and a
 *   readback is ASYNCHRONOUS. The pixel answers a question about a frame that
 *   has already been drawn, and by the time it is decoded the scene has had at
 *   least one chance to move.
 * - The HANDLE is durable, which is exactly what the slot is not, and unbounded:
 *   handles come from a counter that never reuses, so they run past three bytes
 *   in a long session and truncating one is a collision with somebody else.
 *
 * So the id is a third name: durable like a handle, bounded like a slot, and
 * recycled deliberately rather than by accident. {@link PickIdRegistry} keeps
 * it, keyed by the CALLER'S OWN NAME for the thing (a node id, an edge id)
 * rather than by a handle, because that is the name a pick has to come back as
 * and because handle spaces are per family: the first rounded rect and the
 * first circle are both handle 1, so a registry keyed by handle would need the
 * family beside it to say anything.
 *
 * ## Three bytes and a tag, and what the tag is really for
 *
 * An RGBA8 target carries four bytes. The id takes three, which caps a scene at
 * 16,777,215 pickable things of one kind, and the fourth is a TAG saying which
 * kind that is: a node, an edge, or a port. M4.8's own entry justified the tag
 * as letting a hit say what it hit "without a side lookup", and that reason does
 * not survive this file: the registry IS a side lookup, it exists for the
 * recycling above, and every pick goes through it. The tag is worth having for
 * two other reasons.
 *
 * It PARTITIONS THE ID SPACE, so nodes and edges each get their own allocator
 * and their own three bytes rather than sharing one counter across two meshes
 * that know nothing about each other. And it survives the registry: a pick that
 * comes back stale can still say the pointer was over an edge, which is enough
 * to keep a hover from flickering off while the answer is re-asked.
 *
 * Tag 0 is nothing, and no id is 0. That makes a target cleared to all zeros
 * read as a miss with no reserved value for a caller to remember, and it makes
 * the sentinel unreachable from the encoding side too, since
 * {@link encodePickId} refuses 0 (see `test/picking.test.ts`).
 *
 * ## Why the id is taken apart HERE and not in the shader
 *
 * The alternative is to hand the shader one number and let it split that number
 * into three channels, which is three lines of WGSL and no bytes per instance.
 * It is rejected for two reasons, and the second is the one with a measurement
 * behind it.
 *
 * A shader is the one place this package cannot test arithmetic. `sdf.ts`
 * exists because of that, and its answer (write the formula once over an
 * abstract arithmetic, run it over plain numbers in a test) is available here
 * too, at the cost of a `floor` primitive that interface does not have. Even
 * taken, it would put the correctness of an ID, where being off by one means
 * confidently naming a different node, in the layer that has no coverage.
 *
 * And an id carried as ONE number does not survive the trip. Every vertex of an
 * instance's quad holds the same value, so the interpolated value differs from
 * it only by the rounding of weights that sum to about one, which is on the
 * order of a float32 ulp. At 2^24 that ulp is exactly 1, so one bit of drift is
 * the next id. Carried as three byte-valued channels, the same drift is 6e-8
 * against an RGBA8 write that rounds to the nearest 1/255, a margin of about
 * 3e4. `test/picking.test.ts` asserts both halves, the surviving one over every
 * byte value there is and the losing one at the top of the range.
 *
 * ## What the pass has to be, for any of this to hold
 *
 * Three properties, none of which this file can enforce and all of which
 * M4.8b's pass owes:
 *
 * - The target is cleared to all four channels ZERO. The tag is the authority
 *   in {@link decodePickPixel} and the colour channels are not consulted on a
 *   miss, so a different clear does not produce a wrong hit, but it does leave
 *   a pixel whose bytes mean nothing.
 * - BLENDING IS OFF and the material is not transparent. A blend averages two
 *   ids into a third that is perfectly well formed and belongs to a node
 *   somewhere else in the scene.
 * - NO COLOUR MANAGEMENT anywhere on the path. These bytes are not a colour,
 *   and an sRGB conversion applied to them is a permutation of the id space.
 *
 * The unknown-tag and zero-id checks in {@link decodePickPixel} catch some of
 * the ways those are got wrong and cannot catch all of them, which is why they
 * are written down here as a contract rather than left to the checks.
 */

/** What a pick pixel's tag byte says a hit IS. */
export type PickKind = 'node' | 'edge' | 'port';

/**
 * The tag byte each kind is written with, and the one no kind claims.
 *
 * `port` has no drawn representation until M6.2 and is here anyway, because the
 * cost of reserving a tag is a line and the cost of adding one later is every
 * recorded pick pixel in a fixture meaning something else.
 */
export const PICK_KIND_TAGS: Readonly<Record<PickKind, number>> = Object.freeze({
  node: 1,
  edge: 2,
  port: 3,
});

/** The tag a cleared target carries: nothing was drawn at this pixel. */
export const NO_PICK_TAG = 0;

/** How many bits of id the three colour channels carry. */
export const PICK_ID_BITS = 24;

/** The largest id those bits hold, and therefore the largest a registry gives out. */
export const MAX_PICK_ID = 2 ** PICK_ID_BITS - 1;

/** The tag byte back to the kind that wrote it, built once from the map above. */
const KIND_BY_TAG: ReadonlyMap<number, PickKind> = new Map(
  Object.entries(PICK_KIND_TAGS).map(([kind, tag]) => [tag, kind as PickKind]),
);

/**
 * The four bytes one instance writes: an id across three channels and a kind in
 * the fourth.
 *
 * BYTES rather than the normalised floats a vertex attribute holds, because
 * bytes are what both ends of the round trip actually are. A readback gives
 * bytes, and whether the attribute carrying them is a normalised `Uint8Array`
 * (four bytes an instance) or a `Float32Array` of `k / 255` (sixteen) is a
 * question about buffers that M4.8b answers, with the same four numbers either
 * way.
 */
export interface PickBytes {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** What one pixel of an id buffer says: which thing, and what kind of thing. */
export interface PickHit {
  readonly id: number;
  readonly kind: PickKind;
}

/**
 * An id and a kind to the four bytes that name them.
 *
 * Big end first, so the three channels read as the top, middle and bottom bytes
 * of `0xRRGGBB` in the order a `0x`-spelled id is written. Nothing depends on
 * the order beyond agreeing with {@link decodePickPixel}, and the reason to
 * pick the readable one is that a pick pixel is something somebody eventually
 * reads out of a debugger.
 *
 * Rejects an id outside `[1, MAX_PICK_ID]`. Both ends matter: 0 is the miss
 * sentinel, and anything above the range would silently encode as the low three
 * bytes, which is a real id belonging to another instance.
 */
export function encodePickId(id: number, kind: PickKind): PickBytes {
  requireIntegerInRange(id, 1, MAX_PICK_ID, 'id');
  return {
    r: (id >>> 16) & 0xff,
    g: (id >>> 8) & 0xff,
    b: id & 0xff,
    a: PICK_KIND_TAGS[kind],
  };
}

/**
 * Four bytes of a readback back to a hit, or `null` where nothing was drawn.
 *
 * Takes an `ArrayLike` and an offset rather than a `PickBytes`, because that is
 * the shape a readback arrives in: a `Uint8Array` a driver filled, with the
 * pixel of interest somewhere inside it. A one-pixel read puts it at 0 and a
 * region read does not.
 *
 * Every channel is checked to be a byte, which looks redundant against a
 * `Uint8Array` and is not. The failure it catches is a caller handing over
 * NORMALISED floats. Every channel is then under 1, the shifts below truncate
 * all three colour channels to 0, and the tag is a fraction that is neither the
 * miss sentinel nor a kind, so without this check the symptom is the
 * unknown-tag error below complaining about `0.0039` while the id has already
 * been thrown away. Naming the real mistake costs four comparisons on a path
 * that runs at most once per pointer move.
 *
 * The two `RangeError`s past that are about the PASS rather than about the
 * caller, and they are thrown rather than folded into a miss because a miss is
 * a normal answer that a hover handler acts on every time the pointer crosses
 * the background. A pass drawing with the wrong material would report as a
 * scene where nothing is pickable, forever, with nothing to look at. See this
 * module's docstring for what those checks do not cover.
 */
export function decodePickPixel(bytes: ArrayLike<number>, offset = 0): PickHit | null {
  requireIntegerAtLeast(offset, 0, 'offset');
  if (offset + 4 > bytes.length) {
    throw new RangeError(
      `a pick pixel is four channels and there are ${String(Math.max(0, bytes.length - offset))} at offset ${String(offset)}`,
    );
  }
  const r = requireIntegerInRange(bytes[offset] ?? Number.NaN, 0, 255, 'pixel.r');
  const g = requireIntegerInRange(bytes[offset + 1] ?? Number.NaN, 0, 255, 'pixel.g');
  const b = requireIntegerInRange(bytes[offset + 2] ?? Number.NaN, 0, 255, 'pixel.b');
  const tag = requireIntegerInRange(bytes[offset + 3] ?? Number.NaN, 0, 255, 'pixel.a');

  if (tag === NO_PICK_TAG) {
    return null;
  }
  const kind = KIND_BY_TAG.get(tag);
  if (kind === undefined) {
    throw new RangeError(
      `pixel.a is not a pick kind: got ${String(tag)}, expected one of ${[...KIND_BY_TAG.keys()].join(', ')} or ${String(NO_PICK_TAG)}`,
    );
  }
  const id = (r << 16) | (g << 8) | b;
  if (id === 0) {
    throw new RangeError(`pixel carries kind ${kind} with id 0, which no instance is given`);
  }
  return { id, kind };
}

/** Where in an id buffer a pointer is asking about, in the readback's own axes. */
export interface PickReadbackPixel {
  /** From the LEFT of the buffer, in device pixels. */
  readonly x: number;
  /** From the BOTTOM of the buffer, in device pixels. See below. */
  readonly y: number;
}

/**
 * A pointer position to the one pixel a pick reads.
 *
 * The pointer is in CSS pixels from the canvas's TOP-LEFT, which is what a
 * `PointerEvent` gives once the canvas's bounding rectangle is subtracted, and
 * the same convention `Camera2D.screenToWorld` takes.
 *
 * **The ratio between a CSS pixel and a device one is not read here.**
 * `camera.ts` states that `drawingBufferSize()` is the one method allowed to
 * read `devicePixelRatio`, and this takes the buffer's size as an argument
 * rather than deriving it a second time from the ratio. That is not only
 * hygiene: `drawingBufferSize` rounds to the nearest whole pixel and floors at
 * 1, and a second derivation that flooring instead would be off by one along
 * two edges of the buffer, which is exactly where a pick lands least often and
 * is therefore found last.
 *
 * **Y comes back measured from the BOTTOM.** Screen y grows downward, and
 * three's `readRenderTargetPixelsAsync` takes its origin at the bottom left, as
 * every readback in that library has since the WebGL backend was the only one.
 * This is the one claim in this file that a device has to confirm rather than a
 * test: M4.8b owes it, and a flip got backwards here is a pick that works
 * perfectly in the middle of the canvas and names the wrong node everywhere
 * else, which is the failure shape most likely to be shipped.
 *
 * `null` where the pointer is off the canvas, which is a different answer from
 * a miss. A miss clears a hover, and a pointer that has left should not,
 * because it may have left onto an overlay element sitting over the canvas.
 */
export function pickReadbackPixel(
  pointer: Vec2,
  cssSize: Size,
  bufferSize: Size,
): PickReadbackPixel | null {
  requireFinitePoint(pointer, 'pointer');
  requirePositive(cssSize.width, 'cssSize.width');
  requirePositive(cssSize.height, 'cssSize.height');
  requireIntegerAtLeast(bufferSize.width, 1, 'bufferSize.width');
  requireIntegerAtLeast(bufferSize.height, 1, 'bufferSize.height');

  if (
    pointer.x < 0 ||
    pointer.y < 0 ||
    pointer.x >= cssSize.width ||
    pointer.y >= cssSize.height
  ) {
    return null;
  }

  // Clamped as well as ranged, and the clamp is not dead: the range check above
  // is against the CSS box and the floor below is in buffer pixels, so a
  // pointer a fraction of a CSS pixel inside the right edge can floor to the
  // buffer's width at a ratio that is not a whole number.
  const x = clampIndex(Math.floor((pointer.x * bufferSize.width) / cssSize.width), bufferSize.width);
  const fromTop = clampIndex(
    Math.floor((pointer.y * bufferSize.height) / cssSize.height),
    bufferSize.height,
  );
  return { x, y: bufferSize.height - 1 - fromTop };
}

function clampIndex(value: number, length: number): number {
  return Math.min(length - 1, Math.max(0, value));
}

/**
 * Which id each pickable thing currently has, and whether an id still means
 * what a pass wrote it to mean.
 *
 * One registry per KIND, since the tag partitions the id space. Keys are the
 * caller's own durable names, which is what a pick has to come back as.
 *
 * ## The stamp, and the only wrong answer that was ever on offer
 *
 * A readback answers a question about a frame already drawn. Between the pass
 * and the pixel the scene can remove a node and add another, the removed node's
 * id goes back on the free list, and the new node takes it. Decoding then gives
 * a real id that resolves to a real node that was not under the pointer.
 *
 * So every assignment bumps {@link stamp}, each id remembers the stamp it was
 * assigned at, and {@link keyFor} takes the stamp the PASS was drawn with and
 * refuses an id that has changed hands since. The comparison is per id rather
 * than against one revision for the whole registry, which matters: a scene that
 * adds a node every frame bumps the stamp every frame, and a registry-wide
 * revision would refuse every pick in flight in exactly the scenes picking is
 * for.
 *
 * The free list is FIFO, so a released id waits behind every other released id
 * before it is handed out again. That changes nothing about what is correct,
 * which the stamp decides on its own. It changes how often a pick in flight is
 * refused rather than answered, which is the difference between a hover that
 * lags a frame under churn and one that flickers.
 */
export class PickIdRegistry {
  /** The kind every id from this registry is tagged with. */
  readonly kind: PickKind;

  readonly #capacity: number;
  readonly #idByKey = new Map<string, number>();
  readonly #keyById = new Map<number, string>();
  readonly #assignedAt = new Map<number, number>();
  #free: number[] = [];
  #freeHead = 0;
  #next = 1;
  #assignments = 0;

  /**
   * `capacity` exists so the exhaustion branch is reachable from a test, and
   * for nothing else: the default is every id three bytes hold, which is 800MB
   * of instance data before a pick id is written. A guard that cannot be shown
   * failing is a guard nobody has checked, which this repo has now paid for
   * enough times to write down.
   */
  constructor(kind: PickKind, capacity: number = MAX_PICK_ID) {
    this.kind = kind;
    this.#capacity = requireIntegerInRange(capacity, 1, MAX_PICK_ID, 'capacity');
  }

  /** How many keys currently hold an id. */
  get size(): number {
    return this.#idByKey.size;
  }

  /**
   * The value to record when a pick pass is DRAWN, and to hand back to
   * {@link keyFor} when its pixel arrives.
   */
  get stamp(): number {
    return this.#assignments;
  }

  /** Whether `key` currently holds an id. */
  has(key: string): boolean {
    return this.#idByKey.has(key);
  }

  /**
   * The id for `key`, assigning one if it has none.
   *
   * Idempotent, which is what makes it callable from a `setNodes` diff without
   * the diff having to know whether a node is new: a node in two consecutive
   * calls keeps its id for the same reason it keeps its instance handle.
   *
   * Throws {@link PickIdSpaceExhaustedError} when there is no id left, rather
   * than reusing one that is still spoken for.
   */
  idFor(key: string): number {
    const existing = this.#idByKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.#take();
    this.#assignments += 1;
    this.#idByKey.set(key, id);
    this.#keyById.set(id, key);
    this.#assignedAt.set(id, this.#assignments);
    return id;
  }

  /**
   * Gives `key`'s id back, and reports whether it had one.
   *
   * A boolean rather than a throw, following `Map.delete`, because the caller
   * that would have to catch it is a scene diff removing what it just decided
   * is gone, and a removal that removes nothing is that diff's business to
   * assert rather than this registry's to police.
   */
  release(key: string): boolean {
    const id = this.#idByKey.get(key);
    if (id === undefined) {
      return false;
    }
    this.#idByKey.delete(key);
    this.#keyById.delete(id);
    this.#assignedAt.delete(id);
    this.#free.push(id);
    return true;
  }

  /**
   * The key an id names, as long as it has not changed hands since `stamp`.
   *
   * `null` covers three cases a caller treats alike and this method
   * distinguishes for nobody: an id never handed out, one released and not yet
   * reused, and one reused since the pass. All three mean the same thing to a
   * pointer, which is that the pick has no answer and the next frame will.
   */
  keyFor(id: number, stamp: number): string | null {
    // Checked rather than trusted, because the ways a stamp goes wrong are all
    // silent and one of them is worse than a crash: `Infinity` passes every
    // comparison below and turns the staleness guard off for good, which is
    // exactly the wrong answer this method exists to refuse.
    requireIntegerInRange(stamp, 0, Number.MAX_SAFE_INTEGER, 'stamp');
    const key = this.#keyById.get(id);
    if (key === undefined) {
      return null;
    }
    const assignedAt = this.#assignedAt.get(id);
    if (assignedAt === undefined || assignedAt > stamp) {
      return null;
    }
    return key;
  }

  #take(): number {
    const recycled = this.#free[this.#freeHead];
    if (recycled !== undefined) {
      this.#freeHead += 1;
      // A head cursor rather than `shift`, and a compaction rather than a
      // cursor that grows forever: the array only ever grows by pushes, so a
      // long session's free list would otherwise hold every id ever released.
      if (this.#freeHead > 64 && this.#freeHead * 2 >= this.#free.length) {
        this.#free = this.#free.slice(this.#freeHead);
        this.#freeHead = 0;
      }
      return recycled;
    }
    if (this.#next > this.#capacity) {
      throw new PickIdSpaceExhaustedError(this.kind, this.#capacity);
    }
    const id = this.#next;
    this.#next += 1;
    return id;
  }
}
