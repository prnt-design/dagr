import { describe, expect, it, vi } from 'vitest';
import { Graph } from '../src/graph.js';
import type { Patch } from '../src/patch.js';

/** A listener that records every patch it is handed. */
function recorder(): { patches: Patch[]; listener: (patch: Patch) => void } {
  const patches: Patch[] = [];
  return { patches, listener: (patch) => patches.push(patch) };
}

describe('Graph subscribe', () => {
  it('calls the listener once per state-changing mutation', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);
    graph.addNode('a');
    graph.addNode('b');
    expect(patches).toHaveLength(2);
  });

  it('stops calling the listener after the returned function runs', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    const unsubscribe = graph.subscribe(listener);
    graph.addNode('a');
    unsubscribe();
    graph.addNode('b');
    expect(patches).toHaveLength(1);
  });

  it('tolerates unsubscribing twice', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    const unsubscribe = graph.subscribe(listener);
    unsubscribe();
    unsubscribe();
    graph.addNode('a');
    expect(patches).toHaveLength(0);
  });

  it('calls every listener, in subscription order', () => {
    const graph = new Graph();
    const calls: string[] = [];
    graph.subscribe(() => calls.push('first'));
    graph.subscribe(() => calls.push('second'));
    graph.addNode('a');
    expect(calls).toEqual(['first', 'second']);
  });

  it('registers the same listener once, so it is called once', () => {
    const graph = new Graph();
    const listener = vi.fn();
    graph.subscribe(listener);
    graph.subscribe(listener);
    graph.addNode('a');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hands every listener the same frozen patch', () => {
    const graph = new Graph();
    const seen: Patch[] = [];
    graph.subscribe((patch) => seen.push(patch));
    graph.subscribe((patch) => seen.push(patch));
    graph.addNode('a');
    expect(seen[0]).toBe(seen[1]);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it('does not call a listener at all when the mutation changes nothing', () => {
    const graph = new Graph();
    graph.addNode('a');
    const listener = vi.fn();
    graph.subscribe(listener);
    graph.updateNodeAttrs('a', {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('emits over a snapshot of the listener set', () => {
    const graph = new Graph();
    const late = vi.fn();
    // Subscribing during emission takes effect from the next patch, and
    // unsubscribing during emission still lets the pending call through, so a
    // listener list edited mid-emission cannot skip or double up a listener.
    const early = vi.fn(() => {
      graph.subscribe(late);
    });
    graph.subscribe(early);
    graph.addNode('a');
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    graph.addNode('b');
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('calls a listener that unsubscribed itself during the same emission', () => {
    const graph = new Graph();
    const second = vi.fn();
    const unsubscribeSecond = graph.subscribe(second);
    graph.subscribe(() => {
      unsubscribeSecond();
    });
    graph.addNode('a');
    expect(second).toHaveBeenCalledTimes(1);
    graph.addNode('b');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs every listener even when one throws, and rethrows the one error', () => {
    const graph = new Graph();
    const after = vi.fn();
    graph.subscribe(() => {
      throw new Error('listener failed');
    });
    graph.subscribe(after);
    expect(() => graph.addNode('a')).toThrow('listener failed');
    expect(after).toHaveBeenCalledTimes(1);
    // The mutation is committed before listeners run, so a throwing listener
    // does not roll it back.
    expect(graph.hasNode('a')).toBe(true);
  });

  it('collects several thrown errors into an AggregateError', () => {
    const graph = new Graph();
    graph.subscribe(() => {
      throw new Error('first failed');
    });
    graph.subscribe(() => {
      throw new Error('second failed');
    });
    let caught: unknown;
    try {
      graph.addNode('a');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect((aggregate.errors[0] as Error).message).toBe('first failed');
    expect((aggregate.errors[1] as Error).message).toBe('second failed');
  });

  it('supports a mutation made from inside a listener', () => {
    const graph = new Graph();
    const patches: Patch[] = [];
    const mirror = new Graph();
    graph.subscribe((patch) => {
      patches.push(patch);
      // A listener that mutates a different graph is the mirroring case, and it
      // must not disturb the emission it is running inside.
      if (patch[0]?.op === 'add-node') mirror.addNode(patch[0].id);
    });
    graph.addNode('a');
    graph.addNode('b');
    expect(patches).toHaveLength(2);
    expect(mirror.nodes().map((node) => node.id)).toEqual(['a', 'b']);
  });
});
