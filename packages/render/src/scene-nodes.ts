import { SceneDisposedError } from './errors.js';
import { InstancedShapes } from './instanced-scene.js';
import { requireShapeInstance } from './instance-attributes.js';
import type { SceneStyle, ShapeFamily, ShapeInstance } from './instance-attributes.js';
import type { GpuResource, Size, Vec2 } from './types.js';

/**
 * The seam M4.4 exists to name: a caller hands over NODES, and this keeps the
 * instance buffers agreeing with them.
 *
 * **A node's identity is its `id`, and a handle is this module's business.**
 * `instance-buffer.ts` states the invariant that per-instance state is keyed by
 * handle and never by slot; this file adds the layer above it, where the durable
 * name is the caller's own node id and the handle is what an id resolves to.
 * That is the mapping M4.4's ROADMAP entry asks for in as many words: one that
 * SURVIVES nodes being added and removed, so a node present in two consecutive
 * calls keeps its buffer slot's data rather than being freed and reallocated.
 *
 * Why that matters before anything animates: M4.6's springs and M4.7's delta
 * consumer key their state by handle, and a node that kept its id but got a new
 * handle would lose its velocity and jump. The property is worth having now,
 * while it costs a `Map` and a diff, rather than after something depends on it.
 *
 * **No three.js type appears in anything this file exports**, which is the rule
 * `types.ts` sets. {@link SceneNode} is plain numbers and two string unions, so
 * a caller names a node without installing three, and `@dagr/layout` is not a
 * dependency of this package: a `LayoutResult` does not appear here, and the
 * conversion from layout's y-down rectangles to world y-up centres stays with
 * the caller, which is where the y-flip has to be decided anyway (see
 * `camera.ts`).
 */

/** Which distance function draws a node. Two strings, so no three type escapes. */
export type NodeShape = ShapeFamily;

/**
 * One node to draw: where it is, how big, what shape, and the three colours
 * that are facts about it rather than about the drawing.
 *
 * Centre and size rather than extents, deliberately, and the opposite of what
 * {@link WorldBounds} argues for elsewhere in this package. The reason is that
 * this record is CONSTRUCTED per node by a caller converting a layout result,
 * and a layout result gives a centre and a size (see `@dagr/layout`'s
 * `PositionedNode`), so extents here would make every caller do the same two
 * subtractions and give two of them the chance to get the y sign wrong.
 * `WorldBounds` earns its shape where a region is CONSUMED, by an overlap test
 * or a fit; this is the producing end.
 *
 * `id` is the caller's, and the only thing this module treats as durable. Two
 * nodes with the same id in one call is a `RangeError`, because the second would
 * silently take the first's place and the picture would be short a node.
 */
export interface SceneNode {
  readonly id: string;
  readonly shape: NodeShape;
  /** The centre, in world units, y up. */
  readonly center: Vec2;
  /** The full size, in world units. A circle's has to be square. */
  readonly size: Size;
  /** The corner radius for a rounded rect, in world units. Ignored by a circle. */
  readonly cornerRadius?: number;
  /** The interior colour, as `0xRRGGBB`. */
  readonly fillColor: number;
  /** The halo's colour, as `0xRRGGBB`. */
  readonly glowColor: number;
  /** The halo's reach past the boundary, in world units. */
  readonly glowWorld: number;
}

/**
 * Where a node's instance lives: which family's mesh, and its handle in it.
 *
 * BOTH halves, because a handle alone does not identify a node. Each family
 * runs its own handle counter, so the first rounded rect and the first circle
 * are both handle 1, and this file's own test caught a `handleOf` that returned
 * the number alone claiming a shape change had not reallocated anything. M4.8's
 * picking pass reads a draw call and an instance index off the GPU, which is
 * this pair, so the pair is the shape that was always needed.
 */
export interface NodePlacement {
  readonly shape: NodeShape;
  readonly handle: number;
}

/**
 * The scene's nodes, across one instanced mesh per shape family.
 *
 * A {@link GpuResource}, so the renderer disposes this one object rather than
 * reaching into it for meshes and materials that get replaced when a buffer
 * grows.
 */
export class SceneNodes implements GpuResource {
  readonly #families: ReadonlyMap<NodeShape, InstancedShapes>;
  readonly #placements = new Map<string, NodePlacement>();
  #disposed = false;

  /**
   * Both families are built up front, even for a scene that has only boxes in
   * it.
   *
   * An `InstancedBufferGeometry` with an `instanceCount` of 0 is not drawn at
   * all (three returns no draw parameters for it), so an unused family costs one
   * material and a four-vertex quad and nothing per frame. Building lazily would
   * mean creating a mesh from inside `setNodes` and adding it to a `Scene` this
   * object does not hold, which is a reference in the wrong direction for one
   * saved material.
   */
  constructor(style: SceneStyle, capacity?: Readonly<Partial<Record<NodeShape, number>>>) {
    const families = new Map<NodeShape, InstancedShapes>();
    try {
      for (const shape of ['roundedRect', 'circle'] as const) {
        const wanted = capacity?.[shape];
        // PER FAMILY, and floored at 1. One count applied to both families
        // reserved twice what a mixed scene needs, which is not the "exactly
        // this many" the option promises, and a family with none of a scene's
        // nodes in it asked for a capacity of 0, which `InstanceBuffer` rejects:
        // `createRenderer({ canvas, nodes: [] })` threw a `RangeError` naming an
        // option the caller never wrote.
        //
        // Spread rather than `capacity: wanted`, because the package compiles
        // with `exactOptionalPropertyTypes` and an explicit `undefined` is not
        // the same thing as an absent key.
        families.set(
          shape,
          new InstancedShapes({
            family: shape,
            style,
            label: `nodes.${shape}`,
            ...(wanted === undefined ? {} : { capacity: Math.max(1, wanted) }),
          }),
        );
      }
    } catch (error) {
      // A bad style is rejected by the first family, and the second never
      // existed; a bad capacity by both. Either way what was built is disposed,
      // on the guarantee `createRenderer` makes one layer up: a caller never has
      // to dispose something it did not receive.
      for (const built of families.values()) built.dispose();
      throw error;
    }
    this.#families = families;
  }

  /** The meshes to add to a `Scene`, in a fixed family order. See `instanced-scene.ts`. */
  get meshes(): readonly InstancedShapes['mesh'][] {
    return [...this.#families.values()].map((family) => family.mesh);
  }

  /** How many nodes are on screen. */
  get nodeCount(): number {
    return this.#placements.size;
  }

  /**
   * Replaces the scene's nodes with this list, keeping the instances of nodes
   * that are in both.
   *
   * **The diff is the point.** Clearing and re-adding would be shorter, would
   * produce the same picture today, and would hand every node a new handle on
   * every call, which is exactly the property M4.4 is asked to provide and
   * M4.6's springs depend on. A node that is in both lists is UPDATED in place:
   * same handle, same slot, twelve floats overwritten.
   *
   * Removals run before additions, so a node leaving frees a slot an arriving
   * node can take and a scene that swaps its contents wholesale does not grow
   * its buffers to twice what it needs.
   *
   * A node whose SHAPE changed is a removal and an addition, because the two
   * families are two meshes and an instance cannot move between them. Its handle
   * changes, which is the one case where the guarantee above cannot hold, and it
   * is stated rather than hidden: per-instance state keyed to that node has to be
   * rebuilt, and a caller animating a shape change is asking for a discontinuity
   * whatever this module does.
   */
  setNodes(nodes: readonly SceneNode[]): void {
    this.#assertLive('setNodes');
    const incoming = new Map<
      string,
      { node: SceneNode; instance: ShapeInstance; family: InstancedShapes }
    >();
    for (const node of nodes) {
      if (incoming.has(node.id)) {
        throw new RangeError(`two nodes share the id ${node.id}, so one would replace the other`);
      }
      // **Converted AND validated before anything is touched.** The first
      // version validated as it wrote, so a bad node halfway down the list threw
      // after the removal loop had already run: a scene given a good node and a
      // circle with a non-square size was left holding neither, one removed and
      // one never added. A caller that catches the `RangeError`, which is the
      // delta path this method exists for, then draws a silently short picture.
      // Two passes over the list is the price of the call being all or nothing.
      const instance = toInstance(node);
      // The FAMILY is resolved here too, and that is not tidiness: it was the
      // one fallible step left in the mutating half. `toInstance` falls through
      // to the rounded rect branch for a shape it does not know, so a node whose
      // `shape` is neither of the two (a data-driven field, or a JavaScript
      // caller) validated clean and then threw out of `#family` with the
      // removals already applied. Unreachable from this repo, where every shape
      // is a literal, and a guarantee gap all the same.
      incoming.set(node.id, {
        node,
        instance: requireShapeInstance(instance, instance.kind, node.id),
        family: this.#family(node.shape),
      });
    }

    for (const [id, placement] of this.#placements) {
      const entry = incoming.get(id);
      if (entry === undefined || entry.node.shape !== placement.shape) {
        this.#family(placement.shape).remove(placement.handle);
        this.#placements.delete(id);
      }
    }

    for (const [id, { node, instance, family }] of incoming) {
      const placement = this.#placements.get(id);
      if (placement === undefined) {
        this.#placements.set(id, { shape: node.shape, handle: family.add(instance) });
      } else {
        family.set(placement.handle, instance);
      }
    }
  }

  /**
   * Which mesh and which handle a node id resolves to, or `undefined` for a node
   * this scene does not hold.
   *
   * `undefined` rather than a throw, because the caller with a use for this is
   * M4.8's picking pass going the other way and M5's hover, both of which ask
   * about ids that may have left the scene between a pointer event and the frame
   * that answers it. The handle itself throws when it is stale, which is the
   * failure worth being loud about.
   *
   * NOT on the `Renderer` interface, deliberately. M4.4 has no use for it and
   * M4.8 is the task that knows what a picking pass needs; exporting a lookup
   * before then would be the guess at a seam that P3 declined to make about the
   * instance API. It is here because it is the only way to state this module's
   * central property as a test.
   */
  placementOf(id: string): NodePlacement | undefined {
    return this.#placements.get(id);
  }

  /** Frees both families' geometries and materials. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const family of this.#families.values()) family.dispose();
  }

  #family(shape: NodeShape): InstancedShapes {
    const family = this.#families.get(shape);
    if (family === undefined) throw new RangeError(`no mesh for the ${shape} shape`);
    return family;
  }

  #assertLive(method: string): void {
    if (this.#disposed) {
      throw new SceneDisposedError(method, 'scene nodes');
    }
  }
}

/**
 * A node as the instance buffers want it.
 *
 * The circle branch takes HALF THE WIDTH as the radius and requires the size to
 * be square, which is the one place the public record is looser than the
 * internal one. `ShapeInstance` is a union carrying a radius for a circle
 * precisely so a circle's width and height cannot disagree, and a caller
 * converting a layout result has a width and a height in hand; requiring them to
 * halve one and pick which is a worse trade than checking here.
 */
function toInstance(node: SceneNode): ShapeInstance {
  if (node.shape === 'circle') {
    if (node.size.width !== node.size.height) {
      throw new RangeError(
        `${node.id}.size has to be square for a circle, got ${String(node.size.width)} by ${String(node.size.height)}`,
      );
    }
    return {
      kind: 'circle',
      label: node.id,
      center: node.center,
      radius: node.size.width / 2,
      fillColor: node.fillColor,
      glowColor: node.glowColor,
      glowWorld: node.glowWorld,
    };
  }
  return {
    kind: 'roundedRect',
    label: node.id,
    center: node.center,
    size: node.size,
    cornerRadius: node.cornerRadius ?? 0,
    fillColor: node.fillColor,
    glowColor: node.glowColor,
    glowWorld: node.glowWorld,
  };
}
