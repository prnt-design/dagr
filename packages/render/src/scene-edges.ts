import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { attribute, uniform, varying, vec3 } from 'three/tsl';
import { linearFromHex } from './instance-attributes.js';
import { ribbonAlpha, ribbonArcPixels, ribbonWorldPosition } from './ribbon-nodes.js';
import { requireRibbonStyle, tessellateRibbons } from './ribbon.js';
import type { RibbonGeometry, RibbonOptions, RibbonStyle } from './ribbon.js';
import type { GpuResource, Vec2 } from './types.js';
import { requireAtLeast, requireFinite } from './validate.js';

/**
 * The seam M4.5 exists to name: a caller hands over EDGES, and this keeps a
 * mesh per draw group agreeing with them.
 *
 * The sibling of `scene-nodes.ts`, and deliberately not the same shape, because
 * an edge is not a node in the two ways that decide a design:
 *
 * **Edges are not instanced.** `ribbon.ts` carries that argument in full: every
 * route has its own point count, so the only thing an instance could be is a
 * segment, and a per-segment instance computes its joins in the vertex shader
 * where no test in this repository can execute them. A group is therefore ONE
 * indexed mesh, rebuilt when the routes change, which for a layout is rarely.
 *
 * **Layering is the caller's, and it has to be.** M4.3 established that blend
 * order within a mesh is SLOT order and that a slot is not durable across a
 * removal, so two ribbons in one draw call cannot be reliably ordered against
 * each other. Groups are drawn in the order they were declared, and that is the
 * only ordering this package offers: dashed routed edges under solid overlay
 * lines is two groups, not two z values.
 *
 * ## Geometry and style are separate calls, and that is the whole ergonomics
 *
 * {@link SceneEdges.setEdges} rebuilds a group's buffers. {@link
 * SceneEdges.setStyle} writes uniforms and touches no buffer. They are split
 * because the screen-space width decision makes the second one a PER FRAME
 * call: a scene that clamps its ribbon width against the zoom, and fades it
 * below the floor the way {@link ribbonWidthAt} describes, does that on every
 * draw, and a seam that made width a property of the geometry would
 * re-tessellate 7,100 routes to change a uniform. Nothing in a tessellation
 * reads a camera, which is what makes the split possible at all.
 *
 * No three.js type appears in anything this file exports, the rule `types.ts`
 * sets, except {@link SceneEdges.meshes}, which is the same exception
 * `SceneNodes.meshes` takes: the renderer has to put them in a `Scene`, and
 * neither type reaches `index.ts`.
 */

/** One edge to draw: an id, its centreline in world units, and its colour. */
export interface SceneEdge {
  /**
   * The caller's own id, echoed on nothing and used for nothing but the error
   * message when a route cannot be drawn. An edge has no durable per-instance
   * state to key, which is why this file has no equivalent of
   * `NodePlacement`: a group's geometry is rebuilt whole or not at all.
   */
  readonly id: string;

  /**
   * The centreline, world units, y up, source to target.
   *
   * `RoutedEdge.points` from `@dagr/layout` after the caller's y flip is
   * exactly this, and the direction is a contract there, which is what makes a
   * flowing dash mean "towards the target".
   */
  readonly points: readonly Vec2[];

  /** The ribbon's colour, as `0xRRGGBB`. Converted to linear on the way in. */
  readonly color: number;
}

/** One draw group: an id, how its edges are drawn, and the curve they take. */
export interface SceneEdgeGroup {
  /** The name `Renderer.setEdges` and `Renderer.setEdgeStyle` address it by. */
  readonly id: string;

  /** The width and dash pattern. See {@link RibbonStyle}. */
  readonly style: RibbonStyle;

  /**
   * How the control points are treated: `'polyline'`, the default, draws them
   * as they are, and `'smooth'` runs a curve THROUGH every one of them.
   *
   * A routed edge wants the default, because its bends are where a layout put
   * a dummy and rounding them off would second-guess the crossing the order
   * stage chose. A line a caller drew between two boxes wants `'smooth'`,
   * because its control points are a curve waiting to happen.
   */
  readonly curve?: 'polyline' | 'smooth' | undefined;
}

/** The attribute names the ribbon material reads. Local to this file's material. */
const POSITION = 'ribbonPosition';
const OFFSET = 'ribbonOffset';
const ACROSS = 'ribbonAcross';
const ARC = 'ribbonArc';
const COLOR = 'ribbonColor';

/**
 * The uniforms one group's material carries, and the reason each is a uniform
 * rather than an attribute: every one of them is a property of the FRAME, not
 * of an edge. A caller changing any of them changes no buffer.
 */
interface RibbonUniforms {
  readonly halfWidthPixels: UniformNode<'float', number>;
  readonly pixelsPerWorldUnit: UniformNode<'float', number>;
  readonly dashPeriodPixels: UniformNode<'float', number>;
  readonly dashDuty: UniformNode<'float', number>;
  readonly dashFlowPixels: UniformNode<'float', number>;
  readonly alpha: UniformNode<'float', number>;
}

/**
 * The material one group draws with: the vertex expansion and the coverage from
 * `ribbon-nodes.ts`, over this file's attributes and uniforms.
 *
 * **Whether there is a dash is decided HERE, once, when the material is built**,
 * and never per fragment. `ribbonCoverage` takes the dash as an optional input
 * and omits its arithmetic entirely when there is none, so a solid group's
 * shader carries no `fract` and no divide it does not use. That is also why a
 * group's dash cannot be switched on later by a uniform: a caller that wants
 * both draws two groups, which is what it wants anyway for the layering.
 */
function createRibbonMaterial(style: RibbonStyle): {
  readonly material: MeshBasicNodeMaterial;
  readonly uniforms: RibbonUniforms;
} {
  const uniforms: RibbonUniforms = {
    halfWidthPixels: uniform(style.halfWidthPixels),
    pixelsPerWorldUnit: uniform(1),
    dashPeriodPixels: uniform(style.dash?.periodPixels ?? 1),
    dashDuty: uniform(style.dash?.duty ?? 0.5),
    dashFlowPixels: uniform(0),
    alpha: uniform(1),
  };

  const position = attribute<'vec2'>(POSITION, 'vec2');
  const offset = attribute<'vec2'>(OFFSET, 'vec2');
  const across = varying(attribute<'float'>(ACROSS, 'float'));
  const edgeColor = attribute<'vec3'>(COLOR, 'vec3');

  // The arc reaches the fragment stage already in device pixels: one multiply
  // per vertex against the same number computed per fragment, and exact under
  // an orthographic camera because its interpolation is affine.
  const arcPixels = varying(
    ribbonArcPixels(attribute<'float'>(ARC, 'float'), uniforms.pixelsPerWorldUnit),
  );

  const world = ribbonWorldPosition({
    position,
    offset,
    halfWidthPixels: uniforms.halfWidthPixels,
    pixelsPerWorldUnit: uniforms.pixelsPerWorldUnit,
  });

  const coverage = ribbonAlpha({
    across,
    halfWidthPixels: uniforms.halfWidthPixels,
    ...(style.dash === undefined
      ? {}
      : {
          dash: {
            arcPixels,
            periodPixels: uniforms.dashPeriodPixels,
            duty: uniforms.dashDuty,
            flowPixels: uniforms.dashFlowPixels,
          },
        }),
  });

  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(world, 0);
  material.colorNode = edgeColor;
  material.opacityNode = coverage.mul(uniforms.alpha);
  // The two flags every shape in this package draws with, and the reasons M4.2
  // gave: alpha for the antialiasing ramps, and no depth write because a
  // transparent fragment that writes depth occludes whatever is drawn behind it
  // afterwards. Ribbons and nodes share the z = 0 plane, so the ribbons' place
  // under the nodes comes from the order the meshes are added to the scene.
  material.transparent = true;
  material.depthWrite = false;
  return { material, uniforms };
}

/** One group's mesh, its material's uniforms, and the geometry it currently holds. */
class EdgeGroup implements GpuResource {
  readonly id: string;
  readonly mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>;
  readonly #uniforms: RibbonUniforms;
  #curve: RibbonOptions['curve'];
  #disposed = false;

  constructor(group: SceneEdgeGroup) {
    requireRibbonStyle(group.style, `group "${group.id}".style`);
    const { material, uniforms } = createRibbonMaterial(group.style);
    this.id = group.id;
    this.#uniforms = uniforms;
    this.#curve = group.curve;
    // Explicitly nothing, because three defaults a draw range's count to
    // Infinity: a group declared before its edges arrive has no attributes to
    // read either, and "draw everything" over an empty buffer is a different
    // kind of nothing from "draw nothing".
    const geometry = new BufferGeometry();
    geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(geometry, material);
    // The bounding sphere three would compute is of the CENTRELINE, and a
    // ribbon is drawn up to its half width outside that, in pixels, which no
    // geometry knows. Rather than inflate a sphere by a quantity that depends
    // on the camera, this opts out: the alternative is edges vanishing at the
    // frame's edge before their centreline does. `instanced-scene.ts` opts out
    // for the neighbouring reason, a unit quad whose sphere describes nothing.
    this.mesh.frustumCulled = false;
  }

  /**
   * Replaces this group's geometry with a NEW one, and disposes the old.
   *
   * Not `setAttribute` onto the retained geometry, and that is the hazard
   * `instanced-scene.ts` documents for the same reason: three keys a GPU buffer
   * to the attribute OBJECT and frees buffers only on the geometry's dispose
   * event, and then only for the attributes it holds at that moment. Replacing
   * an attribute therefore leaves the old buffer alive with nothing referencing
   * it, and this method is called on every re-layout and on every recolour P7
   * asks for, so the leak is five buffers times the whole tessellation per
   * call.
   *
   * Building the whole geometry before swapping it in also makes the update
   * atomic. `colorsFor` validates every colour and throws on a bad one; done in
   * place, a rejected colour would leave the vertex attributes replaced and the
   * index still the previous build's, so the group would draw old triangles
   * over new vertices, and on a smaller rebuild those indices run past the
   * arrays.
   */
  setEdges(edges: readonly SceneEdge[]): void {
    const tessellated = tessellateRibbons(
      edges.map((edge) => ({ id: edge.id, points: edge.points })),
      this.#curve === undefined ? undefined : { curve: this.#curve },
    );
    const colors = colorsFor(edges, tessellated);

    const geometry = new BufferGeometry();
    geometry.setAttribute(POSITION, new BufferAttribute(tessellated.position, 2));
    geometry.setAttribute(OFFSET, new BufferAttribute(tessellated.offset, 2));
    geometry.setAttribute(ACROSS, new BufferAttribute(tessellated.across, 1));
    geometry.setAttribute(ARC, new BufferAttribute(tessellated.arc, 1));
    geometry.setAttribute(COLOR, new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(tessellated.index, 1));
    // Explicit, because three defaults a draw range's count to Infinity and an
    // empty group has no attributes to read either.
    geometry.setDrawRange(0, tessellated.indexCount);

    const previous = this.mesh.geometry;
    this.mesh.geometry = geometry;
    previous.dispose();
  }

  /** Writes this group's per-frame uniforms. See {@link SceneEdges.setStyle}. */
  setStyle(style: EdgeFrameStyle): void {
    // The same floor `requireRibbonStyle` puts on a group's width, applied to
    // the frame's: below half a pixel the visible band is narrower than the
    // ramp that draws it, so the ribbon does not get thinner, it gets fainter
    // and then vanishes. A frame asking for 0.01 would otherwise walk straight
    // through the check the declared style had to pass.
    requireAtLeast(style.halfWidthPixels, 0.5, 'style.halfWidthPixels');
    requireInRange(style.alpha, 'style.alpha');
    this.#uniforms.halfWidthPixels.value = style.halfWidthPixels;
    this.#uniforms.alpha.value = style.alpha;
    // Nothing to rasterise at zero alpha, and three skips a draw for an
    // invisible mesh: at the campaign's fitted zoom the overlay group is faded
    // out entirely, and that is 3,137 smooth routes transformed every frame to
    // write nothing. The group keeps its buffers, so coming back is a uniform.
    this.mesh.visible = style.alpha > 0;
    if (style.dashFlowPixels !== undefined) {
      requireFinite(style.dashFlowPixels, 'style.dashFlowPixels');
      this.#uniforms.dashFlowPixels.value = style.dashFlowPixels;
    }
  }

  /**
   * Writes the pixels per world unit, which is the CAMERA's business rather
   * than a caller's.
   *
   * Separate from {@link setStyle} because the renderer knows this and a
   * caller would have to re-derive it from a camera it also holds. Written on
   * every frame from `render()`, so a group drawn without any style call is
   * still drawn at the right scale rather than at world scale, which looks
   * like nothing on screen and raises no error.
   */
  setPixelsPerWorldUnit(pixelsPerWorldUnit: number): void {
    this.#uniforms.pixelsPerWorldUnit.value = pixelsPerWorldUnit;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * The per-vertex colour buffer: each route's colour written over its own slice.
 *
 * What {@link RibbonGeometry.ranges} is for. The conversion is
 * {@link linearFromHex} and not a copy of it, because a colour reaching a
 * shader as an ATTRIBUTE is converted by nothing: as a uniform three's `Color`
 * does sRGB to linear on the way in, and M4.3 found that skipping it does not
 * throw and does not look broken, it makes every colour lighter and
 * flatter.
 */
function colorsFor(edges: readonly SceneEdge[], geometry: RibbonGeometry): Float32Array {
  const colors = new Float32Array(geometry.vertexCount * 3);
  for (const [index, range] of geometry.ranges.entries()) {
    const edge = edges[index];
    if (edge === undefined) continue;
    const [r, g, b] = linearFromHex(edge.color, `edge "${edge.id}".color`);
    for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex += 1) {
      colors[vertex * 3] = r;
      colors[vertex * 3 + 1] = g;
      colors[vertex * 3 + 2] = b;
    }
  }
  return colors;
}

/**
 * What a frame says about how a group is drawn: only the things a CALLER
 * decides.
 *
 * The pixels per world unit is deliberately not here. It is the camera's, the
 * renderer holds the camera, and asking a caller for it would be asking them to
 * re-derive `zoom * devicePixelRatio` from state the renderer already has, with
 * a default that draws at world scale and so shows nothing while raising
 * nothing. `render()` writes it every frame instead.
 */
export interface EdgeFrameStyle {
  /**
   * Half the visible width, in DEVICE pixels, floored at 0.5 as a declared
   * style is. `ribbonWidthAt` is the arithmetic that decides it from a zoom,
   * and the alpha below is the other half of its answer.
   */
  readonly halfWidthPixels: number;
  /** A multiplier on the ribbon's coverage, in `[0, 1]`. Zero skips the draw. */
  readonly alpha: number;
  /** How far the dash pattern has travelled towards the target. See `advanceDashFlow`. */
  readonly dashFlowPixels?: number | undefined;
}

/** Rejects an alpha outside `[0, 1]`, which a shader would clamp and never report. */
function requireInRange(value: number, field: string): number {
  if (!(value >= 0) || value > 1) {
    throw new RangeError(`${field} has to be a number in [0, 1], got ${String(value)}`);
  }
  return value;
}

/**
 * The scene's edges, across one mesh per declared group.
 *
 * The groups are fixed at construction and their order is the draw order, for
 * the reason `SceneNodes` builds both shape families up front: a mesh created
 * later would have to be added to a `Scene` this object does not hold, which is
 * a reference pointing the wrong way. An empty group costs one material and an
 * empty geometry, and three skips a draw whose index count is zero.
 */
export class SceneEdges implements GpuResource {
  readonly #groups: ReadonlyMap<string, EdgeGroup>;
  #disposed = false;

  constructor(groups: readonly SceneEdgeGroup[]) {
    const built = new Map<string, EdgeGroup>();
    try {
      for (const group of groups) {
        if (built.has(group.id)) {
          throw new RangeError(`groups has two entries with the id "${group.id}"`);
        }
        built.set(group.id, new EdgeGroup(group));
      }
    } catch (error) {
      for (const group of built.values()) group.dispose();
      throw error;
    }
    this.#groups = built;
  }

  /** The meshes to add to a `Scene`, in the order the groups were declared. */
  get meshes(): readonly Mesh<BufferGeometry, MeshBasicNodeMaterial>[] {
    return [...this.#groups.values()].map((group) => group.mesh);
  }

  /**
   * Replaces one group's edges, which rebuilds its buffers.
   *
   * Whole rather than incremental, because the input is a layout's routes and a
   * layout that moved has moved most of them. An edge's geometry has no durable
   * per-instance state to preserve across the rebuild, which is the difference
   * from `SceneNodes.setNodes` and the reason there is no handle here.
   */
  setEdges(groupId: string, edges: readonly SceneEdge[]): void {
    this.#assertLive('setEdges');
    this.#require(groupId, 'setEdges').setEdges(edges);
  }

  /**
   * Writes one group's per-frame uniforms, touching no buffer.
   *
   * The call a draw loop makes every frame: the width a camera implies, the
   * alpha that fades it below the floor, and where the dash has flowed to.
   */
  setStyle(groupId: string, style: EdgeFrameStyle): void {
    this.#assertLive('setStyle');
    this.#require(groupId, 'setStyle').setStyle(style);
  }

  /**
   * Writes every group's pixels per world unit, from the renderer's own camera.
   *
   * Called once per frame by `render()`, which is what makes
   * {@link SceneEdges.setStyle} optional: a group with edges and no style call
   * is drawn at the right scale in the ribbon's default width.
   */
  setPixelsPerWorldUnit(pixelsPerWorldUnit: number): void {
    this.#assertLive('setPixelsPerWorldUnit');
    for (const group of this.#groups.values()) group.setPixelsPerWorldUnit(pixelsPerWorldUnit);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const group of this.#groups.values()) group.dispose();
  }

  #require(groupId: string, method: string): EdgeGroup {
    const group = this.#groups.get(groupId);
    if (group === undefined) {
      throw new RangeError(`${method} names the group "${groupId}", which was never declared`);
    }
    return group;
  }

  #assertLive(method: string): void {
    if (this.#disposed) throw new RangeError(`${method} was called after dispose()`);
  }
}
