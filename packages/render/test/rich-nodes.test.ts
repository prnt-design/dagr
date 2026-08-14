// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Camera2D } from '../src/camera.js';
import { createHtmlOverlay } from '../src/html-overlay.js';
import type { HtmlOverlay } from '../src/html-overlay.js';
import { OverlayDisposedError } from '../src/errors.js';
import { createRichNodes } from '../src/rich-nodes.js';
import type { RichNode, RichNodeTier } from '../src/rich-nodes.js';
import type { WorldBounds } from '../src/types.js';

/**
 * Rich nodes over the overlay: one entry per node per tier, pooled elements,
 * and a diff by id.
 *
 * The semantic zoom itself is not re-tested here. Tiers ARE the overlay's
 * gates, so "at most one tier of a node is ever visible" is a property of
 * `passesGate` and is asserted in `overlay-math.test.ts` where the arithmetic
 * is. What this file covers is what this module adds: which elements are built,
 * which are reused, and when `update` is called.
 */

type Card = { readonly title: string };

function makeParent(): HTMLElement {
  const parent = document.createElement('div');
  parent.style.position = 'relative';
  document.body.appendChild(parent);
  return parent;
}

function makeCamera(zoom = 1): Camera2D {
  return new Camera2D({ zoom, viewport: { width: 1000, height: 600, devicePixelRatio: 1 } });
}

function layerOf(parent: HTMLElement): HTMLElement {
  const layer = parent.firstElementChild?.firstElementChild;
  if (!(layer instanceof HTMLElement)) throw new Error('no layer');
  return layer;
}

const bounds = (minX: number, maxX: number): WorldBounds => ({
  minX,
  minY: -10,
  maxX,
  maxY: 10,
});

/** A tier that records what it built and what it was asked to fill in. */
function countingTier(name: string, gate: { min?: number; max?: number } = {}): {
  tier: RichNodeTier<Card>;
  created: number;
  updates: string[];
} {
  const state = {
    created: 0,
    updates: [] as string[],
    tier: {
      name,
      ...(gate.min === undefined ? {} : { minScreenWidth: gate.min }),
      ...(gate.max === undefined ? {} : { maxScreenWidth: gate.max }),
      create: (): HTMLElement => {
        state.created += 1;
        const element = document.createElement('div');
        element.dataset.tier = name;
        return element;
      },
      update: (element: HTMLElement, node: RichNode<Card>): void => {
        state.updates.push(`${name}:${node.id}:${node.data.title}`);
        element.textContent = node.data.title;
      },
    } satisfies RichNodeTier<Card>,
  };
  return state;
}

describe('createRichNodes', () => {
  let parent: HTMLElement;
  let camera: Camera2D;
  let overlay: HtmlOverlay;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = makeParent();
    camera = makeCamera();
    overlay = createHtmlOverlay({ parent, camera });
  });

  it('refuses a tier list with nothing in it', () => {
    // A node with no tier has no visual at any zoom, and the likelier cause is
    // a list filtered to nothing than a caller who meant it.
    expect(() => createRichNodes<Card>({ overlay, tiers: [] })).toThrow(RangeError);
  });

  it('refuses tiers whose gates overlap', () => {
    // "At most one tier of a node is visible" is the invariant everything here
    // rests on, and without this check it was a caller obligation dressed as a
    // property: a label ending at 160 against a card starting at 150 attaches
    // two elements to one node, which makes the overlay's cap count entries
    // rather than nodes, with nothing failing anywhere.
    const label = countingTier('label', { min: 24, max: 160 });
    const card = countingTier('card', { min: 150 });
    expect(() => createRichNodes<Card>({ overlay, tiers: [label.tier, card.tier] })).toThrow(
      RangeError,
    );
    expect(() => createRichNodes<Card>({ overlay, tiers: [label.tier, card.tier] })).toThrow(
      /overlapping gates/,
    );
  });

  it('accepts tiers that meet exactly, since the gate is half-open', () => {
    const label = countingTier('label', { min: 24, max: 160 });
    const card = countingTier('card', { min: 160 });
    expect(() => createRichNodes<Card>({ overlay, tiers: [label.tier, card.tier] })).not.toThrow();
  });

  it('refuses two nodes with the same id in one call', () => {
    // The same rule `measureHtmlSizes` applies, deliberately: two id-keyed APIs
    // with opposite duplicate policies is a rule a consumer learns twice, and
    // last-wins here re-places the first node's entries onto the second's box.
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    expect(() =>
      nodes.setNodes([
        { id: 'n1', bounds: bounds(-20, 20), data: { title: 'One' } },
        { id: 'n1', bounds: bounds(40, 80), data: { title: 'Two' } },
      ]),
    ).toThrow(RangeError);
  });

  it('moves one node without touching the rest', () => {
    // `setNodes` is the bulk path and the only one that removes, which makes it
    // the wrong tool for a hover or a selection: at 2,800 nodes it would mean
    // allocating 2,800 records and walking every tier to change one.
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    nodes.setNodes([
      { id: 'n1', bounds: bounds(-40, -20), data: { title: 'One' } },
      { id: 'n2', bounds: bounds(20, 40), data: { title: 'Two' } },
    ]);
    overlay.sync();
    expect(label.updates).toEqual(['label:n1:One', 'label:n2:Two']);

    nodes.setNode({ id: 'n2', bounds: bounds(20, 40), data: { title: 'Renamed' } });
    expect(label.updates).toEqual(['label:n1:One', 'label:n2:Two', 'label:n2:Renamed']);
    expect(nodes.nodeCount).toBe(2);

    // And it registers one that is new, without removing anything.
    nodes.setNode({ id: 'n3', bounds: bounds(60, 80), data: { title: 'Three' } });
    overlay.sync();
    expect(nodes.nodeCount).toBe(3);
    expect(overlay.activeCount).toBe(3);
  });

  it('shows one tier at a time, and the bottom tier is no element at all', () => {
    // 40 world units wide: the label tier (24 to 160 CSS pixels) is zoom 0.6 to
    // 4, the card tier from 4 up, and below 0.6 the GPU has the node to itself.
    const label = countingTier('label', { min: 24, max: 160 });
    const card = countingTier('card', { min: 160 });
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier, card.tier] });
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data: { title: 'One' } }]);

    camera.setZoom(0.5);
    overlay.sync();
    expect(overlay.activeCount).toBe(0);

    camera.setZoom(2);
    overlay.sync();
    expect(overlay.activeCount).toBe(1);
    expect(layerOf(parent).children[0]).toHaveProperty('dataset.tier', 'label');

    camera.setZoom(8);
    overlay.sync();
    expect(overlay.activeCount).toBe(1);
    expect(layerOf(parent).children[0]).toHaveProperty('dataset.tier', 'card');
  });

  it('fills an element before the overlay attaches it', () => {
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data: { title: 'One' } }]);
    overlay.sync();

    // Not "created then updated on the next frame": a card that flashed the
    // previous node's fields for one frame is exactly what the create/update
    // split exists to prevent.
    expect(label.created).toBe(1);
    expect(label.updates).toEqual(['label:n1:One']);
    expect(layerOf(parent).children[0]?.textContent).toBe('One');
  });

  it('reuses an element from the tier pool rather than building another', () => {
    // The ordering this depends on belongs to the overlay: one sync detaches
    // everything that left the view BEFORE it creates anything that entered, so
    // the element released here is already back in the pool when the second
    // node asks for one.
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    nodes.setNodes([
      { id: 'n1', bounds: bounds(-20, 20), data: { title: 'One' } },
      { id: 'n2', bounds: bounds(2000, 2040), data: { title: 'Two' } },
    ]);

    overlay.sync();
    expect(label.created).toBe(1);

    // Pan so the first leaves the view and the second enters it, in one sync.
    camera.setCenter({ x: 2020, y: 0 });
    overlay.sync();
    expect(overlay.activeCount).toBe(1);
    expect(label.created).toBe(1);
    expect(label.updates).toEqual(['label:n1:One', 'label:n2:Two']);
    expect(layerOf(parent).children[0]?.textContent).toBe('Two');
  });

  it('re-places a node whose box moved without rebuilding it', () => {
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    const data = { title: 'One' };
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data }]);
    overlay.sync();

    const element = layerOf(parent).children[0];
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    const before = element.style.transform;

    nodes.setNodes([{ id: 'n1', bounds: bounds(100, 140), data }]);
    overlay.sync();

    expect(label.created).toBe(1);
    expect(layerOf(parent).children[0]).toBe(element);
    expect(element.style.transform).not.toBe(before);
  });

  it('re-renders a visible node whose data is a new reference, and only then', () => {
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    const data = { title: 'One' };
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data }]);
    overlay.sync();
    expect(label.updates).toEqual(['label:n1:One']);

    // Same reference: nothing to do, however many times it is set.
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data }]);
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data }]);
    expect(label.updates).toEqual(['label:n1:One']);

    // A new reference re-renders in place, without waiting for a sync: the
    // element is on screen now and the data it shows is stale now.
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data: { title: 'Renamed' } }]);
    expect(label.updates).toEqual(['label:n1:One', 'label:n1:Renamed']);
    expect(layerOf(parent).children[0]?.textContent).toBe('Renamed');
  });

  it('does not re-render a node that has no element on screen', () => {
    // Work nobody can see, once per node per tier on every call. Whenever it
    // next appears, `create` fills it from the data the node holds then.
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    nodes.setNodes([{ id: 'n1', bounds: bounds(9000, 9040), data: { title: 'One' } }]);
    overlay.sync();
    expect(label.updates).toEqual([]);

    nodes.setNodes([{ id: 'n1', bounds: bounds(9000, 9040), data: { title: 'Two' } }]);
    expect(label.updates).toEqual([]);

    camera.setCenter({ x: 9020, y: 0 });
    overlay.sync();
    expect(label.updates).toEqual(['label:n1:Two']);
  });

  it('drops a node that is gone from the set', () => {
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    nodes.setNodes([
      { id: 'n1', bounds: bounds(-40, -20), data: { title: 'One' } },
      { id: 'n2', bounds: bounds(20, 40), data: { title: 'Two' } },
    ]);
    overlay.sync();
    expect(overlay.activeCount).toBe(2);
    expect(nodes.nodeCount).toBe(2);

    nodes.setNodes([{ id: 'n2', bounds: bounds(20, 40), data: { title: 'Two' } }]);
    expect(nodes.nodeCount).toBe(1);
    // Removal detaches immediately rather than waiting for a sync, since the
    // node is gone from the caller's model already.
    expect(layerOf(parent).children.length).toBe(1);
    overlay.sync();
    expect(overlay.activeCount).toBe(1);
  });

  it('registers one entry per tier, so the cap counts nodes and not tiers', () => {
    // Disjoint gates mean a node's two entries can never both be active, which
    // is what lets a caller reason about the cap in nodes.
    const label = countingTier('label', { max: 160 });
    const card = countingTier('card', { min: 160 });
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier, card.tier] });
    nodes.setNodes([
      { id: 'n1', bounds: bounds(-40, -20), data: { title: 'One' } },
      { id: 'n2', bounds: bounds(20, 40), data: { title: 'Two' } },
    ]);
    overlay.sync();
    expect(overlay.activeCount).toBe(2);
  });

  it('takes its entries with it on dispose', () => {
    const label = countingTier('label');
    const nodes = createRichNodes<Card>({ overlay, tiers: [label.tier] });
    nodes.setNodes([{ id: 'n1', bounds: bounds(-20, 20), data: { title: 'One' } }]);
    overlay.sync();
    expect(layerOf(parent).children.length).toBe(1);

    nodes.dispose();
    expect(nodes.nodeCount).toBe(0);
    expect(layerOf(parent).children.length).toBe(0);
    // The overlay is the caller's, so it is still usable afterwards.
    expect(() => {
      overlay.sync();
    }).not.toThrow();
    // Both setters throw after dispose, on the line `html-overlay.ts` draws:
    // the mutating methods throw because they are called from the caller's own
    // code, and only the per-frame method the platform calls stays quiet.
    expect(() =>
      nodes.setNodes([{ id: 'n2', bounds: bounds(-20, 20), data: { title: 'Two' } }]),
    ).toThrow(OverlayDisposedError);
    expect(() => {
      nodes.setNode({ id: 'n2', bounds: bounds(-20, 20), data: { title: 'Two' } });
    }).toThrow(/setNode\(\)/);
    expect(nodes.nodeCount).toBe(0);
    // Dispose stays idempotent, since a component that unmounts twice is
    // ordinary rather than a bug worth crashing for.
    expect(() => {
      nodes.dispose();
    }).not.toThrow();
  });
});
