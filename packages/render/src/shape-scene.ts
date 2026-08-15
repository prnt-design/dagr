import { createInstancedShapes } from './instanced-scene.js';
import type { InstancedShapes } from './instanced-scene.js';
import type {
  InstancedFamilyStyle,
  ShapeFamily,
  ShapeInstance,
} from './instance-attributes.js';
import { requireShapeStyle, shapeQuadSize } from './sdf.js';
import type { ShapeStyle } from './sdf.js';
import type { Size, Vec2, WorldBounds } from './types.js';

/**
 * The scene M4.2 draws: a CRISPNESS LADDER of a rounded rect and a circle on each
 * of three rungs a decade apart, as data plus a function that turns each descriptor
 * into a mesh.
 *
 * The RECTS are 10, 100 and 1000 world units across, which is the 100:1 the rest of
 * the package quotes. The circles are 4, 40 and 400, because each circle's diameter
 * matches its rung's height rather than its rung's width, so the six SHAPES span
 * 250:1. Two true numbers about different things: quote the one that is meant, and
 * `test/shape-scene.test.ts` asserts them separately for that reason.
 *
 * **Why a ladder and not one shape.** The claim M4.2 makes is that an SDF is
 * crisp at every zoom rather than at one, and a scene containing shapes of a
 * single size cannot show the difference however many screenshots are taken of
 * it: a texture atlas baked at 100 units looks identical at zoom 1 and only falls
 * apart at the ends. Three rungs a decade apart put both ends of the range in ONE
 * frame, so a single screenshot at zoom 0.1 and a single close-up at zoom 100 are
 * between them evidence about the whole range.
 *
 * Data first, meshes second, because the layout is arithmetic and the meshes are
 * not. Where each shape sits, how big its padded quad is and whether any two of
 * them overlap are all decidable in `test/shape-scene.test.ts` with no device;
 * whether the shader draws anything is not decidable anywhere in Node, so it is
 * kept in as few lines as possible and left to the orchestrator's screenshot.
 *
 * **M4.3 changed how it is drawn and not what is drawn.** The six shapes used to
 * be six meshes and are now two instanced ones, a rounded rect family and a
 * circle family, with everything that differs between rungs read per instance.
 * The descriptors below are untouched, which is the point: the committed
 * references are then evidence about the instanced path as well as about the
 * shader. `instanced-scene.ts` holds the machinery and the material decision.
 *
 * Nothing here is exported from `index.ts`. The scene is a hard-coded
 * demonstration, and M4.4 owns feeding a real layout in; exporting it now would
 * make a placeholder part of the package's contract.
 */

/**
 * A shape the scene can draw, as a discriminated union rather than one record
 * with an unused field.
 *
 * A circle carries a RADIUS and a rounded rect carries a SIZE and a corner
 * radius, so there is no way to write a circle whose width and height disagree,
 * or one whose corner radius contradicts its size. The alternative (one record
 * with `size` and `cornerRadius` for both, and a rule that a circle's size is
 * square and its radius is half the side) is two invariants that have to be
 * validated at runtime instead of one that cannot be expressed wrongly.
 *
 * `label` is not decoration: it is what a `RangeError` names, so a scene of six
 * shapes says which one had the bad number rather than making the caller count.
 */
export type ShapeDescriptor =
  | {
      readonly kind: 'roundedRect';
      readonly label: string;
      /** Where the shape's centre sits, in world units. */
      readonly center: Vec2;
      /** The full size of the shape, in world units. */
      readonly size: Size;
      /** The corner radius, in world units, at most half the smaller dimension. */
      readonly cornerRadius: number;
      readonly style: ShapeStyle;
    }
  | {
      readonly kind: 'circle';
      readonly label: string;
      readonly center: Vec2;
      /** The radius, in world units. */
      readonly radius: number;
      readonly style: ShapeStyle;
    };

/**
 * The palette, with the actual numbers and why each one.
 *
 * M4.1's family, extended rather than replaced: amber `0xffb703` on near-black
 * `0x0b0d10` was chosen because it is nobody's default, so a grey, white or black
 * frame is a frame that did not come from this package. The other four are the
 * rest of that same five-colour set, which is what makes the additions read as
 * one design instead of four decisions.
 *
 * - `RECT_FILL` amber `0xffb703`, unchanged from first light, so the M4.2 frame
 *   is recognisably a descendant of the M4.1 one.
 * - `RECT_GLOW` orange `0xfb8500`: the amber's warmer neighbour, so the halo
 *   reads as the shape's own light rather than as a second object behind it.
 * - `CIRCLE_FILL` blue `0x219ebc`: a SECOND hue, so the two shape families are
 *   distinguishable at a glance and a reviewer can tell which primitive drew
 *   which shape. Cool against warm is the largest separation the set offers.
 * - `CIRCLE_GLOW` sky `0x8ecae6`: the blue's lighter neighbour, on the same
 *   argument as the amber's.
 * - `OUTLINE` deep blue `0x023047`, the set's darkest member, and the SAME for
 *   both families. The outline is inset (see `outlineCoverage`), so it is always
 *   drawn on top of a fill and never against the background: the contrast that
 *   has to work is outline against fill, and a near-black line is a large
 *   luminance step against both the amber and the blue.
 */
const RECT_FILL = 0xffb703;
const RECT_GLOW = 0xfb8500;
const CIRCLE_FILL = 0x219ebc;
const CIRCLE_GLOW = 0x8ecae6;
const OUTLINE = 0x023047;

/**
 * The outline width, in DEVICE pixels, for every shape in the ladder.
 *
 * Two, and it is a legibility decision rather than a floor imposed by the
 * arithmetic. `outlineCoverage` draws `w` fully covered pixel centres for a band
 * of `w` pixels, so one pixel would already be a crisp hairline rather than a
 * half-alpha one; two is what makes the border read as a border at a glance on a
 * near-black background, and it is the smallest width whose edge a reviewer can
 * see is a deliberate line and not an antialiasing artifact. See
 * `outlineCoverage` in `sdf.ts` for the pixel grid claim, which is asserted.
 *
 * In PIXELS, so it is the same thickness on screen on every rung of the ladder.
 * That is the whole demonstration: the 1000 unit rect and the 10 unit rect get
 * the same 2 pixel border at every zoom, which a geometry pipeline cannot do
 * without rebuilding the geometry.
 *
 * **DEVICE pixels, which makes the number display dependent, and it is still 2.**
 * The legibility argument above was made in CSS pixels, and the two units coincide
 * at dpr 1, which is the ratio every committed reference frame was captured at. So
 * at the only ratio this ladder has evidence for, 2 is exactly the width that
 * argument justified. Raising it to 3 or 4 to defend the dpr 2 case would make the
 * references thicker than the prose describes and trade measured evidence for an
 * unmeasured display, which is the wrong way round. What is true and worth knowing
 * is that the border reads finer on a higher ratio screen (1.00 CSS pixels at dpr 2,
 * 0.67 at dpr 3). Revisit the NUMBER when M4.4 adds the `ShapeStyle` defaults
 * helper and a ratio aware default has somewhere to live, and revisit it against a
 * capture at that ratio rather than against this paragraph.
 */
const OUTLINE_PIXELS = 2;

/**
 * The glow's alpha where it meets the boundary.
 *
 * 0.45 because a halo at full alpha stops being a halo: it reads as a second,
 * blurrier shape sitting behind the first, and at these glow radii (a quarter of
 * the shape's height) that is a shape half again as large. Under half, the halo
 * is a suggestion, which is what a glow should be on a graph that will eventually
 * have thousands of them.
 */
const GLOW_ALPHA = 0.45;

/**
 * Builds the two styles for one rung of the ladder.
 *
 * The glow radius scales with the shape (a quarter of its height) and the outline
 * does not (see {@link OUTLINE_PIXELS}). That asymmetry is the point: a glow is a
 * property of the shape, so it is in world units, and a halo that stayed one
 * world unit wide while its shape grew a hundredfold would be invisible on the
 * largest rung and overwhelming on the smallest. An outline is a property of the
 * screen, so it is in pixels.
 */
function rungStyles(height: number): { rect: ShapeStyle; circle: ShapeStyle } {
  const glowWorld = height / 4;
  return {
    rect: {
      fillColor: RECT_FILL,
      outlineColor: OUTLINE,
      glowColor: RECT_GLOW,
      glowAlpha: GLOW_ALPHA,
      outlinePixels: OUTLINE_PIXELS,
      glowWorld,
    },
    circle: {
      fillColor: CIRCLE_FILL,
      outlineColor: OUTLINE,
      glowColor: CIRCLE_GLOW,
      glowAlpha: GLOW_ALPHA,
      outlinePixels: OUTLINE_PIXELS,
      glowWorld,
    },
  };
}

/**
 * The scene, as six descriptors: a rounded rect and a circle at 10, 100 and 1000
 * world units across.
 *
 * ## The numbers, and how they were arrived at
 *
 * **The smallest rect is 10 by 4, centred on the world ORIGIN.** The default
 * camera looks at the origin, so that is where the close-up rung has to be for
 * zoom 100 to be a close-up of anything. Ten world units at zoom 100 is 1000 CSS
 * pixels against the demo's measured 1102 pixel canvas, so the rect fills 91% of
 * the width and its side edges stay on screen with 9% to spare. The demo's own
 * suite pins the 6 to 11 unit band this has to sit in, so a change here fails
 * there rather than drifting.
 *
 * **Everything grows to the RIGHT in decades.** The rect centres are 0, 100 and
 * 1000, the same steps as the sizes, so a factor of ten out from the default
 * camera brings the next rung into frame with no pan, and the smallest shape
 * stays at the centre of every frame, which is where a reviewer looking for
 * aliasing looks first. The whole scene lies within x from -7 to 2301 and y from
 * -301 to 301, so it is inside the 10000 by 6000 world a 1000 by 600 canvas shows
 * at zoom 0.1, and inside the 11020 by 5980 the demo's canvas actually shows.
 *
 * **Nothing overlaps, and the strong version of that is tested: no two PADDED
 * QUADS overlap.** A quad contains its shape and the whole of its glow, so
 * disjoint quads mean disjoint glows a fortiori, and they also mean no fragment
 * in this scene is ever blended over another one. That matters because the
 * materials are transparent with `depthWrite: false`, where overlapping coplanar
 * quads would make the frame depend on draw order. The gaps are what pay for it:
 * the smallest circle sits at x = 12 rather than at a tidier 10, because its quad
 * and the rect's are each padded by a fixed world unit for the fill's ramp and
 * would touch at 10.
 */
export const CRISPNESS_LADDER: readonly ShapeDescriptor[] = [
  {
    kind: 'roundedRect',
    label: 'rect-10',
    center: { x: 0, y: 0 },
    size: { width: 10, height: 4 },
    cornerRadius: 1,
    style: rungStyles(4).rect,
  },
  {
    kind: 'circle',
    label: 'circle-10',
    center: { x: 12, y: 0 },
    radius: 2,
    style: rungStyles(4).circle,
  },
  {
    kind: 'roundedRect',
    label: 'rect-100',
    center: { x: 100, y: 0 },
    size: { width: 100, height: 40 },
    cornerRadius: 10,
    style: rungStyles(40).rect,
  },
  {
    kind: 'circle',
    label: 'circle-100',
    center: { x: 200, y: 0 },
    radius: 20,
    style: rungStyles(40).circle,
  },
  {
    kind: 'roundedRect',
    label: 'rect-1000',
    center: { x: 1000, y: 0 },
    size: { width: 1000, height: 400 },
    cornerRadius: 100,
    style: rungStyles(400).rect,
  },
  {
    kind: 'circle',
    label: 'circle-1000',
    center: { x: 2000, y: 0 },
    radius: 200,
    style: rungStyles(400).circle,
  },
];

/**
 * The full size of a descriptor's SHAPE, in world units. Not its quad: see
 * {@link shapeQuadBounds} for that, and `shapeQuadSize` in `sdf.ts` for the
 * difference and why confusing the two clips the glow.
 */
export function shapeSize(descriptor: ShapeDescriptor): Size {
  if (descriptor.kind === 'circle') {
    const diameter = descriptor.radius * 2;
    return { width: diameter, height: diameter };
  }
  return descriptor.size;
}

/**
 * Where a descriptor's PADDED QUAD sits in world space, as extents.
 *
 * Extents rather than a corner and a size, because the two things anybody wants
 * this for are an overlap test and a "does it fit in the view" test, and
 * {@link WorldBounds} is the shape both of those want: four comparisons, no
 * additions, and no chance of the y-down mixup `types.ts` describes.
 *
 * Validates, through `shapeQuadSize`, and names the descriptor when it does. That
 * is what the `field` argument is for: this function is the one a caller reaches
 * for without going through `createShapeMeshes`, so it is a place a bad number
 * surfaces first, and `rect-100.style.glowWorld` is the difference between reading
 * one line and reading a scene.
 */
export function shapeQuadBounds(descriptor: ShapeDescriptor): WorldBounds {
  const quad = shapeQuadSize(
    shapeSize(descriptor),
    descriptor.style,
    `${descriptor.label}.style`,
  );
  return {
    minX: descriptor.center.x - quad.width / 2,
    minY: descriptor.center.y - quad.height / 2,
    maxX: descriptor.center.x + quad.width / 2,
    maxY: descriptor.center.y + quad.height / 2,
  };
}

/**
 * One descriptor's per-instance half: everything about it that varies from
 * shape to shape within its family.
 *
 * The split is `instance-attributes.ts`'s and the argument is there. What this
 * function does is apply it to a record that predates it: a {@link ShapeStyle}
 * carries all six fields, three of which are now the family's, so the conversion
 * drops those three here and {@link ladderFamilyStyle} picks them up.
 */
function instanceOf(descriptor: ShapeDescriptor): ShapeInstance {
  const style = requireShapeStyle(descriptor.style, `${descriptor.label}.style`);
  if (descriptor.kind === 'circle') {
    return {
      kind: 'circle',
      label: descriptor.label,
      center: descriptor.center,
      radius: descriptor.radius,
      fillColor: style.fillColor,
      glowColor: style.glowColor,
      glowWorld: style.glowWorld,
    };
  }
  return {
    kind: 'roundedRect',
    label: descriptor.label,
    center: descriptor.center,
    size: descriptor.size,
    cornerRadius: descriptor.cornerRadius,
    fillColor: style.fillColor,
    glowColor: style.glowColor,
    glowWorld: style.glowWorld,
  };
}

/**
 * The family half of a set of descriptors' styles, and the check that they agree
 * about it.
 *
 * One instanced mesh draws one family with ONE outline colour, ONE outline width
 * and ONE glow alpha, because those three are uniforms (see
 * `instanced-scene.ts`). A set of descriptors that disagrees about any of them
 * cannot be drawn in one call, so it is rejected here rather than drawn with
 * whichever descriptor happened to be first. The ladder agrees by construction:
 * every rung's outline is the same deep blue at 2 device pixels and every glow
 * is at 0.45, which is what {@link rungStyles} varies nothing about.
 */
function ladderFamilyStyle(
  descriptors: readonly ShapeDescriptor[],
  family: ShapeFamily,
): InstancedFamilyStyle | undefined {
  const members = descriptors.filter((descriptor) => descriptor.kind === family);
  const first = members[0];
  // Nothing rather than a fabricated default, because `createInstancedShapes`
  // takes a PARTIAL record and builds no mesh for a family with no instances. A
  // default here would be a style that is never validated and never read, and
  // the first reader to find it would reasonably believe it was drawing
  // something.
  if (first === undefined) return undefined;
  const style = requireShapeStyle(first.style, `${first.label}.style`);
  for (const member of members) {
    const other = requireShapeStyle(member.style, `${member.label}.style`);
    for (const field of ['outlineColor', 'glowAlpha', 'outlinePixels'] as const) {
      if (other[field] !== style[field]) {
        throw new RangeError(
          `${member.label}.style.${field} has to match the rest of the ${family} family (${String(style[field])} from ${first.label}), got ${String(other[field])}`,
        );
      }
    }
  }
  return {
    outlineColor: style.outlineColor,
    glowAlpha: style.glowAlpha,
    outlinePixels: style.outlinePixels,
  };
}

/**
 * Builds the scene: one instanced mesh per shape family present, each carrying
 * every shape of that family as an instance.
 *
 * **Two meshes for six shapes, and the six are unchanged on screen.** M4.2 drew
 * one `PlaneGeometry` and one material per descriptor, which is a draw call per
 * shape and does not survive contact with a graph: the campaign demo's 3,010
 * nodes would be 3,010 meshes and 6,020 GPU resources. M4.3 replaces that with a
 * unit quad scaled per instance in the vertex stage, so the whole ladder is two
 * draw calls and the position, size, corner radius, glow reach and colours all
 * come out of per-instance attributes. See `instanced-scene.ts` for the material
 * decision and for what is provable without a device.
 *
 * The picture is what makes that claim checkable: the ladder is the same six
 * shapes in the same places, so M4.2's committed references at 0.1x, 1x and 100x
 * are a regression test for the entire per-instance path. A factor of two
 * anywhere in the quad scaling shows up as shapes at half or twice their size.
 *
 * Takes the descriptors rather than reading {@link CRISPNESS_LADDER} directly, so
 * a test can build one shape instead of six and so M4.4 has somewhere to put a
 * layout result.
 *
 * **Every descriptor is validated before any mesh is built.** Validating inside
 * the build loop instead would leave a geometry and a material allocated with no
 * owner when a later descriptor throws, and a caller that never received a scene
 * has nothing to dispose them with: the same guarantee `createRenderer` makes
 * about an aborted mount. `createInstancedShapes` holds the second half of it,
 * disposing the first family's mesh when the second family's data is bad.
 */
export function createShapeMeshes(
  descriptors: readonly ShapeDescriptor[] = CRISPNESS_LADDER,
): readonly InstancedShapes[] {
  const instances = descriptors.map((descriptor) => instanceOf(descriptor));
  const styles: Partial<Record<ShapeFamily, InstancedFamilyStyle>> = {};
  for (const family of ['roundedRect', 'circle'] as const) {
    const style = ladderFamilyStyle(descriptors, family);
    // Assigned only when there is one, rather than assigned `undefined`. The
    // package compiles with `exactOptionalPropertyTypes`, so an explicit
    // `undefined` is not the same thing as an absent key, and the distinction is
    // the one this record is built to carry.
    if (style !== undefined) styles[family] = style;
  }
  return createInstancedShapes(instances, styles, 'ladder');
}
