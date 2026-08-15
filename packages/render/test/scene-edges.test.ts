import { AttributeNode, Color } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { SceneEdges } from '../src/scene-edges.js';
import type { SceneEdge, SceneEdgeGroup } from '../src/scene-edges.js';
import type { Vec2 } from '../src/types.js';

/**
 * The edge seam, built with no device.
 *
 * Everything here runs the real classes: a `BufferGeometry`, a
 * `MeshBasicNodeMaterial` and a `Mesh` all construct in Node, and the TSL graph
 * the material carries builds without a renderer, exactly as
 * `test/scene-nodes.test.ts` establishes for the instanced path. What no test
 * in this process can see is a pixel, so the assertions here are about the
 * BUFFERS and the wiring: the arithmetic they are filled from is executed in
 * `test/ribbon.test.ts`.
 *
 * The two properties this file exists for, both of which are about the shape of
 * the seam rather than about the picture:
 *
 * - **A group is a mesh**, in declaration order, because that order is the only
 *   layering this package offers (M4.3: slot order within one mesh is not
 *   durable).
 * - **Style is not geometry.** `setStyle` writes uniforms and touches no
 *   buffer, which is what lets a draw loop clamp the width against the zoom
 *   every frame without re-tessellating anything.
 */

const ROUTED = 'routed';
const OVERLAY = 'overlay';

/** The two groups the campaign demo declares: dashed routed edges, solid overlay lines. */
function groups(): SceneEdgeGroup[] {
  return [
    {
      id: ROUTED,
      style: {
        halfWidthPixels: 1.5,
        dash: { periodPixels: 12, duty: 0.55, speedPixelsPerSecond: 24 },
      },
    },
    { id: OVERLAY, style: { halfWidthPixels: 1 }, curve: 'smooth' },
  ];
}

function edge(id: string, points: readonly Vec2[], color = 0xffb703): SceneEdge {
  return { id, points, color };
}

/** A straight two point route, which tessellates to four vertices and two triangles. */
const straight: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

/** The attribute array a group's mesh carries, by name. */
function attributeOf(scene: SceneEdges, index: number, name: string): Float32Array {
  const mesh = scene.meshes[index];
  if (mesh === undefined) throw new Error('unreachable: no mesh at that index');
  const attribute = mesh.geometry.getAttribute(name);
  const array = attribute?.array;
  if (!(array instanceof Float32Array)) throw new Error(`no ${name} attribute`);
  return array;
}

/**
 * Every geometry attribute a node graph reads, by name.
 *
 * `Node.traverse` walks the tree three itself walks when it decides which
 * vertex buffers a pipeline binds, which is the same question the attribute
 * table's slot count is an answer to. The name lives on a private field with a
 * public getter that wants a builder, so this reads the getter with an empty
 * one: what it needs is the declared name, and an `AttributeNode` given one
 * returns it without consulting anything.
 */
function attributesIn(node: Node | null): string[] {
  if (node === null) return [];
  const names: string[] = [];
  node.traverse((child) => {
    if (child instanceof AttributeNode) names.push(child.getAttributeName({} as never));
  });
  return names;
}

describe('SceneEdges', () => {
  it('builds one mesh per group, in declaration order', () => {
    // The order IS the layering: the renderer adds these to the scene in this
    // order and the first is drawn first, which is how dashed routed edges end
    // up under solid overlay lines.
    const scene = new SceneEdges(groups());
    expect(scene.meshes).toHaveLength(2);
    expect(scene.meshes[0]).not.toBe(scene.meshes[1]);
    scene.dispose();
  });

  it('draws nothing until it is given edges', () => {
    // An empty group is a material and an empty geometry, and three skips a
    // draw whose index count is zero, so a scene can declare groups it has no
    // edges for yet.
    const scene = new SceneEdges(groups());
    for (const mesh of scene.meshes) {
      expect(mesh.geometry.drawRange.count).toBe(0);
    }
    scene.dispose();
  });

  it('fills a group\'s buffers from its routes', () => {
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    // Four vertices and two triangles, which is what `test/ribbon.test.ts`
    // pins for a straight two point route.
    expect(attributeOf(scene, 0, 'ribbonPosition')).toHaveLength(8);
    expect(attributeOf(scene, 0, 'ribbonAcross')).toHaveLength(4);
    expect(scene.meshes[0]?.geometry.drawRange.count).toBe(6);
    scene.dispose();
  });

  it('leaves the other groups alone', () => {
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    expect(scene.meshes[1]?.geometry.drawRange.count).toBe(0);
    scene.dispose();
  });

  it('writes each route\'s colour over its own slice, converted to linear', () => {
    // A colour reaching a shader as an ATTRIBUTE is converted by nothing, which
    // M4.3 learned the expensive way: as a uniform three's `Color` does sRGB to
    // linear on the way in. So the assertion is against a real `Color` rather
    // than against a copy of the formula.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight, 0xffb703), edge('e2', straight, 0x023047)]);
    const colors = attributeOf(scene, 0, 'ribbonColor');
    const amber = new Color(0xffb703);
    const navy = new Color(0x023047);

    // Four vertices each, and the ranges are contiguous and in input order.
    for (let vertex = 0; vertex < 4; vertex += 1) {
      expect(colors[vertex * 3]).toBeCloseTo(amber.r, 6);
      expect(colors[vertex * 3 + 1]).toBeCloseTo(amber.g, 6);
      expect(colors[vertex * 3 + 2]).toBeCloseTo(amber.b, 6);
    }
    for (let vertex = 4; vertex < 8; vertex += 1) {
      expect(colors[vertex * 3]).toBeCloseTo(navy.r, 6);
      expect(colors[vertex * 3 + 1]).toBeCloseTo(navy.g, 6);
      expect(colors[vertex * 3 + 2]).toBeCloseTo(navy.b, 6);
    }
    scene.dispose();
  });

  it('gives a route that cannot be drawn an empty slice rather than a wrong colour', () => {
    // A self loop is two identical points, which tessellates to nothing. The
    // colours of the routes AFTER it must still land on their own vertices: a
    // colour walk that counted routes rather than reading their ranges would
    // put every colour one route out from here on.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [
      edge('loop', [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
      edge('e2', straight, 0x023047),
    ]);
    const colors = attributeOf(scene, 0, 'ribbonColor');
    const navy = new Color(0x023047);
    expect(colors).toHaveLength(12);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      expect(colors[vertex * 3 + 2]).toBeCloseTo(navy.b, 6);
    }
    scene.dispose();
  });

  it('replaces a group\'s edges rather than appending to them', () => {
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight), edge('e2', straight)]);
    expect(attributeOf(scene, 0, 'ribbonAcross')).toHaveLength(8);
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    expect(attributeOf(scene, 0, 'ribbonAcross')).toHaveLength(4);
    scene.dispose();
  });

  it('disposes the geometry it replaces, rather than leaking its buffers', () => {
    // three keys a GPU buffer to the attribute OBJECT and frees buffers on the
    // GEOMETRY's dispose event, for the attributes it holds at that moment.
    // Replacing attributes in place therefore leaves five buffers alive per
    // rebuild with nothing referencing them, on a call made at every re-layout
    // and every recolour. `instanced-scene.ts` documents the same hazard and
    // builds a new geometry for the same reason.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    const first = scene.meshes[0]?.geometry;
    if (first === undefined) throw new Error('unreachable');

    let disposals = 0;
    first.addEventListener('dispose', () => {
      disposals += 1;
    });
    scene.setEdges(ROUTED, [edge('e1', straight), edge('e2', straight)]);

    expect(disposals).toBe(1);
    expect(scene.meshes[0]?.geometry).not.toBe(first);
    scene.dispose();
  });

  it('takes a style without touching a buffer, which is the per-frame path', () => {
    // The property the whole split exists for: a draw loop clamps the width
    // against the zoom on every frame, and re-tessellating 7,100 routes to
    // change a uniform is the thing that would make that unaffordable.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    const before = attributeOf(scene, 0, 'ribbonPosition');
    scene.setStyle(ROUTED, { halfWidthPixels: 4, alpha: 0.5, dashFlowPixels: 30 });
    expect(attributeOf(scene, 0, 'ribbonPosition')).toBe(before);
    scene.dispose();
  });

  it('rejects a group it never declared, naming it', () => {
    const scene = new SceneEdges(groups());
    expect(() => scene.setEdges('nope', [])).toThrow(/"nope"/);
    expect(() =>
      scene.setStyle('nope', { halfWidthPixels: 1, alpha: 1 }),
    ).toThrow(/"nope"/);
    scene.dispose();
  });

  it('rejects two groups with one id, because the second would be unaddressable', () => {
    expect(
      () => new SceneEdges([...groups(), { id: ROUTED, style: { halfWidthPixels: 2 } }]),
    ).toThrow(/"routed"/);
  });

  it('rejects a style a ribbon cannot be drawn with, naming the group', () => {
    expect(() => new SceneEdges([{ id: 'thin', style: { halfWidthPixels: 0.1 } }])).toThrow(
      /group "thin"\.style\.halfWidthPixels/,
    );
  });

  it('is idempotent on dispose, and refuses use afterwards', () => {
    const scene = new SceneEdges(groups());
    scene.dispose();
    scene.dispose();
    expect(() => scene.setEdges(ROUTED, [])).toThrow(/setEdges/);
    expect(() =>
      scene.setStyle(ROUTED, { halfWidthPixels: 1, alpha: 1 }),
    ).toThrow(/setStyle/);
  });

  it('hides a group faded to nothing rather than rasterising it', () => {
    // At the campaign's fitted zoom the overlay group's alpha is zero, and
    // that is 3,137 smooth routes transformed every frame to write nothing.
    // The buffers stay, so coming back is a uniform write.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    expect(scene.meshes[0]?.visible).toBe(true);
    scene.setStyle(ROUTED, { halfWidthPixels: 2, alpha: 0 });
    expect(scene.meshes[0]?.visible).toBe(false);
    scene.setStyle(ROUTED, { halfWidthPixels: 2, alpha: 0.2 });
    expect(scene.meshes[0]?.visible).toBe(true);
    scene.dispose();
  });

  it('floors a frame\'s width where a declared style is floored', () => {
    // A frame asking for 0.01 would otherwise walk straight through the check
    // the group's own style had to pass.
    const scene = new SceneEdges(groups());
    expect(() => scene.setStyle(ROUTED, { halfWidthPixels: 0.1, alpha: 1 })).toThrow(
      /halfWidthPixels/,
    );
    expect(() => scene.setStyle(ROUTED, { halfWidthPixels: 2, alpha: 1.5 })).toThrow(/alpha/);
    expect(() => scene.setStyle(ROUTED, { halfWidthPixels: 2, alpha: -0.1 })).toThrow(/alpha/);
    scene.dispose();
  });

  it('takes the pixels per world unit from the renderer, not from a caller', () => {
    // The uniform a caller would otherwise have to re-derive from a camera the
    // renderer already holds, with a default that draws at world scale and so
    // shows nothing while raising nothing.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    expect(() => scene.setPixelsPerWorldUnit(2.5)).not.toThrow();
    scene.dispose();
    expect(() => scene.setPixelsPerWorldUnit(2.5)).toThrow(/setPixelsPerWorldUnit/);
  });

  it('reads the intensity in BOTH stages, which no buffer assertion can see', () => {
    // The one claim in this file that is about the SHADER rather than the
    // buffers, and it is here because the failure it catches is silent: an
    // intensity wired into the alpha and not the width dims an edge without
    // thinning it, which is exactly the half-feature the channel exists to
    // avoid, and every test above would still pass. A structural check in the
    // spirit of `test/ribbon-nodes.test.ts`: the attribute has to be reachable
    // from the vertex position AND from the opacity.
    const scene = new SceneEdges(groups());
    const material = scene.meshes[0]?.material;
    if (material === undefined) throw new Error('unreachable: no material');
    expect(attributesIn(material.positionNode)).toContain('ribbonIntensity');
    expect(attributesIn(material.opacityNode)).toContain('ribbonIntensity');
    // And the sanity check that the walk finds anything at all, so a broken
    // traversal cannot make the two assertions above vacuous.
    expect(attributesIn(material.positionNode)).toContain('ribbonPosition');
    scene.dispose();
  });

  it('starts every edge at full intensity, which is the group\'s own drawing', () => {
    // A group nobody has highlighted draws exactly as it did before the channel
    // existed: the shader multiplies width and alpha by this, so anything but
    // one here would change every scene in the package.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight), edge('e2', straight)]);
    const intensity = attributeOf(scene, 0, 'ribbonIntensity');
    expect(intensity).toHaveLength(8);
    expect([...intensity]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    scene.dispose();
  });

  it('writes one intensity over one edge\'s own vertices', () => {
    // The whole feature: a highlight is a SLICE write, keyed by the id the
    // caller already has, into the ranges the tessellator returned.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight), edge('e2', straight)]);
    scene.setEdgeIntensity(ROUTED, (id) => (id === 'e1' ? 1 : 0.25));
    expect([...attributeOf(scene, 0, 'ribbonIntensity')]).toEqual([
      1, 1, 1, 1, 0.25, 0.25, 0.25, 0.25,
    ]);
    scene.dispose();
  });

  it('touches no other buffer, which is what makes a hover affordable', () => {
    // The same property `setStyle` has and for the same reason: at 7,100 routes
    // a highlight that rebuilt geometry would re-tessellate the scene on every
    // pointer move.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    const position = attributeOf(scene, 0, 'ribbonPosition');
    const color = attributeOf(scene, 0, 'ribbonColor');
    scene.setEdgeIntensity(ROUTED, () => 0.5);
    expect(attributeOf(scene, 0, 'ribbonPosition')).toBe(position);
    expect(attributeOf(scene, 0, 'ribbonColor')).toBe(color);
    scene.dispose();
  });

  it('uploads one merged range covering only what changed', () => {
    // Two integers and one range, which is the lesson M4.3 paid for:
    // `addUpdateRange` pushes a record per call and neither backend merges
    // them, so a range per edge is worse than no ranges at all.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight), edge('e2', straight), edge('e3', straight)]);
    const mesh = scene.meshes[0];
    if (mesh === undefined) throw new Error('unreachable');
    const attribute = mesh.geometry.getAttribute('ribbonIntensity');
    if (attribute === undefined) throw new Error('unreachable');

    // The middle edge alone: vertices 4 to 7 of twelve.
    const version = attribute.version;
    scene.setEdgeIntensity(ROUTED, (id) => (id === 'e2' ? 0.5 : 1));
    mesh.onBeforeRender(
      ...([] as unknown as Parameters<typeof mesh.onBeforeRender>),
    );
    expect(attribute.updateRanges).toEqual([{ start: 4, count: 4 }]);
    // `needsUpdate` is write-only on a `BufferAttribute` and bumps `version`,
    // which is what three compares once per frame to decide on an upload.
    expect(attribute.version).toBe(version + 1);
    scene.dispose();
  });

  it('uploads nothing when the values did not change', () => {
    // A pointer moving between two nodes leaves most edges exactly where they
    // were, and at 7,100 edges the alternative is a full upload per move.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight), edge('e2', straight)]);
    const mesh = scene.meshes[0];
    if (mesh === undefined) throw new Error('unreachable');
    const attribute = mesh.geometry.getAttribute('ribbonIntensity');
    if (attribute === undefined) throw new Error('unreachable');
    scene.setEdgeIntensity(ROUTED, () => 1);
    mesh.onBeforeRender(
      ...([] as unknown as Parameters<typeof mesh.onBeforeRender>),
    );
    expect(attribute.updateRanges).toEqual([]);
    scene.dispose();
  });

  it('resets a highlight when the edges are replaced', () => {
    // The ids and their vertex counts both changed, so a carried-over highlight
    // would land on whatever edge now occupies those vertices.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    scene.setEdgeIntensity(ROUTED, () => 0.25);
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    expect([...attributeOf(scene, 0, 'ribbonIntensity')]).toEqual([1, 1, 1, 1]);
    scene.dispose();
  });

  it('has nothing to write for a group whose edges have not arrived', () => {
    // Not an error: the ids a caller would name do not exist yet, so there is
    // nothing it could have got wrong.
    const scene = new SceneEdges(groups());
    expect(() => scene.setEdgeIntensity(ROUTED, () => 0.5)).not.toThrow();
    scene.dispose();
  });

  it('rejects an intensity a ribbon cannot be drawn at, naming the edge', () => {
    // The range matters more here than for an alpha: this one scales the WIDTH,
    // and a negative value would fold a ribbon's two sides through each other
    // rather than clamping somewhere invisible.
    const scene = new SceneEdges(groups());
    scene.setEdges(ROUTED, [edge('e1', straight)]);
    expect(() => scene.setEdgeIntensity(ROUTED, () => -0.1)).toThrow(/"e1"/);
    expect(() => scene.setEdgeIntensity(ROUTED, () => 1.5)).toThrow(/\[0, 1\]/);
    expect(() => scene.setEdgeIntensity(ROUTED, () => Number.NaN)).toThrow(/"e1"/);
    expect(() => scene.setEdgeIntensity('nope', () => 1)).toThrow(/"nope"/);
    scene.dispose();
    expect(() => scene.setEdgeIntensity(ROUTED, () => 1)).toThrow(/setEdgeIntensity/);
  });

  it('opts its meshes out of frustum culling', () => {
    // A ribbon is drawn up to its half width outside its centreline, in PIXELS,
    // which no bounding sphere knows. The alternative to opting out is edges
    // vanishing at the frame's edge before their centreline does.
    const scene = new SceneEdges(groups());
    for (const mesh of scene.meshes) expect(mesh.frustumCulled).toBe(false);
    scene.dispose();
  });
});
