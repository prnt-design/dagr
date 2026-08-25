import { UnknownInstanceHandleError } from './errors.js';
import { requireIntegerAtLeast } from './validate.js';

/**
 * Which slot of an instance buffer each live instance occupies, and how big the
 * buffer has to be. No GPU, no three.js, no typed array: this file is integers
 * and a map.
 *
 * **It is separated because it is the part most likely to be subtly wrong and
 * the part that needs no device to prove right.** Everything a GPU is required
 * for (uploading a buffer, drawing an instanced mesh) is unverifiable in Node
 * and is kept as thin as it can be in `instanced-scene.ts`; the bookkeeping
 * underneath it is decidable arithmetic, so `test/instance-buffer.test.ts`
 * decides it: allocate, free, reuse, grow, compact, and the invariant that a
 * live handle always resolves to the right slot.
 *
 * ## Removal is swap-with-last, and this is a resolved call
 *
 * Freeing slot `i` moves the LAST live instance into `i` and shrinks the count,
 * so live slots are always the contiguous range `[0, count)` and one draw call
 * covers them with no holes and no per-slot liveness test. The handle-to-slot
 * map is what makes that survivable, and the indirection's supposed cost does
 * not survive inspection: per-frame rendering iterates slots on the GPU and
 * never consults the map, the per-frame spring pass (M4.7a) iterates spring
 * state keyed by the caller's own id and never consults it either, and the map
 * is touched once per
 * CHANGED entry when a delta is applied, which is O(size of delta). Leaving
 * holes and compacting on a threshold is the alternative, and it wastes buffer
 * space and draw work for nothing the map does not already provide.
 *
 * What swap-with-last costs, stated because a consumer has to know it: SLOT
 * ORDER IS NOT DURABLE, so anything a renderer derives from it is not either.
 * The one that bites is blend order between two overlapping transparent
 * instances in the same draw call, which is slot order and which therefore
 * changes when an unrelated instance is removed. `instanced-scene.ts` carries
 * that note where a caller meets it.
 *
 * ## THE INVARIANT: per-instance state is keyed by HANDLE, never by SLOT
 *
 * State this loudly, because the rest of the package relies on it and
 * swap-with-last corrupts slot-keyed data SILENTLY, without an error: the slot
 * stays a perfectly valid index, it merely belongs to a different instance now.
 * Spring state was this invariant's predicted first consumer and turned out not
 * to be one: M4.6 shipped the arithmetic as a pure function holding no state,
 * and M4.7a's `motion.ts` holds the state a caller drives keyed by the CALLER'S
 * OWN NODE ID, one layer further out, exactly where M4.8a's picking ids went.
 * That layer is this invariant satisfied with room to spare, since an id
 * survives even a shape change, which reallocates the handle. So the invariant
 * is still unpaid for by anything shipped, and the consumers now named for it
 * are M4.7b's per-edge state and M4.8b's pick pass. Slot indices are not durable across
 * ANY removal, and
 * {@link InstanceBuffer.slotOf} is a question with an answer that expires: read
 * it, use it, do not store it.
 *
 * `test/instance-buffer.test.ts` asserts both halves. Every surviving handle
 * still resolves after a removal, and a slot index captured before one is shown
 * to point at a DIFFERENT handle afterwards, which is the failure written down
 * as a passing test rather than as a warning.
 *
 * ## Handles are never reused
 *
 * A handle is an integer from a counter that only goes up, so a handle that has
 * been freed resolves to nothing, forever, and {@link InstanceBuffer.slotOf}
 * raises {@link UnknownInstanceHandleError} naming it. The alternative is a
 * free list of handles, which saves an entry in a `Map` and costs the one
 * property that makes the invariant above enforceable: a recycled handle would
 * silently address whichever instance took its place, and stale spring state
 * would attach to a node that never had it. Handles start at 1, so 0 is a
 * sentinel a caller can compare against without a wrapper type. At one
 * allocation per node per frame at 60fps, the counter reaches
 * `Number.MAX_SAFE_INTEGER` in about 47,000 years.
 */

/** What one {@link InstanceBuffer.allocate} did. */
export interface InstanceAllocation {
  /** The new instance's durable identity. Never reused, never 0. */
  readonly handle: number;
  /** Where it sits NOW. See the invariant: this expires at the next removal. */
  readonly slot: number;
  /** The buffer's capacity after the call, in instances. */
  readonly capacity: number;
  /**
   * Whether the capacity above is bigger than it was, so a caller holding
   * arrays sized to the old one knows to reallocate them.
   */
  readonly grew: boolean;
}

/** What one {@link InstanceBuffer.free} did, in the terms a data mover needs. */
export interface InstanceRemoval {
  /** The slot the freed instance occupied. */
  readonly slot: number;
  /**
   * The handle that was moved INTO {@link slot}, or `null` when the freed
   * instance was already the last one and nothing had to move.
   */
  readonly movedHandle: number | null;
  /**
   * Where {@link movedHandle} came from, which is always the last live slot
   * before the call. `null` exactly when {@link movedHandle} is.
   */
  readonly movedFrom: number | null;
  /** How many instances are live after the call. */
  readonly count: number;
  /** The buffer's capacity after the call. See {@link InstanceBuffer.free}. */
  readonly capacity: number;
  /** Whether the capacity above is smaller than it was. */
  readonly shrank: boolean;
}

/** What one {@link InstanceBuffer.compact} did. */
export interface InstanceCompaction {
  readonly capacity: number;
  readonly shrank: boolean;
}

/**
 * The capacity a buffer starts at and never shrinks below, when the caller does
 * not say.
 *
 * Sixteen, which is a scene of a few shapes with no reallocation at all, and 768
 * bytes of `Float32Array` at M4.3's twelve floats per instance if it is never
 * filled. A caller that knows its size says so: the campaign demo passes its node
 * count, so the buffer is allocated once and every growth path below stays
 * unexercised in the case that matters most.
 */
export const DEFAULT_INSTANCE_CAPACITY = 16;

/**
 * The capacity multiplier when a buffer fills, and the fraction it has to fall
 * to before it gives space back.
 *
 * Doubling on growth is the standard amortised-O(1) policy and it matters more
 * here than in a plain dynamic array, because a growth on the GPU side is a
 * geometry rebuild and a full re-upload rather than a `memcpy`: doubling keeps
 * that at O(log n) times for n additions however they arrive.
 *
 * The shrink threshold is a QUARTER and the shrink is to a HALF, which is
 * hysteresis rather than fussiness. Shrinking at a half would make one
 * add-remove pair at the boundary reallocate twice per pair, forever. With this
 * gap, capacity only falls after the count has dropped well clear of the point
 * that would grow it again.
 */
export const INSTANCE_GROWTH_FACTOR = 2;
export const INSTANCE_SHRINK_THRESHOLD = 4;

/**
 * The handle-to-slot bookkeeping for one instanced draw call.
 *
 * Live slots are `[0, count)` with no holes, `capacity` is what the arrays
 * behind them have to be sized for, and every mutating method returns what
 * changed so the module holding those arrays can follow along without
 * recomputing anything. `instance-attributes.ts` is that module, and the pair is
 * driven by `instanced-scene.ts`.
 */
export class InstanceBuffer {
  readonly #minCapacity: number;
  #capacity: number;
  #nextHandle = 1;

  /** Slot by handle. The only durable lookup, and the invariant's mechanism. */
  readonly #slotByHandle = new Map<number, number>();

  /** Handle by slot, dense and exactly `count` long: the reverse of the map. */
  readonly #handleBySlot: number[] = [];

  /**
   * @param capacity The initial capacity, in instances, and the floor every
   * later shrink respects. At least 1, because a zero-capacity buffer is a
   * buffer whose first allocation grows it, which is a reallocation nobody
   * asked for.
   */
  constructor(capacity: number = DEFAULT_INSTANCE_CAPACITY) {
    this.#minCapacity = requireIntegerAtLeast(capacity, 1, 'capacity');
    this.#capacity = this.#minCapacity;
  }

  /** How many instances are live. Also the exclusive end of the slot range. */
  get count(): number {
    return this.#handleBySlot.length;
  }

  /** How many instances the arrays behind this buffer have to hold. */
  get capacity(): number {
    return this.#capacity;
  }

  /**
   * Takes the next free slot, growing the buffer if there is none.
   *
   * The new instance lands at the END of the live range, which is what makes an
   * addition free of any effect on any other instance: no existing handle
   * changes slot, so no per-instance state anywhere has to move.
   */
  allocate(): InstanceAllocation {
    const slot = this.#handleBySlot.length;
    let grew = false;
    if (slot >= this.#capacity) {
      this.#capacity *= INSTANCE_GROWTH_FACTOR;
      grew = true;
    }
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.#handleBySlot.push(handle);
    this.#slotByHandle.set(handle, slot);
    return { handle, slot, capacity: this.#capacity, grew };
  }

  /**
   * Releases a handle's slot by moving the last live instance into it.
   *
   * The returned record is an instruction rather than a report: copy the
   * instance data at `movedFrom` to `slot`, and the arrays match the
   * bookkeeping again. When `movedHandle` is `null` the freed instance was
   * already last and there is nothing to copy, which is worth distinguishing
   * because a self-copy of the same slot is a silent no-op that hides an
   * off-by-one.
   *
   * **Shrinking happens here rather than in {@link compact}, and both exist.**
   * A caller that prunes a large graph and never asks would otherwise hold a
   * buffer sized for the graph it used to have, which is memory nobody is
   * looking at; the hysteresis in {@link INSTANCE_SHRINK_THRESHOLD} is what
   * keeps that automatic without making a caller who hovers at the boundary pay
   * for it. {@link compact} is the other case: a caller who knows it is done
   * adding and wants the buffer at exactly its size.
   */
  free(handle: number): InstanceRemoval {
    const slot = this.slotOf(handle);
    const last = this.#handleBySlot.length - 1;
    const movedHandle = slot === last ? null : (this.#handleBySlot[last] as number);

    this.#slotByHandle.delete(handle);
    this.#handleBySlot.pop();
    if (movedHandle !== null) {
      this.#handleBySlot[slot] = movedHandle;
      this.#slotByHandle.set(movedHandle, slot);
    }

    const count = this.#handleBySlot.length;
    // FLOORED, and the floor is not decoration. Capacity is a run of doublings
    // from the constructed floor everywhere except after {@link compact}, which
    // sets it to the live count and can leave it odd. An unfloored halving then
    // produces a FRACTIONAL capacity, which passes every comparison a capacity
    // has to pass and which `new Float32Array(n * components)` truncates PER
    // CHANNEL, so a 1-component channel comes out a slot shorter than a
    // 2-component one and the writes falling off the short one are discarded in
    // silence. Reported by two reviewers with a repro each.
    const shrunkTo = Math.floor(this.#capacity / INSTANCE_GROWTH_FACTOR);
    const shrank =
      count * INSTANCE_SHRINK_THRESHOLD <= this.#capacity &&
      shrunkTo >= this.#minCapacity &&
      // So `shrank` means the number CHANGED, rather than meaning a shrink was
      // permitted. A caller acts on this flag by reallocating and rebuilding a
      // geometry, which is not work to do for a capacity that stayed put.
      shrunkTo < this.#capacity;
    if (shrank) this.#capacity = shrunkTo;

    return {
      slot,
      movedHandle,
      movedFrom: movedHandle === null ? null : last,
      count,
      capacity: this.#capacity,
      shrank,
    };
  }

  /**
   * Where a live handle sits now.
   *
   * **The answer expires at the next {@link free}.** See the invariant in the
   * module docstring: this is the one function that turns a durable identity
   * into a volatile index, so it is the one place a caller can decide to store
   * the wrong one of the two.
   *
   * Throws {@link UnknownInstanceHandleError} for a handle that was freed or
   * never issued, rather than returning -1. A sentinel index that is silently
   * accepted by array arithmetic is how a stale handle ends up writing over
   * another instance's data, which is precisely the failure mode this whole
   * module is arranged around.
   */
  slotOf(handle: number): number {
    const slot = this.#slotByHandle.get(handle);
    if (slot === undefined) throw new UnknownInstanceHandleError(handle);
    return slot;
  }

  /** Whether a handle is live, for a caller who would rather branch than catch. */
  hasHandle(handle: number): boolean {
    return this.#slotByHandle.has(handle);
  }

  /**
   * Which handle occupies a slot, which is the direction a picking pass reads:
   * the GPU knows an instance index and the caller wants the identity.
   */
  handleAt(slot: number): number {
    const handle = this.#handleBySlot[slot];
    if (handle === undefined) {
      throw new RangeError(
        `slot has to be an integer in [0, ${String(this.count)}), got ${String(slot)}`,
      );
    }
    return handle;
  }

  /**
   * Every live handle, in slot order. A copy, so a caller iterating it while
   * freeing handles is iterating a stable list rather than one the removals are
   * reordering underneath them, which swap-with-last does to every element
   * after the one removed.
   */
  handles(): readonly number[] {
    return [...this.#handleBySlot];
  }

  /**
   * Gives back every slot the live count does not need, down to the floor the
   * constructor set.
   *
   * Nothing moves: slots are already dense, so compaction here is only the
   * capacity number and the reallocation a caller does in response to it. That
   * is the whole benefit of swap-with-last over hole-and-compact, made visible
   * as the body of a method that would otherwise be a loop.
   */
  compact(): InstanceCompaction {
    const capacity = Math.max(this.#minCapacity, this.count);
    const shrank = capacity < this.#capacity;
    this.#capacity = capacity;
    return { capacity, shrank };
  }

  /**
   * Frees every handle at once, and leaves the capacity alone.
   *
   * Capacity survives because the reason to clear a buffer is usually to fill it
   * again with a different graph of a similar size, and dropping to the floor
   * would make that a run of growths. {@link compact} is one call away for a
   * caller who means the other thing.
   */
  clear(): void {
    this.#slotByHandle.clear();
    this.#handleBySlot.length = 0;
  }
}
