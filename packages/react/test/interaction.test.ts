import type { SceneEdge } from '@prnt/dagr-render';
import { describe, expect, it } from 'vitest';

import { createEdgeHitIndex } from '../src/edge-hit.js';
import type { EdgeHitIndex } from '../src/edge-hit.js';
import {
  createGraphInteraction,
  sameGraphHitTarget,
} from '../src/interaction.js';
import type {
  GraphHitProvider,
  GraphHitTarget,
  GraphPointer,
} from '../src/interaction.js';

const revision = 7;
const checkout = { kind: 'node', nodeId: 'checkout' } as const;

function pointer(
  pointerId: number,
  x: number,
  y: number,
  overrides: Partial<GraphPointer> = {},
): GraphPointer {
  return {
    pointerId,
    button: 0,
    isPrimary: true,
    css: { x, y },
    world: { x: x / 2, y: -y / 2 },
    devicePixelRatio: 2,
    ...overrides,
  };
}

describe('graph hit identity', () => {
  it('compares the complete node or port identity', () => {
    expect(sameGraphHitTarget(checkout, { kind: 'node', nodeId: 'checkout' })).toBe(true);
    expect(sameGraphHitTarget(checkout, { kind: 'node', nodeId: 'shipping' })).toBe(false);
    expect(
      sameGraphHitTarget(
        { kind: 'port', nodeId: 'checkout', portId: 'event' },
        { kind: 'port', nodeId: 'checkout', portId: 'event' },
      ),
    ).toBe(true);
    expect(
      sameGraphHitTarget(
        { kind: 'port', nodeId: 'checkout', portId: 'event' },
        { kind: 'port', nodeId: 'checkout', portId: 'request' },
      ),
    ).toBe(false);
    expect(
      sameGraphHitTarget(
        { kind: 'port', nodeId: 'checkout', portId: 'event' },
        { kind: 'port', nodeId: 'shipping', portId: 'event' },
      ),
    ).toBe(false);
    expect(
      sameGraphHitTarget(checkout, {
        kind: 'port',
        nodeId: 'checkout',
        portId: 'event',
      }),
    ).toBe(false);
  });

  it('compares edges by edge id and never equates an edge with a node of the same id', () => {
    expect(
      sameGraphHitTarget({ kind: 'edge', edgeId: 'pay' }, { kind: 'edge', edgeId: 'pay' }),
    ).toBe(true);
    expect(
      sameGraphHitTarget({ kind: 'edge', edgeId: 'pay' }, { kind: 'edge', edgeId: 'ship' }),
    ).toBe(false);
    expect(sameGraphHitTarget({ kind: 'edge', edgeId: 'checkout' }, checkout)).toBe(false);
    expect(sameGraphHitTarget(checkout, { kind: 'edge', edgeId: 'checkout' })).toBe(false);
  });
});

describe('graph pointer selection of edges', () => {
  type Edges = readonly Pick<SceneEdge, 'id' | 'points'>[];
  const pay: Edges = [{ id: 'pay', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];
  const onEdge = (x: number): GraphPointer => ({
    pointerId: 1,
    button: 0,
    isPrimary: true,
    css: { x, y: 0 },
    world: { x, y: 0 },
    devicePixelRatio: 1,
  });

  function edgeMachine(selected: Array<GraphHitTarget | null>) {
    const indexes = new Map<Edges, EdgeHitIndex>();
    const hitTarget: GraphHitProvider<Edges> = (query) => {
      let index = indexes.get(query.displayedRevision);
      if (index === undefined) {
        index = createEdgeHitIndex(query.displayedRevision);
        indexes.set(query.displayedRevision, index);
      }
      const id = index.hit(query.world, 4);
      return {
        target: id === null ? null : { kind: 'edge', edgeId: id },
        displayedRevision: query.displayedRevision,
      };
    };
    return createGraphInteraction<Edges>({
      hitTarget,
      onSelectionChange: (target) => selected.push(target),
      onPanBy: () => undefined,
    });
  }

  it('selects the edge pressed and released on in one displayed revision', () => {
    const selected: Array<GraphHitTarget | null> = [];
    const machine = edgeMachine(selected);
    machine.pointerDown(onEdge(40), pay);
    machine.pointerUp(onEdge(42), pay);
    expect(selected).toEqual([{ kind: 'edge', edgeId: 'pay' }]);
  });

  it('ignores a click across a reroute or a removal of the pressed edge', () => {
    const selected: Array<GraphHitTarget | null> = [];
    const machine = edgeMachine(selected);
    const rerouted: Edges = [{ id: 'pay', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }];
    const removed: Edges = [];
    machine.pointerDown(onEdge(40), pay);
    machine.pointerUp(onEdge(40), rerouted);
    machine.pointerDown(onEdge(40), pay);
    machine.pointerUp(onEdge(40), removed);
    expect(selected).toEqual([]);

    machine.pointerDown(onEdge(40), removed);
    machine.pointerUp(onEdge(40), removed);
    expect(selected).toEqual([null]);
  });

  it('ignores an edge answered for a revision other than the one displayed', () => {
    const selected: Array<GraphHitTarget | null> = [];
    const stale: GraphHitProvider<Edges> = () => ({
      target: { kind: 'edge', edgeId: 'pay' },
      displayedRevision: pay,
    });
    const machine = createGraphInteraction<Edges>({
      hitTarget: stale,
      onSelectionChange: (target) => selected.push(target),
      onPanBy: () => undefined,
    });
    const current: Edges = [...pay];
    machine.pointerDown(onEdge(40), current);
    machine.pointerUp(onEdge(40), current);
    expect(selected).toEqual([]);
  });
});

describe('graph pointer selection', () => {
  it('selects only after release over the pressed stable target', () => {
    const selected: Array<GraphHitTarget | null> = [];
    const queries: Parameters<GraphHitProvider<number>>[0][] = [];
    const hitTarget: GraphHitProvider<number> = (query) => {
      queries.push(query);
      return { target: checkout, displayedRevision: query.displayedRevision };
    };
    const machine = createGraphInteraction({
      thresholdCssPixels: 5,
      hitTarget,
      onSelectionChange: (target) => selected.push(target),
      onPanBy: () => undefined,
    });

    expect(machine.pointerDown(pointer(1, 10, 20), revision)).toEqual([]);
    expect(selected).toEqual([]);

    expect(machine.pointerUp(pointer(1, 10, 20), revision)).toEqual([]);
    expect(selected).toEqual([checkout]);
    expect(queries).toEqual([
      {
        css: { x: 10, y: 20 },
        world: { x: 5, y: -10 },
        devicePixelRatio: 2,
        displayedRevision: revision,
      },
      {
        css: { x: 10, y: 20 },
        world: { x: 5, y: -10 },
        devicePixelRatio: 2,
        displayedRevision: revision,
      },
    ]);
  });

  it('clears only for a fresh empty click and ignores mismatched targets', () => {
    const selected: Array<GraphHitTarget | null> = [];
    const hits: Array<GraphHitTarget | null> = [null, null, checkout, {
      kind: 'node',
      nodeId: 'shipping',
    }];
    const machine = createGraphInteraction({
      hitTarget: (query) => {
        const target = hits.shift() ?? null;
        return { target, displayedRevision: query.displayedRevision };
      },
      onSelectionChange: (target) => selected.push(target),
      onPanBy: () => undefined,
    });

    machine.pointerDown(pointer(1, 0, 0), revision);
    machine.pointerUp(pointer(1, 0, 0), revision);
    machine.pointerDown(pointer(2, 0, 0), revision);
    machine.pointerUp(pointer(2, 0, 0), revision);

    expect(selected).toEqual([null]);
  });

  it('rejects changed display revisions and stale provider stamps', () => {
    const selected: Array<GraphHitTarget | null> = [];
    let providerRevision = revision;
    let providerTarget: GraphHitTarget | null = checkout;
    const machine = createGraphInteraction({
      hitTarget: () => ({ target: providerTarget, displayedRevision: providerRevision }),
      onSelectionChange: (target) => selected.push(target),
      onPanBy: () => undefined,
    });

    machine.pointerDown(pointer(1, 0, 0), revision);
    machine.pointerUp(pointer(1, 0, 0), revision + 1);
    providerRevision = revision - 1;
    machine.pointerDown(pointer(2, 0, 0), revision);
    providerRevision = revision;
    machine.pointerUp(pointer(2, 0, 0), revision);
    providerTarget = null;
    providerRevision = revision - 1;
    machine.pointerDown(pointer(3, 0, 0), revision);
    machine.pointerUp(pointer(3, 0, 0), revision);

    expect(selected).toEqual([]);
  });
});

describe('graph pointer panning', () => {
  it('keeps sub-threshold movement clickable and pans from exactly five CSS pixels', () => {
    const selected: Array<GraphHitTarget | null> = [];
    const pans: Array<{ readonly x: number; readonly y: number }> = [];
    const phases: string[] = [];
    const machine = createGraphInteraction({
      thresholdCssPixels: 5,
      hitTarget: (query) => ({ target: checkout, displayedRevision: query.displayedRevision }),
      onSelectionChange: (target) => selected.push(target),
      onPanBy: (delta) => pans.push(delta),
      onPanStart: () => phases.push('start'),
      onPanEnd: (cancelled) => phases.push(cancelled ? 'cancel' : 'end'),
    });

    machine.pointerDown(pointer(1, 10, 10), revision);
    expect(machine.pointerMove(pointer(1, 13, 13.99), revision)).toEqual([]);
    machine.pointerUp(pointer(1, 13, 13.99), revision);
    expect(selected).toEqual([checkout]);

    machine.pointerDown(pointer(2, 10, 10), revision);
    expect(machine.pointerMove(pointer(2, 13, 14), revision)).toEqual([
      { kind: 'focus' },
      { kind: 'capture', pointerId: 2 },
      { kind: 'dragging', active: true },
      { kind: 'suppress-click' },
    ]);
    expect(machine.pointerMove(pointer(2, 15, 17), revision)).toEqual([]);
    expect(machine.pointerUp(pointer(2, 15, 17), revision)).toEqual([
      { kind: 'release', pointerId: 2 },
      { kind: 'dragging', active: false },
    ]);

    expect(pans).toEqual([
      { x: 3, y: 4 },
      { x: 2, y: 3 },
    ]);
    expect(phases).toEqual(['start', 'end']);
    expect(selected).toEqual([checkout]);
  });

  it('ignores other and non-primary pointers and cancels an owned drag', () => {
    const pans: Array<{ readonly x: number; readonly y: number }> = [];
    const ended: boolean[] = [];
    const machine = createGraphInteraction({
      hitTarget: (query) => ({ target: null, displayedRevision: query.displayedRevision }),
      onSelectionChange: () => undefined,
      onPanBy: (delta) => pans.push(delta),
      onPanEnd: (cancelled) => ended.push(cancelled),
    });

    expect(
      machine.pointerDown(pointer(1, 0, 0, { isPrimary: false }), revision),
    ).toEqual([]);
    expect(machine.pointerDown(pointer(1, 0, 0, { button: 1 }), revision)).toEqual([]);
    machine.pointerDown(pointer(2, 0, 0), revision);
    expect(machine.pointerMove(pointer(3, 10, 0), revision)).toEqual([]);
    expect(machine.pointerUp(pointer(3, 10, 0), revision)).toEqual([]);
    expect(machine.pointerMove(pointer(2, 5, 0), revision)).toContainEqual({
      kind: 'capture',
      pointerId: 2,
    });
    expect(machine.pointerCancel(3)).toEqual([]);
    expect(machine.pointerCancel(2)).toEqual([
      { kind: 'release', pointerId: 2 },
      { kind: 'dragging', active: false },
    ]);

    machine.pointerDown(pointer(4, 0, 0), revision);
    machine.pointerMove(pointer(4, 5, 0), revision);
    expect(machine.lostPointerCapture(4)).toEqual([{ kind: 'dragging', active: false }]);
    expect(pans).toEqual([
      { x: 5, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(ended).toEqual([true, true]);
  });

  it('cancels an active captured pan when disposed', () => {
    const ended: boolean[] = [];
    const machine = createGraphInteraction({
      hitTarget: (query) => ({ target: null, displayedRevision: query.displayedRevision }),
      onSelectionChange: () => undefined,
      onPanBy: () => undefined,
      onPanEnd: (cancelled) => ended.push(cancelled),
    });

    machine.pointerDown(pointer(1, 0, 0), revision);
    machine.pointerMove(pointer(1, 5, 0), revision);

    expect(machine.cancelActive()).toEqual([
      { kind: 'release', pointerId: 1 },
      { kind: 'dragging', active: false },
    ]);
    expect(machine.cancelActive()).toEqual([]);
    expect(ended).toEqual([true]);
  });
});
