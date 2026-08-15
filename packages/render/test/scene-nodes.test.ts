import { describe, expect, it } from 'vitest';
import type { SceneStyle } from '../src/instance-attributes.js';
import { DagrRenderError, SceneDisposedError } from '../src/errors.js';
import { SceneNodes } from '../src/scene-nodes.js';
import type { SceneNode } from '../src/scene-nodes.js';

/**
 * The id-to-handle mapping M4.4 owed the tasks after it.
 *
 * One property carries this file: a node present in two consecutive `setNodes`
 * calls keeps its instance handle. Everything M4.6 and M4.8 key by handle
 * depends on it, and the failure is invisible in a picture, since a scene that
 * cleared and re-added every node draws exactly the same frame and loses every
 * spring's velocity.
 */

const style: SceneStyle = { outlineColor: 0x023047, glowAlpha: 0.45, outlinePixels: 2 };

function node(id: string, x = 0, shape: SceneNode['shape'] = 'roundedRect'): SceneNode {
  return {
    id,
    shape,
    center: { x, y: -x },
    size: shape === 'circle' ? { width: 40, height: 40 } : { width: 100, height: 40 },
    cornerRadius: 4,
    fillColor: 0xffb703,
    glowColor: 0xfb8500,
    glowWorld: 10,
  };
}

/**
 * The x offset of the only instance in a family's buffer.
 *
 * Only usable where the test has put exactly one node in that family, which is
 * deliberate: a slot index is not durable (see `instance-buffer.ts`), so a
 * helper that took a handle and guessed at a slot would be teaching the mistake
 * this package is arranged to prevent.
 */
function onlyOffset(scene: SceneNodes, shape: SceneNode['shape']): number {
  const mesh = scene.meshes[shape === 'roundedRect' ? 0 : 1];
  if (mesh === undefined) throw new Error('unreachable');
  expect(mesh.geometry.instanceCount).toBe(1);
  return mesh.geometry.getAttribute('instanceOffset').getX(0);
}

describe('setNodes', () => {
  it('draws every node it is given, across both shape families', () => {
    const scene = new SceneNodes(style);
    scene.setNodes([node('a'), node('b', 100), node('c', 200, 'circle')]);
    expect(scene.nodeCount).toBe(3);
    expect(scene.meshes[0]?.geometry.instanceCount).toBe(2);
    expect(scene.meshes[1]?.geometry.instanceCount).toBe(1);
    scene.dispose();
  });

  it('KEEPS a node handle across calls, which is the property M4.6 depends on', () => {
    // The whole file. Clearing and re-adding draws the same frame and hands
    // every node a new handle, so a spring's velocity, keyed by handle, would be
    // lost on every relayout and every node would jump.
    const scene = new SceneNodes(style);
    scene.setNodes([node('a'), node('b', 100)]);
    const before = scene.placementOf('a');
    scene.setNodes([node('a', 500), node('b', 100), node('c', 900)]);
    expect(scene.placementOf('a')).toBe(before);
    expect(scene.placementOf('a')).toBeDefined();
    scene.dispose();
  });

  it('moves a node in place rather than reallocating it', () => {
    const scene = new SceneNodes(style);
    scene.setNodes([node('a')]);
    const placement = scene.placementOf('a');
    scene.setNodes([node('a', 777)]);
    expect(scene.placementOf('a')).toEqual(placement);
    expect(onlyOffset(scene, 'roundedRect')).toBe(777);
    scene.dispose();
  });

  it('drops a node that is not in the new list', () => {
    const scene = new SceneNodes(style);
    scene.setNodes([node('a'), node('b', 100)]);
    scene.setNodes([node('b', 100)]);
    expect(scene.nodeCount).toBe(1);
    expect(scene.placementOf('a')).toBeUndefined();
    expect(scene.placementOf('b')).toBeDefined();
    expect(scene.meshes[0]?.geometry.instanceCount).toBe(1);
    scene.dispose();
  });

  it('keeps the surviving node drawing its OWN data after a removal', () => {
    // Swap-with-last moves the last instance into the freed slot, and the data
    // has to follow the handle. This is that claim one layer up, where a caller
    // would notice it as two nodes swapping places.
    const scene = new SceneNodes(style);
    scene.setNodes([node('a', 10), node('b', 20), node('c', 30)]);
    scene.setNodes([node('a', 10), node('c', 30)]);
    const offsets = scene.meshes[0]?.geometry.getAttribute('instanceOffset');
    const xs = [offsets?.getX(0), offsets?.getX(1)];
    expect(xs).toEqual([10, 30]);
    scene.dispose();
  });

  it('empties to nothing and refills', () => {
    const scene = new SceneNodes(style);
    scene.setNodes([node('a'), node('b', 100)]);
    scene.setNodes([]);
    expect(scene.nodeCount).toBe(0);
    expect(scene.meshes[0]?.geometry.instanceCount).toBe(0);
    scene.setNodes([node('c', 5)]);
    expect(scene.nodeCount).toBe(1);
    scene.dispose();
  });

  it('treats a shape change as a removal and an addition, and says so', () => {
    // The one case where the handle cannot survive: the two families are two
    // meshes and an instance cannot move between them.
    const scene = new SceneNodes(style);
    scene.setNodes([node('a')]);
    const before = scene.placementOf('a');
    expect(before?.shape).toBe('roundedRect');
    scene.setNodes([node('a', 0, 'circle')]);
    // The SHAPE is what changed, and it is why the handle could not be kept:
    // each family runs its own handle counter, so the numbers can even coincide.
    expect(scene.placementOf('a')?.shape).toBe('circle');
    expect(scene.meshes[0]?.geometry.instanceCount).toBe(0);
    expect(scene.meshes[1]?.geometry.instanceCount).toBe(1);
    scene.dispose();
  });

  it('rejects two nodes sharing an id, rather than losing one of them', () => {
    const scene = new SceneNodes(style);
    expect(() => scene.setNodes([node('a'), node('a', 100)])).toThrow(RangeError);
    expect(() => scene.setNodes([node('a'), node('a', 100)])).toThrow(/two nodes share the id a/);
    scene.dispose();
  });

  it('rejects a circle whose size is not square, naming the node', () => {
    // A circle carries one radius, so a non-square size would draw a circle of
    // the wrong radius inside a quad of the right height and look deliberate.
    const scene = new SceneNodes(style);
    const oval: SceneNode = { ...node('oval', 0, 'circle'), size: { width: 40, height: 20 } };
    expect(() => scene.setNodes([oval])).toThrow(RangeError);
    expect(() => scene.setNodes([oval])).toThrow(/oval\.size/);
    scene.dispose();
  });

  it('names the node in a RangeError from its own numbers', () => {
    const scene = new SceneNodes(style);
    const bad: SceneNode = { ...node('chapter-3'), cornerRadius: 90 };
    expect(() => scene.setNodes([bad])).toThrow(/chapter-3\.cornerRadius/);
    scene.dispose();
  });

  it('holds a campaign-sized scene without growing, when told the count up front', () => {
    const nodes = Array.from({ length: 3010 }, (_, i) => node(`n${String(i)}`, i));
    const scene = new SceneNodes(style, { roundedRect: nodes.length });
    scene.setNodes(nodes);
    expect(scene.nodeCount).toBe(3010);
    expect(scene.meshes[0]?.geometry.getAttribute('instanceOffset').count).toBe(3010);
    scene.dispose();
  });

  it('is ALL OR NOTHING: a bad node leaves the scene exactly as it was', () => {
    // The first version validated as it wrote, so a bad node halfway down the
    // list threw after the removal loop had run and left the scene holding
    // neither the node that left nor the one that arrived. A caller that catches
    // the RangeError, which is the delta path this method exists for, then draws
    // a silently short picture.
    const scene = new SceneNodes(style);
    scene.setNodes([node('a'), node('b', 100)]);
    const before = [scene.placementOf('a'), scene.placementOf('b')];

    const oval: SceneNode = { ...node('c', 0, 'circle'), size: { width: 40, height: 20 } };
    expect(() => scene.setNodes([node('a'), oval])).toThrow(RangeError);
    expect(scene.nodeCount).toBe(2);
    expect(scene.placementOf('b')).toEqual(before[1]);
    expect(scene.placementOf('a')).toEqual(before[0]);
    expect(scene.placementOf('c')).toBeUndefined();
    expect(scene.meshes[0]?.geometry.instanceCount).toBe(2);

    // And a bad NUMBER, not only a bad shape, on the same terms.
    expect(() => scene.setNodes([{ ...node('a'), cornerRadius: 900 }])).toThrow(RangeError);
    expect(scene.nodeCount).toBe(2);
    scene.dispose();
  });

  it('changes NOTHING for a shape it does not know, rather than tearing', () => {
    // The last fallible step that lived in the mutating half. `toInstance` falls
    // through to the rounded rect branch for an unknown shape, so such a node
    // validated clean and then threw out of the family lookup with the removals
    // already applied. Unreachable from TypeScript, where the shapes are two
    // string literals; reachable from a JavaScript caller or a data-driven
    // field, which is what M4.7's delta path will be.
    const scene = new SceneNodes(style);
    scene.setNodes([node('a'), node('b', 100)]);
    const before = [scene.placementOf('a'), scene.placementOf('b')];
    const alien = { ...node('c'), shape: 'hexagon' } as unknown as SceneNode;

    expect(() => scene.setNodes([node('a'), alien])).toThrow(RangeError);
    expect(scene.nodeCount).toBe(2);
    expect(scene.placementOf('a')).toEqual(before[0]);
    expect(scene.placementOf('b')).toEqual(before[1]);
    expect(scene.meshes[0]?.geometry.instanceCount).toBe(2);
    scene.dispose();
  });

  it('takes an empty list, which is a graph with no nodes', () => {
    const scene = new SceneNodes(style, { roundedRect: 0, circle: 0 });
    expect(() => scene.setNodes([])).not.toThrow();
    expect(scene.nodeCount).toBe(0);
    scene.dispose();
  });
});

describe('lifecycle', () => {
  it('disposes both families once, and refuses to be added to afterwards', () => {
    // A NAMED class, not a bare `Error`. errors.ts added one for exactly this
    // case: a component unmounts, the renderer is disposed, a queued frame calls
    // setNodes, and a caller's `catch (e) { if (e instanceof DagrRenderError) }`
    // has to see it.
    const scene = new SceneNodes(style);
    scene.setNodes([node('a')]);
    scene.dispose();
    scene.dispose();
    expect(() => scene.setNodes([node('b')])).toThrow(SceneDisposedError);
    expect(() => scene.setNodes([node('b')])).toThrow(DagrRenderError);
    expect(() => scene.setNodes([node('b')])).toThrow(/scene nodes/);
  });

  it('disposes what it built when the style is rejected', () => {
    // The guarantee `createRenderer` makes one layer up, applied here: a caller
    // never has to dispose something it did not receive.
    expect(() => new SceneNodes({ ...style, glowAlpha: 2 })).toThrow(RangeError);
    expect(() => new SceneNodes({ ...style, outlineColor: -1 })).toThrow(RangeError);
  });
});
