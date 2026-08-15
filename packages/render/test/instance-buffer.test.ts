import { describe, expect, it } from 'vitest';
import { UnknownInstanceHandleError } from '../src/errors.js';
import {
  DEFAULT_INSTANCE_CAPACITY,
  INSTANCE_GROWTH_FACTOR,
  INSTANCE_SHRINK_THRESHOLD,
  InstanceBuffer,
} from '../src/instance-buffer.js';

/**
 * The bookkeeping, exhaustively, because this is the part most likely to be
 * subtly wrong and the part that needs no device to prove right.
 *
 * Nothing here touches three, a canvas or a typed array. Every claim the module
 * makes is a claim about integers and a map, so every claim is decided here
 * rather than inferred from a picture. The invariant section at the end is the
 * reason the file exists: swap-with-last corrupts slot-keyed data silently, and
 * a test that pins "a slot index captured before a removal now belongs to a
 * different handle" is that failure written down as a passing test.
 */

/** Allocates `n` instances and hands back their handles in allocation order. */
function fill(buffer: InstanceBuffer, n: number): number[] {
  return Array.from({ length: n }, () => buffer.allocate().handle);
}

describe('allocation', () => {
  it('starts empty at the capacity it was given', () => {
    const buffer = new InstanceBuffer(8);
    expect(buffer.count).toBe(0);
    expect(buffer.capacity).toBe(8);
    expect(buffer.handles()).toEqual([]);
  });

  it('defaults to a capacity a small scene never grows out of', () => {
    expect(new InstanceBuffer().capacity).toBe(DEFAULT_INSTANCE_CAPACITY);
  });

  it('hands out consecutive slots from zero, so live slots have no holes', () => {
    const buffer = new InstanceBuffer(4);
    const slots = [0, 1, 2].map(() => buffer.allocate().slot);
    expect(slots).toEqual([0, 1, 2]);
    expect(buffer.count).toBe(3);
  });

  it('never issues the same handle twice, including after removals', () => {
    const buffer = new InstanceBuffer(4);
    const first = fill(buffer, 4);
    for (const handle of first) buffer.free(handle);
    const second = fill(buffer, 4);
    expect(new Set([...first, ...second]).size).toBe(8);
  });

  it('never issues 0, so a caller can use it as a sentinel', () => {
    const buffer = new InstanceBuffer(4);
    expect(fill(buffer, 4)).not.toContain(0);
  });

  it('rejects a capacity below one, naming the field', () => {
    expect(() => new InstanceBuffer(0)).toThrow(RangeError);
    expect(() => new InstanceBuffer(0)).toThrow(/capacity/);
    expect(() => new InstanceBuffer(Number.NaN)).toThrow(RangeError);
  });
});

describe('growth', () => {
  it('grows only when the buffer is full, and reports it', () => {
    const buffer = new InstanceBuffer(2);
    expect(buffer.allocate().grew).toBe(false);
    expect(buffer.allocate().grew).toBe(false);
    const third = buffer.allocate();
    expect(third.grew).toBe(true);
    expect(third.capacity).toBe(2 * INSTANCE_GROWTH_FACTOR);
    expect(third.slot).toBe(2);
  });

  it('doubles rather than adding, so n additions cost log n reallocations', () => {
    // The reason the factor matters more here than in a plain dynamic array: a
    // growth on the GPU side is a geometry rebuild and a full re-upload, not a
    // memcpy. One-at-a-time growth would make a 3,000 node scene 3,000 uploads.
    const buffer = new InstanceBuffer(1);
    let growths = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (buffer.allocate().grew) growths += 1;
    }
    expect(buffer.capacity).toBeGreaterThanOrEqual(1000);
    expect(growths).toBe(10);
  });

  it('never grows for a caller that allocated up front', () => {
    const buffer = new InstanceBuffer(3010);
    for (let i = 0; i < 3010; i += 1) expect(buffer.allocate().grew).toBe(false);
    expect(buffer.capacity).toBe(3010);
  });
});

describe('removal', () => {
  it('moves the last instance into the freed slot, and says which', () => {
    const buffer = new InstanceBuffer(8);
    const [a, b, c, d] = fill(buffer, 4) as [number, number, number, number];
    const removal = buffer.free(b);
    expect(removal.slot).toBe(1);
    expect(removal.movedHandle).toBe(d);
    expect(removal.movedFrom).toBe(3);
    expect(removal.count).toBe(3);
    expect(buffer.handles()).toEqual([a, d, c]);
  });

  it('reports nothing moved when the freed instance was already last', () => {
    // Distinguished rather than reported as a copy of a slot onto itself, which
    // is a silent no-op that would hide an off-by-one in the caller's branch.
    const buffer = new InstanceBuffer(8);
    const handles = fill(buffer, 3);
    const removal = buffer.free(handles[2] as number);
    expect(removal.movedHandle).toBeNull();
    expect(removal.movedFrom).toBeNull();
    expect(removal.slot).toBe(2);
  });

  it('reuses the freed slot for the next allocation', () => {
    const buffer = new InstanceBuffer(8);
    const handles = fill(buffer, 3);
    buffer.free(handles[0] as number);
    expect(buffer.allocate().slot).toBe(2);
    expect(buffer.count).toBe(3);
  });

  it('empties completely, whatever order the handles are freed in', () => {
    for (const order of [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [1, 3, 0, 2],
    ]) {
      const buffer = new InstanceBuffer(8);
      const handles = fill(buffer, 4);
      for (const index of order) buffer.free(handles[index] as number);
      expect(buffer.count).toBe(0);
      expect(buffer.handles()).toEqual([]);
    }
  });

  it('refuses a handle it does not hold, twice over', () => {
    const buffer = new InstanceBuffer(8);
    const handle = buffer.allocate().handle;
    buffer.free(handle);
    expect(() => buffer.free(handle)).toThrow(UnknownInstanceHandleError);
    expect(() => buffer.free(9999)).toThrow(UnknownInstanceHandleError);
    expect(() => buffer.free(handle)).toThrow(new RegExp(String(handle)));
  });
});

describe('compaction', () => {
  it('shrinks on its own once the count falls well clear of the capacity', () => {
    const buffer = new InstanceBuffer(1);
    const handles = fill(buffer, 16);
    expect(buffer.capacity).toBe(16);
    // Down to a quarter, which is the threshold, so this is the first removal
    // that gives anything back.
    for (let i = 15; i > 3; i -= 1) buffer.free(handles[i] as number);
    expect(buffer.count).toBe(4);
    expect(buffer.capacity).toBe(16 / INSTANCE_GROWTH_FACTOR);
  });

  it('leaves a gap between growing and shrinking, so a boundary cannot thrash', () => {
    // Grow at full, shrink at a quarter. Without the gap, one add-remove pair at
    // the boundary would reallocate twice per pair, forever.
    const buffer = new InstanceBuffer(4);
    const handles = fill(buffer, 5);
    expect(buffer.capacity).toBe(8);
    const removal = buffer.free(handles[4] as number);
    expect(removal.shrank).toBe(false);
    expect(buffer.capacity).toBe(8);
    expect(INSTANCE_SHRINK_THRESHOLD).toBeGreaterThan(INSTANCE_GROWTH_FACTOR);
  });

  it('never shrinks below the capacity it was constructed with', () => {
    const buffer = new InstanceBuffer(8);
    const handles = fill(buffer, 8);
    for (const handle of handles) buffer.free(handle);
    expect(buffer.count).toBe(0);
    expect(buffer.capacity).toBe(8);
  });

  it('gives back everything the live count does not need, on request', () => {
    const buffer = new InstanceBuffer(2);
    const handles = fill(buffer, 9);
    expect(buffer.capacity).toBe(16);
    for (let i = 8; i > 4; i -= 1) buffer.free(handles[i] as number);
    const compaction = buffer.compact();
    expect(compaction.shrank).toBe(true);
    expect(compaction.capacity).toBe(5);
    expect(buffer.capacity).toBe(5);
  });

  it('reports no shrink when there is nothing to give back', () => {
    const buffer = new InstanceBuffer(4);
    fill(buffer, 4);
    expect(buffer.compact()).toEqual({ capacity: 4, shrank: false });
  });

  it('moves nothing when it compacts, because slots are already dense', () => {
    // The whole benefit of swap-with-last over hole-and-compact, as an
    // assertion: compaction is a capacity number, not a pass over the data.
    const buffer = new InstanceBuffer(2);
    const handles = fill(buffer, 8);
    const before = handles.map((handle) => buffer.slotOf(handle));
    buffer.compact();
    expect(handles.map((handle) => buffer.slotOf(handle))).toEqual(before);
  });

  it('keeps the capacity an INTEGER after a compaction leaves it odd', () => {
    // The gap two reviewers found, with the repro they gave. Capacity is a run
    // of doublings from the floor everywhere except after `compact`, which sets
    // it to the live count; an unfloored halving of an odd capacity then gives
    // 2.5, which passes every comparison a capacity has to pass and which
    // `new Float32Array(n * components)` truncates PER CHANNEL, so a 1-component
    // channel comes out a slot short of a 2-component one and the writes falling
    // off it are discarded with nothing thrown. Nothing in this file used to
    // free or allocate AFTER a compaction, which is why a green suite hid it.
    const buffer = new InstanceBuffer(2);
    const handles = fill(buffer, 5);
    expect(buffer.capacity).toBe(8);
    expect(buffer.compact().capacity).toBe(5);
    for (let i = 4; i > 0; i -= 1) {
      buffer.free(handles[i] as number);
      expect(Number.isInteger(buffer.capacity)).toBe(true);
      expect(buffer.capacity).toBeGreaterThanOrEqual(buffer.count);
      expect(buffer.capacity).toBeGreaterThanOrEqual(2);
    }
  });

  it('reports a shrink only when the number actually changed', () => {
    // A caller acts on this flag by reallocating arrays and rebuilding a
    // geometry, so a `shrank` that means "a shrink was permitted" rather than "a
    // shrink happened" is a full re-upload for nothing.
    const buffer = new InstanceBuffer(1);
    const handle = buffer.allocate().handle;
    const removal = buffer.free(handle);
    expect(removal.shrank).toBe(false);
    expect(buffer.capacity).toBe(1);
  });

  it('keeps its capacity when cleared, so refilling costs no reallocation', () => {
    const buffer = new InstanceBuffer(2);
    fill(buffer, 64);
    const capacity = buffer.capacity;
    buffer.clear();
    expect(buffer.count).toBe(0);
    expect(buffer.capacity).toBe(capacity);
    for (let i = 0; i < 64; i += 1) expect(buffer.allocate().grew).toBe(false);
  });

  it('forgets every handle it cleared', () => {
    const buffer = new InstanceBuffer(4);
    const handles = fill(buffer, 4);
    buffer.clear();
    for (const handle of handles) expect(buffer.hasHandle(handle)).toBe(false);
    expect(() => buffer.slotOf(handles[0] as number)).toThrow(UnknownInstanceHandleError);
  });
});

describe('the invariant: state is keyed by handle, never by slot', () => {
  it('resolves every surviving handle after a removal', () => {
    const buffer = new InstanceBuffer(16);
    const handles = fill(buffer, 10);
    buffer.free(handles[3] as number);
    buffer.free(handles[0] as number);
    const survivors = handles.filter((_, index) => index !== 3 && index !== 0);
    for (const handle of survivors) {
      expect(buffer.hasHandle(handle)).toBe(true);
      const slot = buffer.slotOf(handle);
      expect(buffer.handleAt(slot)).toBe(handle);
    }
    expect(new Set(survivors.map((handle) => buffer.slotOf(handle))).size).toBe(8);
  });

  it('makes a slot captured before a removal belong to a DIFFERENT handle after it', () => {
    // The failure this module is arranged around, as a passing test, in the
    // shape it actually takes. Freeing `b` moves `d` into `b`'s slot, so `d`'s
    // old slot is vacated; the next allocation takes it. A caller that cached
    // `slotOf(d)` and wrote through it afterwards would be writing `d`'s data
    // over `e`, with nothing thrown anywhere, because the slot is still a
    // perfectly valid index into a buffer of the right size.
    const buffer = new InstanceBuffer(8);
    const [, b, , d] = fill(buffer, 4) as [number, number, number, number];
    const staleSlot = buffer.slotOf(d);
    buffer.free(b);
    expect(buffer.slotOf(d)).not.toBe(staleSlot);

    const e = buffer.allocate().handle;
    expect(buffer.slotOf(e)).toBe(staleSlot);
    expect(buffer.handleAt(staleSlot)).toBe(e);
  });

  it('holds through a long run of interleaved allocations and removals', () => {
    // A model check rather than a scenario: the map and the dense array are two
    // representations of the same fact, and this asserts they never disagree.
    const buffer = new InstanceBuffer(2);
    const live: number[] = [];
    for (let step = 0; step < 500; step += 1) {
      // Deterministic and uneven: two additions for every removal, so the buffer
      // grows through several capacities while removals hit every position.
      if (step % 3 === 2 && live.length > 0) {
        const index = step % live.length;
        buffer.free(live[index] as number);
        live.splice(index, 1);
      } else {
        live.push(buffer.allocate().handle);
      }
      // Folded in rather than tested apart, because a compaction is what takes
      // the capacity off the doubling chain and every later halving has to stay
      // integral from wherever it lands.
      if (step % 37 === 0) buffer.compact();
      expect(buffer.count).toBe(live.length);
      expect(buffer.capacity).toBeGreaterThanOrEqual(live.length);
      expect(Number.isInteger(buffer.capacity)).toBe(true);
      const seen = new Set<number>();
      for (const handle of live) {
        const slot = buffer.slotOf(handle);
        expect(buffer.handleAt(slot)).toBe(handle);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(live.length);
        seen.add(slot);
      }
      expect(seen.size).toBe(live.length);
    }
  });

  it('refuses a slot outside the live range rather than returning nothing', () => {
    const buffer = new InstanceBuffer(8);
    fill(buffer, 3);
    expect(() => buffer.handleAt(3)).toThrow(RangeError);
    expect(() => buffer.handleAt(-1)).toThrow(RangeError);
    expect(() => buffer.handleAt(3)).toThrow(/\[0, 3\)/);
  });

  it('hands back a copy of the handle list, not the list it iterates', () => {
    // A caller freeing while iterating is iterating a stable list rather than one
    // the removals are reordering underneath them, which swap-with-last does to
    // every element after the one removed.
    const buffer = new InstanceBuffer(8);
    const handles = fill(buffer, 4);
    const snapshot = buffer.handles();
    buffer.free(handles[0] as number);
    expect(snapshot).toEqual(handles);
  });
});
