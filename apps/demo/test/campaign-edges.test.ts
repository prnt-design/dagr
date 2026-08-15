import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOW,
  EDGE_GROUPS,
  borderPoint,
  bowedLine,
  campaignEdges,
  overlayFade,
} from '../src/campaign-edges.js';
import type { CampaignScene } from '../src/campaign-scene.js';

/**
 * The three ways an edge is drawn, and the geometry for the two a layout never
 * saw.
 *
 * What this file is really pinning is a division of labour: a routed edge's
 * points come from the LAYOUT and this module must not invent any, while a
 * cross-tile or overlay line has no layout opinion at all and is drawn here.
 * The failure a test can catch is the first half going wrong quietly, since a
 * re-derived straight line between two boxes looks perfectly reasonable until
 * you notice the edge no longer bends where its dummies are.
 */

/** A square box of `size` centred on `(x, y)`. */
function box(x: number, y: number, size = 20) {
  return { minX: x - size / 2, minY: y - size / 2, maxX: x + size / 2, maxY: y + size / 2 };
}

describe('borderPoint', () => {
  it('leaves through the side a horizontal line reaches first', () => {
    expect(borderPoint(box(0, 0), { x: 100, y: 0 })).toEqual({ x: 10, y: 0 });
  });

  it('leaves through the top for a vertical line, whatever the width', () => {
    const wide = { minX: -500, minY: -10, maxX: 500, maxY: 10 };
    expect(borderPoint(wide, { x: 0, y: 100 })).toEqual({ x: 0, y: 10 });
  });

  it('lands on the corner for a diagonal to a square', () => {
    expect(borderPoint(box(0, 0), { x: 100, y: 100 })).toEqual({ x: 10, y: 10 });
  });

  it('gives back the centre when there is no direction to leave in', () => {
    expect(borderPoint(box(3, 4), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it('never travels past the point it is aimed at', () => {
    // The cap at 1, which is what keeps a line between two overlapping boxes
    // from being drawn inside out rather than dropped.
    const huge = box(0, 0, 400);
    const near = { x: 30, y: 0 };
    expect(borderPoint(huge, near)).toEqual(near);
  });
});

describe('bowedLine', () => {
  const from = box(0, 0);
  const to = box(100, 0);

  it('runs border to border, not centre to centre', () => {
    // A line from a node's centre is drawn underneath the node for its first
    // half, which for a settlement with a hundred overlay edges is a hundred
    // lines nobody sees leave.
    const line = bowedLine(from, to, 0);
    expect(line[0]).toEqual({ x: 10, y: 0 });
    expect(line.at(-1)).toEqual({ x: 90, y: 0 });
  });

  it('bows the middle perpendicular to the chord, by a fraction of it', () => {
    const line = bowedLine(from, to, 0.1);
    // The chord is 80 long and runs along +x, so a tenth of it is 8 along +y.
    expect(line[1]).toEqual({ x: 50, y: 8 });
  });

  it('bows the other way for a negative bow, which is how a pair separates', () => {
    expect(bowedLine(from, to, -0.1)[1]).toEqual({ x: 50, y: -8 });
  });

  it('keeps its shape at every distance, because the bow is relative', () => {
    // The property that stops a curve flattening out across a campaign and
    // looping across a tile: the ratio of the bow to the chord is constant.
    for (const distance of [40, 400, 4000, 40_000]) {
      const line = bowedLine(from, box(distance, 0), DEFAULT_BOW);
      const start = line[0];
      const middle = line[1];
      const end = line.at(-1);
      if (start === undefined || middle === undefined || end === undefined) {
        throw new Error('unreachable');
      }
      const chord = Math.hypot(end.x - start.x, end.y - start.y);
      const height = Math.abs(middle.y - (start.y + end.y) / 2);
      expect(height / chord).toBeCloseTo(DEFAULT_BOW, 12);
    }
  });

  it('drops a chord that would run backwards rather than drawing it inside out', () => {
    // One centre inside the other box, which is the case the attachment caps
    // turn into a REVERSED chord rather than a longer one: a length test cannot
    // see that, which is what the direction test is for. Not the same as
    // overlap: two boxes can overlap at a corner and still have a sensible
    // chord, and that one is drawn.
    expect(bowedLine(box(0, 0, 400), box(30, 0, 400), DEFAULT_BOW)).toEqual([]);
  });

  it('drops a self edge, which has no direction to bow away from', () => {
    expect(bowedLine(from, from, DEFAULT_BOW)).toEqual([]);
  });
});

describe('campaignEdges', () => {
  const scene = {
    edgeRoutes: new Map([
      [
        'routed-1',
        [
          { x: 0, y: 0 },
          { x: 10, y: 30 },
          { x: 20, y: 60 },
        ],
      ],
    ]),
    nodeBounds: new Map([
      ['a', box(0, 0)],
      ['b', box(100, 0)],
      ['c', box(0, 100)],
    ]),
  } as unknown as CampaignScene;

  const campaign = {
    edges: [
      { id: 'routed-1', kind: 'next', source: 'a', target: 'b' },
      { id: 'cross-tile', kind: 'leads_to', source: 'a', target: 'b' },
      { id: 'social', kind: 'knows', source: 'a', target: 'c' },
      { id: 'dangling', kind: 'knows', source: 'a', target: 'gone' },
    ],
  } as unknown as Parameters<typeof campaignEdges>[0];

  const edges = campaignEdges(campaign, scene, () => 0xffb703);

  it('takes a routed edge\'s points from the layout, unchanged', () => {
    // The half that must not be re-derived: these are the crossings the order
    // stage chose, and a straight line between the same two boxes would look
    // entirely reasonable while throwing the layout away.
    expect(edges.routed).toHaveLength(1);
    expect(edges.routed[0]?.points).toBe(scene.edgeRoutes.get('routed-1'));
  });

  it('sorts a routed edge with no route into the cross-tile group', () => {
    // No route means the two ends fell in different tiles, because the
    // Sugiyama pipeline only ever sees one tile at a time.
    expect(edges.crossTile.map((edge) => edge.id)).toEqual(['cross-tile']);
  });

  it('sorts every overlay kind by its role rather than by its geometry', () => {
    expect(edges.overlay.map((edge) => edge.id)).toEqual(['social']);
  });

  it('drops an edge whose endpoint was never drawn', () => {
    // A line to a box that is not on screen is a line to the origin, and a
    // campaign holds edges to nodes the tiling chose not to draw.
    const all = [...edges.routed, ...edges.crossTile, ...edges.overlay];
    expect(all.map((edge) => edge.id)).not.toContain('dangling');
  });

  it('is deterministic, because the side comes from position in a fixed order', () => {
    const again = campaignEdges(campaign, scene, () => 0xffb703);
    expect(again.overlay[0]?.points).toEqual(edges.overlay[0]?.points);
    expect(again.crossTile[0]?.points).toEqual(edges.crossTile[0]?.points);
  });

  it('bows two lines between the same pair to OPPOSITE sides', () => {
    // The property the bow exists for, and the one the first version never
    // achieved: it keyed the side on `edge.id.length % 2`, and this dataset
    // mints ids as `e-<n>`, so 6,101 of 7,100 share a length and all 26 pairs
    // with more than one overlay edge got the same side. Two lines drew
    // exactly on top of each other and a reader counting relationships counted
    // one.
    const pairCampaign = {
      edges: [
        { id: 'e-1500', kind: 'knows', source: 'a', target: 'c' },
        // Back the other way, and SECOND, which is the position where the
        // naive alternation collides: reversing a chord negates its
        // perpendicular, so `a to c` at +bow and `c to a` at -bow are the same
        // curve. Third or later, the magnitude step would hide it.
        { id: 'e-2500', kind: 'hostile_to', source: 'c', target: 'a' },
        { id: 'e-3500', kind: 'ally_of', source: 'a', target: 'c' },
      ],
    } as unknown as Parameters<typeof campaignEdges>[0];
    const drawn = campaignEdges(pairCampaign, scene, () => 0xffb703).overlay;
    expect(drawn).toHaveLength(3);

    // Which side of the a-to-c line the middle control point falls, measured
    // against ONE fixed reference rather than each edge's own direction: an
    // edge authored backwards has its own chord reversed, so a side taken
    // relative to itself reads the same for two curves that are on opposite
    // sides of the pair. That is precisely the confusion the fix is about.
    const reference = { x: 0 - 0, y: 100 - 0 };
    const sideOf = (edge: { points: readonly { x: number; y: number }[] }): number => {
      const middle = edge.points[1];
      if (middle === undefined) throw new Error('unreachable');
      // The a-to-c line runs from (0,0) to (0,100), so the side is the sign of
      // the middle point's x.
      return Math.sign(reference.y * middle.x - reference.x * middle.y);
    };
    const sides = drawn.map(sideOf);
    expect(sides[0]).not.toBe(sides[1]);
    expect(sides[0]).not.toBe(0);

    // The third steps its magnitude rather than landing back on the first.
    const height = (edge: { points: readonly { x: number; y: number }[] }): number => {
      const start = edge.points[0];
      const middle = edge.points[1];
      const end = edge.points.at(-1);
      if (start === undefined || middle === undefined || end === undefined) {
        throw new Error('unreachable');
      }
      return Math.hypot(middle.x - (start.x + end.x) / 2, middle.y - (start.y + end.y) / 2);
    };
    expect(height(drawn[2]!)).toBeGreaterThan(height(drawn[0]!) * 1.5);
  });
});

describe('EDGE_GROUPS', () => {
  it('draws the routed structure under the lines that cross it', () => {
    // The order IS the layering, because every mesh is transparent with
    // depthWrite off.
    expect(EDGE_GROUPS.map((group) => group.id)).toEqual(['routed', 'crossTile', 'overlay']);
  });

  it('dashes only the group whose direction a layout computed', () => {
    // A dash flowing source to target is the arrowhead this package does not
    // draw. A cross-tile or overlay line is drawn between two boxes by
    // `campaign-edges.ts`, so its direction is a fact about the data rather
    // than about the drawing, and dashing it would be decoration.
    const dashed = EDGE_GROUPS.filter((group) => group.style.dash !== undefined);
    expect(dashed.map((group) => group.id)).toEqual(['routed']);
  });

  it('leaves the routed group a polyline and curves the two line groups', () => {
    // A routed edge bends where a layout put a dummy, and rounding those bends
    // off would be second-guessing the crossing the order stage chose.
    expect(EDGE_GROUPS.find((group) => group.id === 'routed')?.curve).toBeUndefined();
    expect(EDGE_GROUPS.find((group) => group.id === 'overlay')?.curve).toBe('smooth');
  });
});

describe('overlayFade', () => {
  it('hides the overlay kinds below the band and shows them above it', () => {
    expect(overlayFade(0.05, 1, 4)).toBe(0);
    expect(overlayFade(1, 1, 4)).toBe(0);
    expect(overlayFade(4, 1, 4)).toBe(1);
    expect(overlayFade(100, 1, 4)).toBe(1);
  });

  it('ramps rather than switching, so detail arrives instead of glitching', () => {
    expect(overlayFade(2.5, 1, 4)).toBeCloseTo(0.5, 12);
    let previous = -1;
    for (let zoom = 0.5; zoom < 6; zoom += 0.1) {
      const fade = overlayFade(zoom, 1, 4);
      expect(fade).toBeGreaterThanOrEqual(previous);
      previous = fade;
    }
  });

  it('rejects a band that is not a band', () => {
    expect(() => overlayFade(1, 4, 4)).toThrow(/overlayFade/);
    expect(() => overlayFade(1, 4, 1)).toThrow(/overlayFade/);
  });
});
