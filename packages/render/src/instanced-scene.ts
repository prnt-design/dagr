import { add, attribute, color, float, mul, positionGeometry, varying, vec3 } from 'three/tsl';
import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import { InstancedShapesDisposedError } from './errors.js';
import { InstanceBuffer } from './instance-buffer.js';
import {
  INSTANCE_CHANNELS,
  InstanceAttributeData,
  instanceSize,
  requireShapeInstance,
} from './instance-attributes.js';
import type { SceneStyle, ShapeFamily, ShapeInstance } from './instance-attributes.js';
import { quadPadding } from './sdf.js';
import { circleSDF, roundedRectSDF, shapeShading, tslArith } from './sdf-nodes.js';
import type { GpuResource, WorldBounds } from './types.js';
import { requireColor, requireFinite, requireNonNegative } from './validate.js';

/**
 * M4.3's GPU side: ONE MESH PER SHAPE FAMILY, drawing every shape in that family
 * in a single call, with position, size, corner radius, glow reach and two
 * colours read per instance out of the buffers `instance-attributes.ts` holds.
 *
 * The thin half, deliberately. Everything decidable without a device is in
 * `instance-buffer.ts` and `instance-attributes.ts` and is tested exhaustively
 * there; this file wires those to three, and what it adds that they do not have
 * is a node graph no test in Node can evaluate. `test/instanced-scene.test.ts`
 * checks what is checkable: that the geometry is instanced, that its
 * `instanceCount` follows the live count, that the attributes are the arrays the
 * data module owns, that a growth swaps the geometry and gives the old one back,
 * and that dispose frees everything once.
 *
 * ## The material decision, and it is PROVISIONAL
 *
 * M4.2 deferred this and named the deciding factor: per-fragment branch cost at
 * 10k instances against real fill rate, which cannot be measured while drawing
 * one shape. M4.3 owns the per-instance attribute, so it owns the assembly, and
 * the call is **one material per shape family, not one uber-material with a
 * per-instance shape id.** Three reasons, in the order they carry weight:
 *
 * - The uber-material's cost is per FRAGMENT and the per-family cost is per DRAW
 *   CALL. A shape id branch is evaluated once for every pixel every instance
 *   covers, and a graph at readable zoom is mostly fill; the draw call it saves
 *   is one call. At the campaign's 3,010 nodes the choice is two draw calls
 *   against one, which is not a number worth paying a branch for.
 * - The family count is SMALL and known: a rounded rect, a circle, and whatever
 *   M6's VDSL asks for. An uber-material pays the union of every family's
 *   uniforms for every fragment of every family, and that union grows with the
 *   count while the draw calls it saves grow at the same rate.
 * - Each shader stays small enough to read. The circle branch is five operations
 *   and the rounded rect eleven; a merged shader is both plus a select, in a file
 *   nobody can run.
 *
 * **The revisit gate is M4.10**, which the ROADMAP already names: it is the
 * first point with the fill rate and the instance count to judge this, and the
 * measurement to take there is draw-call overhead against per-fragment branch
 * cost at 10k instances. What makes the choice cheap to reverse is that the
 * distance functions are composable nodes with no opinion about materials (M4.2's
 * decision), so reversing it rewires {@link createInstancedMaterial} and touches
 * no formula.
 *
 * ## What is not tested anywhere, stated plainly
 *
 * The node graph below. Same line `webgpu-renderer.ts` draws: a TSL graph builds
 * under bare Node and does not evaluate, so the per-instance path (an attribute
 * reaching the vertex stage, a quad scaled by it, a varying reaching the
 * fragment stage) is proved by a picture and by nothing else. The picture is the
 * evidence the demo commits: M4.3 drew the crispness ladder through this file and
 * M4.4 draws the campaign through it, so the committed frames are a regression
 * test for the whole per-instance path and a factor of two anywhere in it is
 * visible at a glance.
 */

/**
 * The vertex attribute names, restated from `instance-attributes.ts` in the form
 * the shader reads them.
 *
 * Named constants rather than string literals at the call sites, because a typo
 * in a TSL `attribute()` name does not fail: three warns to the console and
 * substitutes a constant, so the shape gets a size of zero and the frame is
 * empty with nothing thrown. `test/instanced-scene.test.ts` asserts these names
 * are exactly the channels the data module allocates.
 */
const OFFSET = 'instanceOffset';
const SIZE = 'instanceSize';
const CORNER_RADIUS = 'instanceCornerRadius';
const GLOW_WORLD = 'instanceGlowWorld';
const FILL_COLOR = 'instanceFillColor';
const GLOW_COLOR = 'instanceGlowColor';

/**
 * The quad every instance is drawn on, before the per-instance scale: a unit
 * square from -0.5 to 0.5 on both axes, two triangles, with the `normal` and
 * `uv` attributes a node material expects to find.
 *
 * Built by hand rather than taken from a `PlaneGeometry`, for a reason that only
 * shows up on the second one: an `InstancedBufferGeometry` is rebuilt whenever
 * the buffer grows, and attributes shared with a geometry that has already been
 * disposed would have had their GPU buffers destroyed underneath the new mesh.
 * Four vertices are cheaper to write than that question is to answer.
 *
 * The unit size is what makes the per-instance scale possible at all: the vertex
 * stage multiplies this by each instance's padded quad size, so one geometry
 * serves shapes from four world units across to a thousand.
 */
function unitQuadAttributes(): {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array;
} {
  return {
    // prettier-ignore
    position: new Float32Array([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5,  0.5, 0,
    ]),
    // prettier-ignore
    normal: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    // prettier-ignore
    uv: new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]),
    index: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

/**
 * Rejects a family style that cannot be drawn, naming the field.
 *
 * The three checks a whole-shape style record used to make on the three fields
 * that are still shared, and it is its own function rather than a call into one
 * because the record is a different shape now: a style carrying per-instance
 * fields would mean inventing values to satisfy it and then ignoring them, which
 * is how a caller comes to believe a fill colour set on a family means something.
 */
export function requireFamilyStyle(
  style: SceneStyle,
  field: string,
): SceneStyle {
  const glowAlpha = requireFinite(style.glowAlpha, `${field}.glowAlpha`);
  if (glowAlpha < 0 || glowAlpha > 1) {
    throw new RangeError(
      `${field}.glowAlpha has to lie between 0 and 1, got ${String(glowAlpha)}`,
    );
  }
  return {
    outlineColor: requireColor(style.outlineColor, `${field}.outlineColor`),
    glowAlpha,
    outlinePixels: requireNonNegative(style.outlinePixels, `${field}.outlinePixels`),
  };
}

/**
 * The node graph for one family: where each instance's quad goes in the vertex
 * stage, and what colour and alpha it has in the fragment stage.
 *
 * ## The vertex stage
 *
 * ```
 * padding  = quadPadding(instanceGlowWorld)              // per instance
 * quad     = instanceSize + 2 * padding                  // per instance
 * local    = positionGeometry.xy * quad                  // world units from the centre
 * position = local + instanceOffset
 * ```
 *
 * The padding is per instance because the glow reach is (see
 * `instance-attributes.ts`), and it has to be: `quadPadding` in `sdf.ts` sizes a
 * quad from the glow it has to contain, so a shared padding would clip a large
 * shape's halo or waste fill rate on a small one. The ladder is the proof, with
 * reaches of 1, 10 and 100 world units in one family.
 *
 * ## The fragment stage
 *
 * `local` becomes an explicit VARYING, which is the one line in this file worth
 * reading twice. The distance functions in `sdf.ts` are written in a shape-centred
 * space in world units, and the antialiasing width is the screen-space gradient of
 * the POSITION in that same space (see `antialiasWidth`). Interpolating `local`
 * gives the fragment stage both: the distance is evaluated where the fragment
 * actually is, and its gradient is world units per device pixel. Handing the
 * fragment stage the raw geometry position instead would give a gradient in units
 * of the unit quad, so every outline would be the same fraction of a shape rather
 * than the same number of pixels, which is the exact property M4.2 exists to
 * demonstrate.
 *
 * A circle's radius is half its size's x component, which the union in
 * `instance-attributes.ts` guarantees: a circle instance carries a radius and its
 * size is derived from it, so the two cannot disagree.
 */
function createInstancedMaterial(
  family: ShapeFamily,
  style: SceneStyle,
): MeshBasicNodeMaterial {
  const offset = attribute<'vec2'>(OFFSET, 'vec2');
  const size = attribute<'vec2'>(SIZE, 'vec2');
  const cornerRadius = attribute<'float'>(CORNER_RADIUS, 'float');
  const glowWorld = attribute<'float'>(GLOW_WORLD, 'float');
  const fillColor = attribute<'vec3'>(FILL_COLOR, 'vec3');
  const glowColor = attribute<'vec3'>(GLOW_COLOR, 'vec3');

  // Through `tslArith`, so the expression the vertex shader evaluates is the one
  // `test/sdf.test.ts` executes over numbers. The `vec2` addition on the next
  // line stays here for the reason `quadPadding`'s docstring gives: widening
  // `Arith` with a vector operation for one call site is the cost the
  // nine-primitive count exists to keep visible.
  const padding = quadPadding(tslArith, glowWorld);
  const quad = add(size, mul(padding, 2));
  const local = varying(mul(positionGeometry.xy, quad));

  const distance =
    family === 'circle'
      ? circleSDF(local, mul(size.x, 0.5))
      : roundedRectSDF(local, size, cornerRadius);

  const shading = shapeShading({
    distance,
    position: local,
    fillColor,
    outlineColor: color(style.outlineColor),
    glowColor,
    glowAlpha: float(style.glowAlpha),
    outlinePixels: float(style.outlinePixels),
    glowWorld,
  });

  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(add(local, offset), 0);
  material.colorNode = shading.color;
  material.opacityNode = shading.alpha;
  // The same two flags every shape in this package draws with, and the same
  // reasons: alpha for the glow and the antialiasing ramps, and no depth write
  // because a transparent fragment that writes depth occludes whatever is drawn
  // behind it afterwards. The argument is M4.2's and M4.5 inherits it when it
  // layers edges behind nodes on the same z = 0 plane.
  material.transparent = true;
  material.depthWrite = false;
  return material;
}

/**
 * The instances a mesh of family `F` accepts, narrowed by the discriminant.
 *
 * `Extract` rather than a second union, so the two spellings of a family (the
 * mesh's and the instance's) cannot come apart: adding a shape kind to
 * {@link ShapeInstance} widens both at once.
 */
export type FamilyInstance<F extends ShapeFamily> = Extract<ShapeInstance, { kind: F }>;

/**
 * What {@link createInstancedShapes} needs to build one family's mesh.
 *
 * Generic over the family so that a caller who names it at construction, which
 * is every caller today, gets a COMPILE error for a circle handed to a rounded
 * rect mesh rather than the `RangeError` {@link requireShapeInstance} raises.
 * The runtime check stays for the data-driven caller M4.4 brings, where the
 * family comes out of a node's kind and the compiler has nothing to narrow.
 */
export interface InstancedShapesOptions<F extends ShapeFamily = ShapeFamily> {
  /** Which distance function the mesh draws with, and which instances it takes. */
  readonly family: F;
  /** The three uniforms every instance in this mesh shares. */
  readonly style: SceneStyle;
  /**
   * How many instances to allocate for up front. A caller that knows its node
   * count says so and never pays for a growth; the default is
   * `DEFAULT_INSTANCE_CAPACITY`.
   */
  readonly capacity?: number;
  /** Names this mesh in a `RangeError`, so a scene of two says which one. */
  readonly label?: string;
}

/**
 * One shape family, drawn instanced: a mesh, its buffers, and the handle
 * bookkeeping that keeps them consistent.
 *
 * A {@link GpuResource} in its own right, which is how it reaches
 * `webgpu-renderer.ts`'s dispose list. The geometry it owns is REPLACED on
 * growth, so a list of geometries and materials captured at construction would
 * hold a stale geometry and leak the live one: the renderer disposes this object
 * and this object knows what it is holding now.
 */
export class InstancedShapes<F extends ShapeFamily = ShapeFamily> implements GpuResource {
  readonly family: F;
  /**
   * The mesh to add to a `Scene`, typed with the geometry and material it
   * actually holds rather than as a bare `Mesh`.
   *
   * three's `Mesh` is generic over both, and naming them here is what lets a
   * caller read `mesh.geometry.instanceCount` without an `instanceof` narrow
   * first. `Mesh.material` is otherwise typed as one material OR an array of
   * them, which is the type narrowing `webgpu-renderer.ts` says a renderer
   * disposing resources should not be doing.
   */
  readonly mesh: Mesh<InstancedBufferGeometry, MeshBasicNodeMaterial>;

  readonly #label: string;
  readonly #buffer: InstanceBuffer;
  readonly #data: InstanceAttributeData;
  readonly #material: MeshBasicNodeMaterial;
  #geometry: InstancedBufferGeometry;
  /**
   * The six instance attributes of {@link #geometry}, in channel order.
   *
   * Cached rather than looked up per channel per write, because every write
   * touches all six and a `getAttribute` is a property lookup on a record: at
   * one write per node per frame under M4.6's springs that is six lookups
   * multiplied by the node count, for six references that only change when the
   * geometry does.
   */
  #attributes: InstancedBufferAttribute[] = [];

  /**
   * The span of slots written since the last frame, as two plain numbers.
   *
   * Inverted when there is nothing to upload, which is what makes "no writes
   * since the last draw" a comparison rather than a length check on an array
   * that had to be allocated to answer it.
   */
  #dirtyMin = Infinity;
  #dirtyMax = -Infinity;
  #disposed = false;

  constructor(options: InstancedShapesOptions<F>) {
    this.family = options.family;
    this.#label = options.label ?? options.family;
    const style = requireFamilyStyle(options.style, `${this.#label}.style`);
    this.#buffer = new InstanceBuffer(options.capacity);
    this.#data = new InstanceAttributeData(this.#buffer.capacity);
    this.#material = createInstancedMaterial(this.family, style);
    this.#geometry = this.#buildGeometry();
    this.mesh = new Mesh(this.#geometry, this.#material);
    // **Culling off, and it is not an optimisation being declined.** The
    // geometry is a unit quad at the origin, so its bounding sphere describes a
    // shape 1.4 world units across sitting at (0, 0), and three would cull the
    // entire mesh, every instance of it, the moment the origin left the frustum.
    // A bounding volume covering the instances would have to be recomputed on
    // every write; culling that is worth having is per instance and is M4.10's,
    // where there is a frame time to measure it against.
    this.mesh.frustumCulled = false;
    // The instance writes are uploaded from here, one merged range per channel,
    // because this is the last moment before a draw at which three will let this
    // object speak. See {@link #flushDirty}.
    this.mesh.onBeforeRender = (): void => {
      this.#flushDirty();
    };
  }

  /** How many instances are live, which is what the draw call covers. */
  get count(): number {
    return this.#buffer.count;
  }

  /** How many instances the buffers hold. See `instance-buffer.ts`. */
  get capacity(): number {
    return this.#buffer.capacity;
  }

  /**
   * Adds one instance and returns its HANDLE, which is the identity everything
   * downstream keys by. See the invariant in `instance-buffer.ts`: the slot it
   * happens to occupy is not durable and is not returned for that reason.
   */
  add(instance: FamilyInstance<F>): number {
    this.#assertLive('add');
    // **Validated BEFORE the slot is allocated, and the order is the fix rather
    // than a preference.** Allocating first left a rejected instance owning a
    // live handle over a slot nothing had written: `count` and the geometry's
    // `instanceCount` came apart, the phantom slot drew whatever floats were in
    // it, and a later removal swapped real data into it. Three reviewers found
    // it independently, one with a repro where a removed shape reappeared at its
    // old position after the next successful add. A caller that catches the
    // `RangeError`, which is exactly what M4.4 applying a delta does, saw no
    // error at all.
    //
    // The instance is validated once more inside `write`, which is a boundary of
    // its own for callers reaching the data module directly. That second pass is
    // comparisons rather than allocations, and buying atomicity with it is the
    // right way round.
    const field = this.#fieldForAdd(instance);
    requireShapeInstance(instance, this.family, field);

    const allocation = this.#buffer.allocate();
    if (allocation.grew) this.#grow(allocation.capacity);
    this.#data.write(allocation.slot, instance, this.family, field);
    this.#markDirty(allocation.slot);
    this.#geometry.instanceCount = this.#buffer.count;
    return allocation.handle;
  }

  /**
   * Replaces one instance's data in place, which is the path a moved or
   * recoloured node takes: no slot changes, so nothing else in the buffer is
   * touched and no other handle is affected.
   */
  set(handle: number, instance: FamilyInstance<F>): void {
    this.#assertLive('set');
    const slot = this.#buffer.slotOf(handle);
    const field = instance.label ?? `${this.#label}[handle ${String(handle)}]`;
    this.#data.write(slot, instance, this.family, field);
    this.#markDirty(slot);
  }

  /**
   * Removes one instance, moving the last one into its slot.
   *
   * The two halves have to agree, which is the whole reason `free` returns an
   * instruction: the bookkeeping says which handle moved and from where, and the
   * data follows it. Skipping the copy leaves one instance drawing another's
   * data with every handle still resolving correctly, which is a picture that is
   * wrong in a way no assertion about handles would catch.
   *
   * **BLEND ORDER WITHIN A FAMILY IS SLOT ORDER, AND A REMOVAL CHANGES IT.**
   * These materials are transparent with `depthWrite: false`, so two overlapping
   * instances blend in the order the draw call walks their slots, and
   * swap-with-last moves the last instance to wherever the hole is. Removing an
   * unrelated node can therefore flip which of two overlapping nodes reads as in
   * front, with nothing thrown. The fixed family order in
   * {@link createInstancedShapes} covers order BETWEEN families and cannot cover
   * this. M4.5 layers edges behind nodes and selection in front: it gets that
   * from separate meshes drawn in a chosen order, never from slot order within
   * one.
   */
  remove(handle: number): void {
    this.#assertLive('remove');
    const removal = this.#buffer.free(handle);
    if (removal.movedFrom !== null) this.#data.moveSlot(removal.movedFrom, removal.slot);
    if (removal.shrank) {
      // The arrays the attributes point at have been replaced, so the geometry
      // has to be rebuilt around the new ones. Resizing without this leaves the
      // mesh drawing from arrays nothing writes to any more, which is a picture
      // frozen at the moment of the shrink.
      this.#data.resize(removal.capacity);
      this.#replaceGeometry();
    }
    this.#geometry.instanceCount = removal.count;
    if (removal.movedFrom !== null) this.#markDirty(removal.slot);
  }

  /** Whether a handle is still live. */
  has(handle: number): boolean {
    return this.#buffer.hasHandle(handle);
  }

  /** Every live handle, in slot order. */
  handles(): readonly number[] {
    return this.#buffer.handles();
  }

  /**
   * Drops every instance, keeping the buffers at their current size. The path a
   * scene swap takes: `clear` then `add` the new graph, with one reallocation at
   * most instead of one per node.
   */
  clear(): void {
    this.#assertLive('clear');
    this.#buffer.clear();
    this.#geometry.instanceCount = 0;
  }

  /**
   * Gives back the capacity the live count does not need, rebuilding the
   * geometry at the smaller size.
   *
   * Explicit, because it costs a full re-upload and only a caller knows whether
   * it is about to add the instances back. {@link remove} shrinks on its own
   * hysteresis for the caller who never asks.
   */
  compact(): void {
    this.#assertLive('compact');
    const compaction = this.#buffer.compact();
    if (!compaction.shrank) return;
    this.#data.resize(compaction.capacity);
    this.#replaceGeometry();
  }

  /**
   * Frees the geometry and the material. Idempotent, on the same terms
   * `WebGPUSceneRenderer.dispose` states: a second call is an ordinary
   * consequence of a double unmount rather than a bug worth crashing for.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#geometry.dispose();
    this.#material.dispose();
  }

  /**
   * What a `RangeError` from {@link add} names.
   *
   * The instance's own label when it has one, and the mesh's label plus the
   * instance's position in the addition order when it does not. A caller that
   * names its instances (the ladder names every rung, and a graph has node ids)
   * gets `rect-100.cornerRadius`; one that does not gets the index of the add
   * that failed, which is a number it can count to. Not the SLOT, even though it
   * is the same integer here: a slot is not durable and naming one in a message
   * a reader might keep would teach exactly the wrong lesson.
   */
  #fieldForAdd(instance: ShapeInstance): string {
    return instance.label ?? `${this.#label}[instance ${String(this.#buffer.count)}]`;
  }

  /**
   * Reallocates the arrays and rebuilds the geometry around them.
   *
   * A whole new geometry rather than new attributes on the old one, because
   * three keys a GPU buffer to the attribute object that owns it: replacing an
   * attribute leaves the old buffer alive with nothing referencing it, where
   * disposing the geometry destroys every buffer it holds (three's
   * `Geometries._onGeometryDispose`). The cost is one re-upload of the instances
   * that survived, which is what a growth is anyway.
   */
  #grow(capacity: number): void {
    this.#data.resize(capacity);
    this.#replaceGeometry();
  }

  #replaceGeometry(): void {
    const previous = this.#geometry;
    this.#geometry = this.#buildGeometry();
    this.mesh.geometry = this.#geometry;
    previous.dispose();
    // Fresh attributes over fresh arrays, so every live slot is new to the GPU
    // and any span accumulated against the old ones describes buffers that no
    // longer exist.
    this.#dirtyMin = 0;
    this.#dirtyMax = Math.max(0, this.#buffer.count - 1);
  }

  #buildGeometry(): InstancedBufferGeometry {
    const geometry = new InstancedBufferGeometry();
    const quad = unitQuadAttributes();
    // Plain `BufferAttribute`s, because these are PER VERTEX: an
    // `InstancedBufferAttribute` here would advance them once per instance and
    // every quad after the first would read past the end of four vertices.
    geometry.setAttribute('position', new BufferAttribute(quad.position, 3));
    geometry.setAttribute('normal', new BufferAttribute(quad.normal, 3));
    geometry.setAttribute('uv', new BufferAttribute(quad.uv, 2));
    geometry.setIndex(new BufferAttribute(quad.index, 1));
    this.#attributes = INSTANCE_CHANNELS.map((channel) => {
      const attributeObject = new InstancedBufferAttribute(
        this.#data.channel(channel.name),
        channel.components,
      );
      geometry.setAttribute(channel.name, attributeObject);
      return attributeObject;
    });
    geometry.instanceCount = this.#buffer.count;
    return geometry;
  }

  /**
   * Tells three which slot of the instance arrays changed.
   *
   * Per write rather than through a `sync()` a caller has to remember: setting
   * `needsUpdate` bumps a version integer, and three compares versions once per
   * frame and uploads at most once however many writes went into it. There is
   * then no state where the buffers and the picture disagree because somebody
   * forgot the last call.
   *
   * **The update RANGE is what keeps that affordable at M4.10's numbers.**
   * `needsUpdate` alone re-uploads the whole of every channel, so one node
   * moving in a 10k graph would re-upload 480 KB, and M4.6's spring pass would
   * do it every frame however few nodes actually moved. Both backends honour
   * ranges and clear them after the upload (`WebGPUAttributeUtils` and
   * `WebGLAttributeUtils`), so a slot's twelve floats travel instead of the
   * buffer's hundred and twenty thousand. Ranges accumulate, which is what makes
   * a batch of additions one upload of a contiguous span rather than one per
   * add.
   */
  #markDirty(slot: number): void {
    if (slot < this.#dirtyMin) this.#dirtyMin = slot;
    if (slot > this.#dirtyMax) this.#dirtyMax = slot;
  }

  /**
   * Turns the span into ONE update range per channel, immediately before the
   * draw that needs it.
   *
   * **Coalesced, and the first attempt at this was worse than no ranges at
   * all.** `addUpdateRange` pushes a fresh record per call and neither backend
   * merges them, so a range per write meant a 10k-node spring pass carried 60k
   * range objects and 60k `writeBuffer` calls per frame in place of the one
   * 480 KB upload it was meant to replace. Measured by the reviewer who caught
   * it: 2,000 ranges after 1,000 adds and 1,000 sets. Two integers and one
   * range per channel per frame is the version that pays.
   *
   * A span rather than a set: writes at slot 0 and slot 9,999 upload everything
   * between them. That is the same buffer-wide upload the ranges exist to avoid,
   * so the win is on clustered writes (one node moving, a subtree settling, a
   * batch of additions, all of which are contiguous or nearly so) and the
   * scattered case is never worse than having no ranges at all.
   *
   * On `onBeforeRender`, which three calls at the top of `renderObject` before
   * it touches the geometry, so the ranges are in place for the upload that
   * follows and a caller has nothing to remember. `needsUpdate` is set here too,
   * which is what makes the whole path lazy: writes between two frames cost two
   * comparisons and nothing else.
   */
  #flushDirty(): void {
    if (this.#dirtyMax < this.#dirtyMin) return;
    const first = this.#dirtyMin;
    const span = this.#dirtyMax - first + 1;
    this.#dirtyMin = Infinity;
    this.#dirtyMax = -Infinity;
    INSTANCE_CHANNELS.forEach((channel, index) => {
      const attributeObject = this.#attributes[index];
      if (attributeObject === undefined) return;
      // Cleared before adding, so a frame that never drew cannot leave a range
      // behind for the next one to upload twice. Both backends clear after an
      // upload, which makes this belt to their braces.
      attributeObject.clearUpdateRanges();
      attributeObject.addUpdateRange(first * channel.components, span * channel.components);
      attributeObject.needsUpdate = true;
    });
  }

  #assertLive(method: string): void {
    if (this.#disposed) {
      throw new InstancedShapesDisposedError(method, this.#label);
    }
  }
}

/**
 * Builds the meshes for a set of instances, one per family present, and returns
 * them in a fixed family order so a caller's scene is deterministic.
 *
 * Groups by kind rather than taking a family per call, because the thing a
 * caller has is a list of shapes: a layout result, or the ladder. A family with
 * no instances gets no mesh, which keeps an empty draw call out of a scene that
 * only has boxes in it.
 *
 * The order is rounded rects then circles, and it is FIXED rather than
 * first-seen. Transparent coplanar geometry blends in draw order (see
 * `depthWrite` above), so a first-seen order would make the picture depend on
 * the order a caller happened to list its nodes in.
 */
export function createInstancedShapes(
  instances: readonly ShapeInstance[],
  styles: Partial<Readonly<Record<ShapeFamily, SceneStyle>>>,
  label = 'scene',
): InstancedShapes[] {
  const families: readonly ShapeFamily[] = ['roundedRect', 'circle'];
  const meshes: InstancedShapes[] = [];
  try {
    for (const family of families) {
      const members = instances.filter((instance) => instance.kind === family);
      if (members.length === 0) continue;
      const style = styles[family];
      // PARTIAL, so a caller drawing only boxes does not have to invent a circle
      // style. A style that is missing where instances need it is a
      // `RangeError` naming the family, which is the case a required record
      // turned into a fabricated default nobody validated and nothing read.
      if (style === undefined) {
        throw new RangeError(
          `styles.${family} is required: ${label} has ${String(members.length)} ${family} instances to draw`,
        );
      }
      const shapes = new InstancedShapes({
        family,
        style,
        capacity: members.length,
        label: `${label}.${family}`,
      });
      meshes.push(shapes);
      for (const member of members) shapes.add(member);
    }
  } catch (error) {
    // Every mesh built before the throw, and nothing else. `add` validates, so a
    // bad instance in the second family leaves the first family's geometry and
    // material allocated with no owner: the same guarantee `createRenderer`
    // makes about an aborted mount, applied one layer down.
    for (const mesh of meshes) mesh.dispose();
    throw error;
  }
  return meshes;
}

/**
 * The world box one instance's SHAPE occupies, which is not its quad.
 *
 * Here rather than in `instance-attributes.ts` because a {@link WorldBounds} is
 * the renderer's vocabulary and the packing module deals in floats. Extents
 * rather than a corner and a size, for the reason `types.ts` gives: a layout
 * rectangle with the opposite corner convention is otherwise assignable to it.
 */
export function instanceBounds(instance: ShapeInstance): WorldBounds {
  requireShapeInstance(instance, instance.kind, 'instance');
  const size = instanceSize(instance);
  return {
    minX: instance.center.x - size.width / 2,
    minY: instance.center.y - size.height / 2,
    maxX: instance.center.x + size.width / 2,
    maxY: instance.center.y + size.height / 2,
  };
}
