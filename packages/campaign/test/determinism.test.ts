import { describe, expect, it } from 'vitest';
import { generateCampaign } from '../src/index.js';

/**
 * Determinism is the feature the whole package hangs on: screenshots, future
 * benchmarks, and the demo's stats all assume the default campaign is the
 * SAME campaign every time, on every engine. So it is asserted as deep
 * equality over the full structure, not spot checks.
 */
describe('generateCampaign determinism', () => {
  it('produces an identical campaign for the same seed', () => {
    const a = generateCampaign({ seed: 7 });
    const b = generateCampaign({ seed: 7 });
    expect(b).toEqual(a);
  });

  it('produces a different campaign for a different seed', () => {
    const a = generateCampaign({ seed: 7 });
    const b = generateCampaign({ seed: 8 });
    expect(JSON.stringify(b.nodes)).not.toEqual(JSON.stringify(a.nodes));
  });

  it('records the seed it ran with, defaulting it', () => {
    expect(generateCampaign().seed).toBe(20260814);
    expect(generateCampaign({ seed: 3 }).seed).toBe(3);
  });

  it('rejects a scale that cannot size anything', () => {
    expect(() => generateCampaign({ scale: 0 })).toThrow(RangeError);
    expect(() => generateCampaign({ scale: -1 })).toThrow(RangeError);
    expect(() => generateCampaign({ scale: Number.NaN })).toThrow(RangeError);
  });

  it('moves the total with scale without leaving the plan band', () => {
    const small = generateCampaign({ scale: 0.5 });
    const large = generateCampaign({ scale: 2 });
    expect(small.nodes.length).toBeGreaterThanOrEqual(2000);
    expect(large.nodes.length).toBeLessThanOrEqual(5000);
    expect(large.nodes.length).toBeGreaterThan(small.nodes.length);
  });
});
