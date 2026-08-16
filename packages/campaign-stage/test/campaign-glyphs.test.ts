import { describe, expect, it } from 'vitest';
import { generateCampaign } from '@dagr/campaign';
import type { NodeKind } from '@dagr/campaign';
import {
  GLYPH_STROKE_WIDTH,
  GLYPH_VIEWBOX,
  KIND_GLYPHS,
  LOCATION_GLYPHS,
  nodeGlyph,
} from '../src/campaign-glyphs.js';

/**
 * The kind marks.
 *
 * What a test can say about a drawing is narrow, and it is worth being explicit
 * about the line: nothing here checks that the clue's mark looks like a lens.
 * That is the eye's job and the screenshots' job. What a test CAN hold is that
 * every kind has a mark, that no two kinds share one, that each is a path a
 * browser will draw, and that its coordinates are inside the box it declares,
 * because each of those failures is silent. An `svg` given a `d` the parser
 * rejects renders NOTHING and reports nothing, which is the same silent drop
 * `campaign-style.ts` round trips its colours against.
 */

const KINDS: readonly NodeKind[] = [
  'campaign',
  'arc',
  'chapter',
  'scene',
  'encounter',
  'location',
  'npc',
  'faction',
  'quest',
  'quest_step',
  'clue',
  'item',
  'front',
  'clock_tick',
  'statblock',
  'condition_modifier',
];

const SUBTYPES = ['region', 'settlement', 'building', 'room'] as const;

/** Every path in the module, kinds and location subtypes together. */
const ALL: readonly (readonly [string, string])[] = [
  ...Object.entries(KIND_GLYPHS),
  ...Object.entries(LOCATION_GLYPHS).map(([key, path]) => [`location/${key}`, path] as const),
];

describe('the mark table', () => {
  it('covers every kind and every location subtype', () => {
    for (const kind of KINDS) expect(KIND_GLYPHS[kind], kind).toBeTruthy();
    expect(Object.keys(KIND_GLYPHS)).toHaveLength(KINDS.length);
    for (const subtype of SUBTYPES) expect(LOCATION_GLYPHS[subtype], subtype).toBeTruthy();
    // Twenty marks: sixteen kinds, and location's four subtypes beside the
    // fallback the kind table holds.
    expect(ALL).toHaveLength(KINDS.length + SUBTYPES.length);
  });

  it('gives no two of them the same path', () => {
    // The failure this catches is a copy-paste: two kinds drawn identically
    // read as one kind, and the picture says the dataset has fifteen kinds in
    // it. Nothing else would notice.
    const byPath = new Map<string, string>();
    for (const [what, path] of ALL) {
      const seen = byPath.get(path);
      expect(seen, `${what} draws the same path as ${String(seen)}`).toBeUndefined();
      byPath.set(path, what);
    }
  });

  it('writes each one as a path a parser will take', () => {
    // Absolute move first, then only the commands and numbers SVG's path
    // grammar allows. A `d` the parser rejects draws nothing at all and reports
    // nothing anywhere, so this is the only place that failure can be caught.
    for (const [what, path] of ALL) {
      expect(path.startsWith('M'), `${what} does not open with an absolute move`).toBe(true);
      expect(path, what).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
    }
  });

  it('keeps every coordinate inside the box it declares', () => {
    // A bound rather than a drawing: the viewBox is 16 units square, so a
    // number an order of magnitude out is a mark drawn off screen, which on a
    // 12 pixel badge is an empty space nobody can tell from a missing icon.
    // Radii and arc flags are in this sweep too, and both are inside the same
    // range, so this is deliberately a smoke test and not a claim about shape.
    const [, , boxWidth, boxHeight] = GLYPH_VIEWBOX.split(' ').map(Number);
    expect(boxWidth).toBe(16);
    expect(boxHeight).toBe(16);
    for (const [what, path] of ALL) {
      for (const raw of path.match(/-?\d*\.?\d+/g) ?? []) {
        const value = Number(raw);
        expect(Math.abs(value), `${what} has ${raw} outside its 16 unit box`).toBeLessThanOrEqual(
          16.5,
        );
      }
    }
  });

  it('states a stroke width the marks are drawn at', () => {
    expect(GLYPH_STROKE_WIDTH).toBeGreaterThan(0);
    expect(GLYPH_STROKE_WIDTH).toBeLessThan(4);
  });
});

describe('nodeGlyph', () => {
  const campaign = generateCampaign();

  it('answers for every node in a whole campaign', () => {
    for (const node of campaign.nodes) {
      expect(nodeGlyph(node), `${node.id} has no mark`).toBeTruthy();
    }
  });

  it('reads a location by its subtype rather than by its kind', () => {
    // The same trap `nodeColor` records: `location` is one kind and four
    // things, and a lookup on the kind alone would draw a region's ridge line
    // on all 1,023 rooms while the palette drew them in the room's own blue.
    const seen = new Map<string, string>();
    for (const node of campaign.nodes) {
      if (node.data.kind !== 'location') continue;
      seen.set(node.data.subtype, nodeGlyph(node));
    }
    expect([...seen.keys()].sort()).toEqual([...SUBTYPES].sort());
    for (const subtype of SUBTYPES) {
      expect(seen.get(subtype), subtype).toBe(LOCATION_GLYPHS[subtype]);
    }
    expect(new Set(seen.values()).size).toBe(SUBTYPES.length);
  });

  it('falls back to the kind mark for a subtype it does not know', () => {
    const [location] = campaign.nodes.filter((node) => node.data.kind === 'location');
    if (location === undefined || location.data.kind !== 'location') {
      throw new Error('expected a location');
    }
    const strange = { ...location, data: { ...location.data, subtype: 'moonbase' } };
    expect(nodeGlyph(strange as typeof location)).toBe(KIND_GLYPHS.location);
  });
});
