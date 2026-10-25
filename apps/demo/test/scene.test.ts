import { describe, expect, it } from 'vitest';
import { normalizeShape, roundedRectDistance, shapeQuadSize } from '@dagr/render';
import { OVERVIEW_ZOOM } from '../src/camera-input.js';
import { DETAIL_CENTER, HERO, OVERVIEW_CENTER, SCENE_SHAPES } from '../src/scene.js';

/**
 * The scene, checked with the renderer's OWN arithmetic.
 *
 * `scene.ts` is plain data, so unlike the component that draws it, every claim
 * it makes is reachable from a node test. The claims worth making are the ones
 * a wrong number would break silently: a shape `setShapes` would reject leaves
 * the previous batch on screen, which for the first batch is an empty canvas;
 * a detail camera aimed a few world units off the hero's corner shows a flat
 * field of fill colour that looks exactly like a renderer drawing nothing.
 *
 * Every check below runs `@dagr/render`'s exported functions rather than a
 * local copy of them. `normalizeShape` is the same validator `setShapes` runs,
 * `roundedRectDistance` is the same field the shader transcribes, and
 * `shapeQuadSize` is the same padding the geometry is built from. A local
 * reimplementation would agree with itself and with nothing else.
 */

/**
 * The shortest a pane ever gets, in CSS pixels.
 *
 * `styles.css` sizes a pane `clamp(480px, 52vh, 620px)` tall, and no module
 * can read a stylesheet, so this is a copy. Only the HEIGHT is copied because
 * only the height has a floor: panes stack and go full width on a narrow
 * screen, so a claim about their width would be a claim about the reader's
 * window. A taller pane only makes the claims below truer.
 */
const SHORTEST_PANE = 480;

describe('the scene both panes draw', () => {
  it('is a batch the renderer accepts, shape by shape', () => {
    // `setShapes` validates the whole batch before it touches the scene, so one
    // bad shape here is not one missing shape, it is a `RangeError` and an
    // empty canvas. Running its own validator is the only way to know from a
    // node test.
    for (const shape of SCENE_SHAPES) {
      expect(() => normalizeShape(shape)).not.toThrow();
    }
  });

  it('contains the hero, so the two panes really are one scene', () => {
    // The whole comparison rests on this: both panes are handed SCENE_SHAPES
    // and differ only in their camera. A hero that had drifted out of the batch
    // would leave the detail pane pointed at nothing.
    expect(SCENE_SHAPES).toContain(HERO);
  });

  it('draws both distance fields M4.2 shipped', () => {
    expect(new Set(SCENE_SHAPES.map((shape) => shape.kind))).toEqual(
      new Set(['rounded-rect', 'circle']),
    );
  });

  it('puts fill, outline and glow on one shape at once', () => {
    // M4.2's claim is that ONE distance field carries all three, so a scene
    // that spread them over three shapes would illustrate nothing.
    const { style } = normalizeShape(HERO);
    expect(style.fillOpacity).toBeGreaterThan(0);
    expect(style.outlineWidth).toBeGreaterThan(0);
    expect(style.glowRadius).toBeGreaterThan(0);
  });

  it('fits the overview pane vertically at OVERVIEW_ZOOM, glow included', () => {
    // Measured from the quads rather than from the shapes, because the glow and
    // the antialiasing pad are painted outside the shape and a scene that fit
    // by its fills alone would still have a halo clipped by the top edge.
    let top = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    for (const shape of SCENE_SHAPES) {
      const painted = normalizeShape(shape);
      const quad = shapeQuadSize(
        painted.size,
        painted.style.outlineWidth,
        painted.style.glowRadius,
      );
      top = Math.max(top, painted.center.y + quad.height / 2);
      bottom = Math.min(bottom, painted.center.y - quad.height / 2);
    }
    // Twice the further reach from the camera's centre, since the camera does
    // not recentre itself on the scene: what has to fit is the symmetric window
    // the centre actually gives.
    const needed = 2 * Math.max(top - OVERVIEW_CENTER.y, OVERVIEW_CENTER.y - bottom);
    expect(needed * OVERVIEW_ZOOM).toBeLessThanOrEqual(SHORTEST_PANE);
  });
});

describe('the detail pane camera', () => {
  it("sits exactly on the hero boundary, by the renderer's own field", () => {
    const hero = normalizeShape(HERO);
    const distance = roundedRectDistance(
      DETAIL_CENTER.x,
      DETAIL_CENTER.y,
      hero.size.width / 2,
      hero.size.height / 2,
      hero.cornerRadius,
    );
    // Zero is the boundary, by the sign convention `sdf.ts` states. Off by a
    // world unit at 100x is 100 CSS pixels of miss, which at this zoom is the
    // difference between an edge in the middle of the pane and a pane of flat
    // colour.
    expect(Math.abs(distance)).toBeLessThan(1e-9);
  });

  it('sits on a corner ARC, not on a straight edge', () => {
    // The straight edges of a rounded rect prove nothing a screenshot of any
    // rectangle would not: the claim under test is that the ARC stays a clean
    // curve at 100x, so the camera has to be past where the arc begins on both
    // axes.
    const hero = normalizeShape(HERO);
    expect(DETAIL_CENTER.x).toBeGreaterThan(hero.size.width / 2 - hero.cornerRadius);
    expect(DETAIL_CENTER.y).toBeGreaterThan(hero.size.height / 2 - hero.cornerRadius);
  });
});
