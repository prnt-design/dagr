import type { ShapeInstance, Vec2 } from '@dagr/render';

/**
 * What the demo draws, as plain data, and where the two cameras point at it.
 *
 * ## The requirement this file is arithmetic for
 *
 * M4.2 asks for "the same shape at 0.1x and 100x", one screenshot, so that
 * "crisp at every zoom instead of at one" is something a reader can check by
 * looking. Both panes are handed THIS batch, unchanged, and differ only in
 * their camera: same shapes, same styles, same `setShapes` call. That is what
 * makes the comparison mean anything, and it is why the scene lives in a module
 * of its own instead of inside the component.
 *
 * ## Zoom is CSS PIXELS PER WORLD UNIT, and three orders of magnitude is a lot
 *
 * Every number below was chosen against that conversion rather than picked to
 * look plausible, because at a ratio of 1000 the two panes disagree about what
 * is worth drawing more than they agree. Anything sized to read at 0.1x is off
 * the screen at 100x, and anything sized to read at 100x is sub-pixel at 0.1x.
 * There is no set of numbers that avoids this: it is what "three orders of
 * magnitude" means, and pretending otherwise would have produced a scene that
 * quietly demonstrated nothing at one end.
 *
 * So the two panes are given different jobs, and the hero is sized to do both:
 *
 * - **At 0.1x the overview pane shows the WHOLE scene.** The hero is 700 by 440
 *   world units, which is 70 by 44 CSS pixels here. That is small enough that a
 *   staircase edge would be the first thing a reader saw, and it is above the
 *   one threshold in `@dagr/render` that depends on on-screen size: the
 *   antialiasing pad `shapeQuadSize` reserves is a fraction of the shape, and
 *   `AA_QUAD_PADDING_FRACTION` covers the coverage ramp's outer half only once
 *   the larger HALF extent measures 33.3 CSS pixels. The hero's is 350 world
 *   units, so 35 pixels at this zoom. A 200-unit hero would have composed
 *   better and would have shown the artefact this pane exists to rule out.
 *
 * - **At 100x the detail pane is INSIDE the hero's top-right corner arc**, at
 *   {@link DETAIL_CENTER}. The whole shape is 70,000 CSS pixels wide there,
 *   which is not a picture; the corner arc is, and it is the picture the
 *   requirement is about. The arc's radius is 24 world units, so 2400 pixels,
 *   and across a 480 pixel pane that chord bows about 12 pixels while its
 *   tangent turns about 11 degrees: a visible curve, which a polygonal
 *   approximation could not fake at this magnification.
 *
 * **The hero's outline is the number that carries the claim.** It is 2 world
 * units wide, which is 0.2 CSS pixels in the overview pane and 200 CSS pixels
 * in the detail pane, from one `outlineWidth: 2`. The same edge is one pixel
 * soft in both, because `fwidth` measures the pixel per fragment. A shader that
 * baked its softness into a constant would give the left pane a staircase and
 * the right pane a 200 pixel gradient, and BOTH are visible in one screenshot.
 *
 * The consequence, stated rather than left to look like an oversight: at 0.1x
 * that outline is a tint on the hero's edge and not a line, and `sdf-nodes.ts`
 * says why in as many words (a sub-pixel outline is under-covered by a
 * half-space coverage formula). The circle beside it carries a 26-unit outline,
 * 2.6 pixels at 0.1x, so the overview pane has an outline a reader can see.
 *
 * ## Why four shapes and not one
 *
 * One shape would satisfy the sentence. Four separate the claim into things
 * that can be checked independently: the hero carries fill, outline and glow at
 * once, which is M4.2's actual premise, and the two chips on the right carry a
 * glow with no outline and an outline with no glow, so a reader can see which
 * pixels come from which term instead of taking the composite on trust. The
 * circle is there because two distance fields shipped and a scene with one
 * would only prove one.
 *
 * Nothing here comes from `@dagr/graph`. The two halves of this page are still
 * separate, for the reason `App.tsx` gives: turning a graph into a scene is
 * M4.4, and inventing a layout in the demo would be the wrong place to write
 * one.
 */

/** The amber Dagr uses everywhere, and this page's own accent. */
const AMBER = 0xffb703;

/**
 * The shape both panes draw, and the only shape either pane is aimed at.
 *
 * A rounded rect rather than a circle because it has both kinds of edge: four
 * straight runs and four arcs, so one shape answers "is a straight edge crisp"
 * and "is a curved edge still a curve" at the same magnification.
 *
 * The corner radius is 24 world units, which is 3.4% of the width and reads as
 * a softened rectangle at 0.1x rather than as a pill. It is small on purpose:
 * radius and on-screen curvature trade against each other exactly, and a radius
 * generous enough to be obvious at 0.1x (say 200 units) would be a 20,000 pixel
 * arc at 100x, which is a straight line in a 480 pixel pane. 24 is the largest
 * radius that still bows visibly in the detail pane.
 */
export const HERO: ShapeInstance = {
  kind: 'rounded-rect',
  center: { x: 0, y: 0 },
  size: { width: 700, height: 440 },
  cornerRadius: 24,
  style: {
    fillColor: AMBER,
    // Near white, so the outline band the detail pane is built around is the
    // one thing in that frame that is neither the fill nor the glow. Both of
    // its edges then read against a different colour, which is what makes an
    // uneven width or a soft edge visible instead of arguable.
    outlineColor: 0xfff4d6,
    outlineWidth: 2,
    // A hotter orange than the fill, and not the fill colour, because at 100x
    // the glow is 13,000 pixels across: the pane's whole outside is glow at
    // better than 96% intensity, so a glow that matched the fill would make the
    // inside and the outside of the shape the same colour and leave the band
    // floating on a flat field.
    glowColor: 0xff4d00,
    // 13 CSS pixels of reach at 0.1x. Checked on screen rather than reasoned
    // about: at 70 units the quadratic falloff is spent within 7 pixels and
    // reads as a red border on the chip, which is the one thing a glow must not
    // be mistaken for on a page whose subject is an outline.
    glowRadius: 130,
  },
};

/**
 * The rest of the scene: everything that exists to be looked at in the overview
 * pane, sized so the whole arrangement fits at 0.1x.
 *
 * Each one is at least 667 world units in its larger dimension, which is the
 * 33.3 CSS pixel half extent `AA_QUAD_PADDING_FRACTION` needs at this zoom.
 * That is not decoration: a shape below it has the outer sliver of its
 * antialiasing ramp clipped at the four edge midpoints, and a demo whose point
 * is antialiasing should not be showing that.
 */
const SATELLITES: readonly ShapeInstance[] = [
  {
    // The second distance field. A circle is entirely arc, so at 76 CSS pixels
    // across it is the overview pane's real antialiasing test: a curve that
    // small either steps or does not.
    kind: 'circle',
    center: { x: -1250, y: 0 },
    size: { width: 760, height: 760 },
    style: {
      fillColor: 0x4cc9f0,
      outlineColor: 0xeaf9ff,
      // 26 units, so 2.6 CSS pixels at 0.1x. Thick enough to be a line rather
      // than a tint, which the hero's 2-unit outline cannot be at this zoom.
      outlineWidth: 26,
      glowColor: 0x4cc9f0,
      glowRadius: 90,
    },
  },
  {
    // Glow, no outline.
    kind: 'rounded-rect',
    center: { x: 1250, y: 560 },
    size: { width: 820, height: 360 },
    cornerRadius: 80,
    style: { fillColor: 0x9b8cff, glowColor: 0x6c5cff, glowRadius: 120 },
  },
  {
    // Outline, no glow, over a fill barely above the clear colour, so the chip
    // reads as a ring rather than as a slab. `fillOpacity: 0` would not do it:
    // that field scales the WHOLE composite, outline included, so a zero there
    // draws nothing at all.
    kind: 'rounded-rect',
    center: { x: 1250, y: -560 },
    size: { width: 820, height: 360 },
    cornerRadius: 80,
    style: { fillColor: 0x161b21, outlineColor: 0x7ee787, outlineWidth: 26 },
  },
];

/**
 * The batch, hero first.
 *
 * Order is draw order for overlapping transparent quads, and nothing here
 * overlaps: the closest approach is the hero's glow reaching x = 485 and the
 * circle's reaching x = -780. Worth knowing before a shape is moved, since the
 * fix for an overlap that composites wrong is an order rather than a position.
 */
export const SCENE_SHAPES: readonly ShapeInstance[] = [HERO, ...SATELLITES];

/**
 * Where the overview camera looks.
 *
 * The origin, not the scene's centroid. The painted scene runs from about
 * -1726 to 1786 across and -759 to 866 up, so the origin is off centre by about
 * 60 and 107 world units, which at 0.1x is 6 and 11 CSS pixels in a pane 480
 * tall. Recentring would buy those pixels and cost the property that makes the
 * two panes easy to reason about: the hero sits at the world origin, and the
 * overview camera looks at the world origin.
 */
export const OVERVIEW_CENTER: Vec2 = { x: 0, y: 0 };

/**
 * The point on a rounded rect's top-right corner arc where the boundary runs at
 * 45 degrees, in world units.
 *
 * Computed rather than written down, so it cannot drift when the hero is
 * resized: at 100x a mistake of one world unit is 100 CSS pixels, which is the
 * difference between an edge across the middle of the pane and a pane of flat
 * fill colour that looks exactly like a renderer drawing nothing.
 *
 * The 45 degree point rather than either end of the arc because it is the one
 * place on the corner where neither the horizontal nor the vertical run of the
 * boundary is nearby, so the pane shows arc and only arc. It is also the
 * furthest point of the shape from its own centre, which makes it easy to
 * confirm by eye in the overview pane.
 */
function cornerArcMidpoint(shape: ShapeInstance): Vec2 {
  const radius = shape.cornerRadius ?? 0;
  // The arc's own centre, plus the radius at 45 degrees.
  const offset = radius / Math.SQRT2;
  return {
    x: shape.size.width / 2 - radius + offset,
    y: shape.size.height / 2 - radius + offset,
  };
}

/**
 * Where the detail camera looks: the hero's top-right corner, exactly on the
 * boundary.
 *
 * `test/scene.test.ts` checks that with `roundedRectDistance`, the same field
 * the shader transcribes, rather than by recomputing the arithmetic above.
 */
export const DETAIL_CENTER: Vec2 = cornerArcMidpoint(HERO);
