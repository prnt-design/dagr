import { describe, expect, it, vi } from 'vitest';

import { createGraphInteraction } from '../src/interaction.js';
import type { GraphHitQuery, GraphPointer } from '../src/interaction.js';
import { createPickedNodeHitProvider } from '../src/picked-hit.js';

interface Deferred {
  readonly css: { readonly x: number; readonly y: number };
  resolve(nodeId: string | null): void;
  reject(error: Error): void;
}

function picker() {
  const calls: Deferred[] = [];
  const pick = vi.fn(
    (css: { readonly x: number; readonly y: number }) =>
      new Promise<string | null>((resolve, reject) => {
        calls.push({ css, resolve, reject });
      }),
  );
  return { calls, pick };
}

function query(revision: number, x: number, y: number, world = { x: x * 2, y: y * 2 }): GraphHitQuery<number> {
  return { css: { x, y }, world, devicePixelRatio: 1, displayedRevision: revision };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createPickedNodeHitProvider', () => {
  it('answers stale until the pick for that point settles, then answers from it', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });

    const first = provider.hitTarget(query(1, 10, 20));
    expect(first.displayedRevision).not.toBe(1);
    expect(pick).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(provider.pending).toBe(1);

    calls[0]?.resolve('a');
    await settle();
    expect(provider.pending).toBe(0);
    expect(provider.hitTarget(query(1, 10, 20))).toEqual({
      target: { kind: 'node', nodeId: 'a' },
      displayedRevision: 1,
    });
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('answers a settled miss as a fresh miss', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });
    provider.hitTarget(query(1, 0, 0));
    calls[0]?.resolve(null);
    await settle();
    expect(provider.hitTarget(query(1, 0, 0))).toEqual({ target: null, displayedRevision: 1 });
  });

  it('does not answer a different revision or a different world point from the stored pick', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });
    provider.hitTarget(query(1, 10, 20));
    calls[0]?.resolve('a');
    await settle();

    expect(provider.hitTarget(query(2, 10, 20)).displayedRevision).not.toBe(2);
    calls[1]?.resolve('b');
    await settle();
    // The same CSS point after a pan is another world point.
    expect(provider.hitTarget(query(2, 10, 20, { x: 99, y: 20 })).displayedRevision).not.toBe(2);
    expect(pick).toHaveBeenCalledTimes(3);
  });

  it('keeps a pick that settles after its revision left the screen out of later answers', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });
    provider.hitTarget(query(1, 5, 5));
    provider.hitTarget(query(2, 5, 5));
    calls[0]?.resolve('old');
    await settle();
    expect(provider.hitTarget(query(2, 5, 5)).displayedRevision).not.toBe(2);
    calls[1]?.resolve('new');
    await settle();
    expect(provider.hitTarget(query(2, 5, 5)).target).toEqual({ kind: 'node', nodeId: 'new' });
  });

  it('keeps one pick in flight and only the latest query waiting behind it', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });
    for (let x = 0; x < 10; x++) provider.hitTarget(query(1, x, 0));
    expect(pick).toHaveBeenCalledTimes(1);

    calls[0]?.resolve(null);
    await settle();
    expect(pick).toHaveBeenCalledTimes(2);
    expect(calls[1]?.css).toEqual({ x: 9, y: 0 });
    calls[1]?.resolve('nine');
    await settle();
    expect(provider.hitTarget(query(1, 9, 0)).target).toEqual({ kind: 'node', nodeId: 'nine' });
  });

  it('stores nothing from a pick that rejects or throws, and asks again', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });
    provider.hitTarget(query(1, 1, 1));
    calls[0]?.reject(new Error('device lost'));
    await settle();
    expect(provider.pending).toBe(0);
    expect(provider.hitTarget(query(1, 1, 1)).displayedRevision).not.toBe(1);
    expect(pick).toHaveBeenCalledTimes(2);

    const throwing = createPickedNodeHitProvider<number>({
      pick: () => {
        throw new Error('disposed');
      },
    });
    expect(throwing.hitTarget(query(1, 1, 1)).displayedRevision).not.toBe(1);
    expect(throwing.pending).toBe(0);
  });

  it('calls onPicked after the answer is stored', async () => {
    const { calls, pick } = picker();
    const seen: unknown[] = [];
    const provider = createPickedNodeHitProvider<number>({
      pick,
      onPicked: () => seen.push(provider.hitTarget(query(1, 3, 4)).target),
    });
    provider.hitTarget(query(1, 3, 4));
    calls[0]?.resolve('c');
    await settle();
    expect(seen).toEqual([{ kind: 'node', nodeId: 'c' }]);
  });

  it('selects through the interaction machine once hover has primed the point', async () => {
    const { calls, pick } = picker();
    const provider = createPickedNodeHitProvider<number>({ pick });
    const selected: unknown[] = [];
    const machine = createGraphInteraction<number>({
      hitTarget: provider.hitTarget,
      onSelectionChange: (target) => selected.push(target),
      onPanBy: () => {},
    });
    const press: GraphPointer = {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      css: { x: 10, y: 20 },
      world: { x: 20, y: 40 },
      devicePixelRatio: 1,
    };

    machine.pointerDown(press, 1);
    machine.pointerUp(press, 1);
    expect(selected).toEqual([]);

    calls[0]?.resolve('a');
    await settle();
    machine.pointerDown(press, 1);
    machine.pointerUp(press, 1);
    expect(selected).toEqual([{ kind: 'node', nodeId: 'a' }]);
  });
});
