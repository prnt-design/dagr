/**
 * The seeded randomness the generator runs on.
 *
 * mulberry32, chosen because it is 5 lines, passes the statistical tests a
 * dataset generator cares about (no visible lattice in pick sequences), and is
 * trivially portable: the same seed must produce the same campaign byte for
 * byte on every engine, which rules out `Math.random` outright and anything
 * with platform-dependent float paths. All state is one uint32, so the whole
 * generator's determinism is one integer's worth of surface.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new RangeError(`seed has to be an integer, got ${String(seed)}`);
    }
    this.#state = seed >>> 0;
  }

  /** The next float in [0, 1). The primitive every other method builds on. */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new RangeError('pick needs a non-empty array');
    return item;
  }

  /**
   * `count` distinct indices out of `size`, in draw order.
   *
   * Rejection-sampled rather than shuffle-and-take, because callers ask for a
   * handful out of hundreds and shuffling the hundreds would spend most of the
   * sequence on elements nobody takes. Capped at `size` so an overdrawn ask
   * returns everything rather than spinning.
   */
  distinct(count: number, size: number): number[] {
    const want = Math.min(count, size);
    const taken = new Set<number>();
    const out: number[] = [];
    while (out.length < want) {
      const i = Math.floor(this.next() * size);
      if (taken.has(i)) continue;
      taken.add(i);
      out.push(i);
    }
    return out;
  }

  /**
   * An index in [0, size), Zipf-distributed: index 0 is the goblin every
   * dungeon reuses, the tail is the vampire lord who appears once. Inverse-CDF
   * over the harmonic weights, linear scan because size stays near 130 here.
   * The harmonic total is cached per size: the generator calls this several
   * hundred times with one size, and the total is pure arithmetic on it.
   */
  static readonly #harmonicTotals = new Map<number, number>();

  zipf(size: number): number {
    let total = Rng.#harmonicTotals.get(size);
    if (total === undefined) {
      total = 0;
      for (let i = 1; i <= size; i += 1) total += 1 / i;
      Rng.#harmonicTotals.set(size, total);
    }
    let roll = this.next() * total;
    for (let i = 1; i <= size; i += 1) {
      roll -= 1 / i;
      if (roll <= 0) return i - 1;
    }
    return size - 1;
  }
}
