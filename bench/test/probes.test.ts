import { describe, expect, it } from 'vitest';

import {
  CHASE_WORDS,
  allocProbe,
  chaseProbe,
  chaseTable,
  nextChaseIndex,
  probeSink,
} from '../src/probes.js';

/**
 * The probes measure the machine rather than the code, so what has to be
 * checked is not their speed but the two properties that would make them
 * silently stop measuring: that each does fixed work on every call, and that
 * the chase actually misses cache rather than walking a short cycle that fits
 * inside it.
 */
describe('probe workloads', () => {
  it('leaves the same sink value on every call, so the work is fixed', () => {
    allocProbe();
    const alloc = probeSink;
    allocProbe();
    expect(probeSink).toBe(alloc);

    chaseProbe();
    const chase = probeSink;
    chaseProbe();
    expect(probeSink).toBe(chase);
  });

  it('writes a sink an optimiser cannot prove is dead', () => {
    allocProbe();
    expect(probeSink).not.toBe(0);
  });
});

/**
 * The chase's whole claim is that consecutive loads land in unrelated cache
 * lines and that the walk visits the entire table. A short cycle would fit in
 * cache and turn a memory-latency probe into an L1 probe, which is the exact
 * failure that would leave the profile comparison looking healthy while it
 * measured nothing about memory. Hull-Dobell gives a full period for any
 * power-of-two modulus with these constants, so the property is checked at a
 * size a test can walk rather than at the 16 million the harness uses.
 */
describe('the chase cycle', () => {
  it('visits every index of a small power-of-two table exactly once', () => {
    const words = 1 << 10;
    const seen = new Set<number>();
    let at = 0;
    for (let step = 0; step < words; step += 1) {
      expect(seen.has(at)).toBe(false);
      seen.add(at);
      at = nextChaseIndex(at, words - 1);
    }
    expect(seen.size).toBe(words);
    expect(at).toBe(0);
  });

  it('does not step to an adjacent index, which a prefetcher would follow', () => {
    const words = 1 << 12;
    let adjacent = 0;
    let at = 0;
    for (let step = 0; step < words; step += 1) {
      const next = nextChaseIndex(at, words - 1);
      // 16 words is a cache line either side.
      if (Math.abs(next - at) <= 16) adjacent += 1;
      at = next;
    }
    expect(adjacent).toBeLessThan(words / 32);
  });

  it('builds the table once and hands back the same one after', () => {
    // The build is lazy so that unit-test workers importing the barrel for
    // the corpus never allocate the 64 MiB. What has to hold on the bench
    // side is that the laziness cannot mean twice: a second call returning a
    // fresh table would pay the fill again and walk cold memory the baseline
    // capture never walked.
    expect(chaseTable()).toBe(chaseTable());
  });

  it('spans a working set several times the largest cache it has to defeat', () => {
    // 16 MiB is the L3 of the machine bench/baseline.json was captured on. A
    // table that merely matched it would hit on half its loads, and would read
    // as a cache probe on one machine and a memory probe on another.
    expect((CHASE_WORDS * 4) / (1024 * 1024)).toBeGreaterThanOrEqual(64);
  });
});
