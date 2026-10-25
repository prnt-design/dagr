import { Color, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { float, positionLocal, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { circleSDF, roundedRectSDF, sdfShading } from './sdf-nodes.js';
import { shapeQuadSize } from './sdf.js';
import type { NormalizedShape } from './shape.js';

/**
 * Where a {@link NormalizedShape} becomes three.js objects: a quad to
 * rasterise and a material that shades it from a distance field.
 *
 * ## INTERNAL. Do not export this module from `index.ts`
 *
 * For exactly the reason `sdf-nodes.ts` gives at length, and it applies here
 * with one more link in the chain: the return type below mentions `Mesh`,
 * `PlaneGeometry` and `MeshBasicNodeMaterial`, three is a peer dependency, and a
 * three type in an exported signature turns two copies of three in one tree from
 * a bundle-size problem into a type error. `index.ts` exports `shape.ts` and
 * `sdf.ts`, which are plain records and plain numbers. This file is reached by
 * `webgpu-renderer.ts`, which already talks to three because talking to three is
 * its job.
 *
 * ## The one idea worth stating before the code
 *
 * **The quad is bigger than the shape, and the distance field does not care.**
 * `shapeQuadSize` pads the plane for the outline, the glow and the antialiasing
 * ramp, so the plane's own half extents are not the shape's. The field is
 * evaluated against the SHAPE's half size, passed in as a constant, while the
 * point comes from `positionLocal.xy`, which a centred `PlaneGeometry` makes
 * exactly the shape-local coordinate `sdf-nodes.ts` asks for: origin at the
 * centre, world y up, world units. Padding the plane therefore moves the quad's
 * edges outward and changes nothing about the shape, which is the property that
 * lets `sdf.ts` decide how much room to reserve without this file agreeing to
 * anything beyond calling it.
 *
 * ## One material per shape, which M4.3 replaces
 *
 * Every call builds a fresh geometry and a fresh material, and every shape
 * parameter is baked into the node graph as a constant rather than fed through a
 * uniform. That is the naive implementation on purpose: it is one mesh per
 * shape, one draw call per shape, and one shader compilation per distinct node
 * graph, which is the wrong shape for 10k nodes and the right shape for proving
 * that one distance field carries fill, outline and glow. M4.3 owns instancing
 * and the per-instance attribute, and the decision this file deliberately does
 * NOT make is the one M4.3 is holding: one material with a per-instance shape id
 * versus one material per family. Nothing here is built to survive that; it is
 * built to be deleted by it.
 */

/**
 * A shape as three.js objects: the mesh to put in the scene, plus the two GPU
 * resources whoever holds the mesh has to give back.
 *
 * The geometry and the material are returned alongside the mesh even though
 * `mesh.geometry` and `mesh.material` reach both, because `Mesh.material` is
 * typed as one material or an array of them and the caller disposing them
 * should not have to narrow a union to release memory it just allocated.
 */
export interface ShapeMesh {
  /** The mesh to add to a scene. */
  readonly object: Mesh;

  /** The quad, sized by `shapeQuadSize`. */
  readonly geometry: PlaneGeometry;

  /** The material, shading that quad from the shape's distance field. */
  readonly material: MeshBasicNodeMaterial;
}

/**
 * Turns a `0xRRGGBB` integer into a `vec3` in the renderer's working colour
 * space, which is what {@link sdfShading} takes.
 *
 * three's `Color` does the conversion: `new Color(hex)` reads the integer as
 * sRGB and converts to the working space when colour management is on, which it
 * is by default. Doing it here rather than handing the shader an sRGB triple
 * matters, because the shader mixes three colours by coverage and a mix in the
 * wrong space darkens the antialiasing band along every edge.
 *
 * Spelled `vec3(c.r, c.g, c.b)` rather than TSL's `color()`, which builds a
 * node of type `color` where `sdfShading` wants `vec3`. The two are the same
 * three floats; this spelling is the one that says so in the type.
 */
function colorNode(hex: number): Node<'vec3'> {
  const converted = new Color(hex);
  return vec3(converted.r, converted.g, converted.b);
}

/**
 * The signed distance node for a shape, chosen by its {@link NormalizedShape.kind}.
 *
 * The whole of what `kind` decides, in this package, is which of these two
 * functions runs. Everything downstream (the coverage, the outline band, the
 * glow, the compositing) reads the distance and never asks what drew it, which
 * is what makes adding a family later a matter of one more branch here rather
 * than a second shading path.
 */
function distanceNode(shape: NormalizedShape): Node<'float'> {
  const point = positionLocal.xy;
  if (shape.kind === 'circle') {
    // A circle's radius is half its width, and `normalizeShape` has already
    // rejected an unequal size, so the height cannot disagree with it here.
    return circleSDF(point, float(shape.size.width / 2));
  }
  const halfSize = vec2(shape.size.width / 2, shape.size.height / 2);
  return roundedRectSDF(point, halfSize, float(shape.cornerRadius));
}

/**
 * Builds the mesh that draws one shape.
 *
 * Takes a {@link NormalizedShape} rather than a `ShapeInstance` so that every
 * value read below is already checked and already defaulted: there is no `?? 0`
 * in this file, and there is no way to reach it with a `NaN` size that would
 * become a quad the rasteriser silently drops. `normalizeShape` is the gate, and
 * the caller runs it.
 *
 * **Two things are set on the material and both are load bearing.**
 *
 * `transparent = true`, because the shading node returns real alpha: the fill
 * carries `fillOpacity`, the glow fades to nothing across its radius, and
 * everything outside the shape and its glow is fully transparent. With
 * `transparent` false three disables blending and the alpha is discarded, so
 * every quad in the scene draws as an opaque rectangle of fill colour, corners
 * and all. That looks like a broken shader and is not one.
 *
 * `depthWrite = false`, because the quads overlap and most of each one is
 * transparent. A transparent fragment that wrote depth would reject anything
 * drawn behind it later in the frame, so one shape's invisible corner would
 * erase its neighbour's glow along a straight edge. This is the standard pairing
 * for alpha-blended geometry and it costs the depth buffer's ordering, which is
 * why the transparent pass sorts back to front instead.
 *
 * Nothing else is set. `depthTest`, `side`, `blending` and the rest keep three's
 * defaults, which are what a 2D scene of z = 0 quads wants.
 *
 * The shading goes on `colorNode` rather than `outputNode` so that it passes
 * through the material's own alpha, colour space and tone mapping handling on
 * the way to the framebuffer, the same as any other node material's colour. A
 * `vec4` there carries its alpha into the material's `diffuseColor`, which is
 * where `transparent` above picks it up.
 */
export function createShapeMesh(shape: NormalizedShape): ShapeMesh {
  const { style } = shape;
  const quad = shapeQuadSize(shape.size, style.outlineWidth, style.glowRadius);

  // One quad, no subdivision: the field is evaluated per fragment, so extra
  // vertices buy nothing and cost a bigger buffer on every shape in the scene.
  const geometry = new PlaneGeometry(quad.width, quad.height);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = sdfShading({
    distance: distanceNode(shape),
    fillColor: colorNode(style.fillColor),
    fillOpacity: float(style.fillOpacity),
    outlineColor: colorNode(style.outlineColor),
    outlineWidth: float(style.outlineWidth),
    glowColor: colorNode(style.glowColor),
    glowRadius: float(style.glowRadius),
  });
  material.transparent = true;
  material.depthWrite = false;

  const object = new Mesh(geometry, material);
  // The quad is centred on the shape's centre, which is what makes
  // `positionLocal.xy` the shape-local point. z is 0: the plane every 2D shape
  // in this package lives on, bracketed by `CAMERA_NEAR` and `CAMERA_FAR`.
  object.position.set(shape.center.x, shape.center.y, 0);

  return { object, geometry, material };
}
