import { describe, expect, it, vi } from 'vitest';
import { DuplicateNodeError, isDagrGraphError } from '../src/errors.js';
import { Graph } from '../src/graph.js';
import { PatchListenerError, apply } from '../src/patch.js';
import type { Patch } from '../src/patch.js';

/** A listener that records every patch it is handed. */
function recorder(): { patches: Patch[]; listener: (patch: Patch) => void } {
  const patches: Patch[] = [];
  return { patches, listener: (patch) => patches.push(patch) };
}

/** What `run` threw, or a failure if it threw nothing. */
function catchError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
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

  it('runs every listener even when one throws, and wraps the one error', () => {
    const graph = new Graph();
    const after = vi.fn();
    const failure = new Error('listener failed');
    graph.subscribe(() => {
      throw failure;
    });
    graph.subscribe(after);
    // One shape at every listener count, so a caller never has to test for two.
    // The listener's own error is reachable through `errors` and through
    // `cause`, and it is not what comes out of the mutating call.
    const caught = catchError(() => graph.addNode('a'));
    expect(caught).toBeInstanceOf(PatchListenerError);
    expect((caught as PatchListenerError).errors).toEqual([failure]);
    expect((caught as PatchListenerError).cause).toBe(failure);
    expect(after).toHaveBeenCalledTimes(1);
    // The mutation is committed before listeners run, so a throwing listener
    // does not roll it back.
    expect(graph.hasNode('a')).toBe(true);
  });

  it('collects several thrown errors into one PatchListenerError', () => {
    const graph = new Graph();
    graph.subscribe(() => {
      throw new Error('first failed');
    });
    graph.subscribe(() => {
      throw new Error('second failed');
    });
    const caught = catchError(() => graph.addNode('a'));
    expect(caught).toBeInstanceOf(PatchListenerError);
    const listenerError = caught as PatchListenerError;
    expect(listenerError.errors).toHaveLength(2);
    expect((listenerError.errors[0] as Error).message).toBe('first failed');
    expect((listenerError.errors[1] as Error).message).toBe('second failed');
    expect(listenerError.cause).toBe(listenerError.errors[0]);
    expect(listenerError.message).toContain('2');
  });

  /**
   * The reviewer's repro, and the reason the wrapper exists at all. `apply` is
   * not transactional, so a mirror that has drifted rejects an op and the
   * listener throws a graph error. Without the wrapper that error surfaces from
   * `source.addNode('a')`, where it reads as "the source refused the node", and
   * `isDagrGraphError` agrees. The source accepted and committed the call: only
   * the listener failed, and the shape of what comes out has to say so.
   */
  it('does not let a listener failure read as a rejection by the graph', () => {
    const source = new Graph();
    const mirror = new Graph();
    mirror.addNode('a');
    source.subscribe((patch) => {
      apply(mirror, patch);
    });

    const caught = catchError(() => source.addNode('a'));
    expect(caught).toBeInstanceOf(PatchListenerError);
    expect(caught).not.toBeInstanceOf(DuplicateNodeError);
    expect(isDagrGraphError(caught)).toBe(false);
    expect((caught as PatchListenerError).cause).toBeInstanceOf(DuplicateNodeError);
    // The source took the node. The failure is downstream of the commit.
    expect(source.hasNode('a')).toBe(true);
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

/**
 * A listener that mutates the graph IT IS LISTENING TO, which the suite above
 * deliberately does not do: the mirroring test mutates a different graph, so
 * none of what follows is exercised by it.
 *
 * Nothing here is new behaviour. It is the behaviour the graph model guide
 * already describes under "Listener semantics", asserted rather than only
 * written down, because it is surprising enough that a refactor could quietly
 * change it and nothing would notice.
 */
describe('Graph subscribe under nested emission', () => {
  /** An op as a short label, so an interleaving reads as a list of strings. */
  function label(patch: Patch): string {
    const op = patch[0];
    if (op === undefined) return 'empty';
    return `${op.op} ${'id' in op ? op.id : ''}`.trim();
  }

  it('delivers the nested patch to every listener before the outer one resumes', () => {
    const graph = new Graph();
    const calls: string[] = [];
    // A responds to `add-node a` by adding `b`, so its own emission runs to
    // completion inside the call A is still sitting in.
    graph.subscribe((patch) => {
      calls.push(`A:${label(patch)}`);
      if (label(patch) === 'add-node a') graph.addNode('b');
    });
    graph.subscribe((patch) => {
      calls.push(`B:${label(patch)}`);
    });

    graph.addNode('a');

    // Depth first, so B sees the effect before the cause. Anything that
    // queued, coalesced, or deferred the nested patch would put `B:add-node a`
    // second instead of last.
    expect(calls).toEqual(['A:add-node a', 'A:add-node b', 'B:add-node b', 'B:add-node a']);
  });

  it('lets a listener subscribed during the outer emission see the nested patch', () => {
    const graph = new Graph();
    const late: string[] = [];
    graph.subscribe((patch) => {
      if (label(patch) !== 'add-node a') return;
      // Subscribed after the outer emission took its snapshot, so it misses
      // that patch, and before the nested emission takes its own, so it gets
      // that one.
      graph.subscribe((nested) => {
        late.push(label(nested));
      });
      graph.addNode('b');
    });

    graph.addNode('a');
    expect(late).toEqual(['add-node b']);

    // And it stays subscribed, so the next ordinary mutation reaches it too.
    graph.addNode('c');
    expect(late).toEqual(['add-node b', 'add-node c']);
  });

  it('surfaces a throw from the nested emission out of the outer mutation', () => {
    const graph = new Graph();
    const boom = new Error('nested listener failed');
    graph.subscribe((patch) => {
      if (label(patch) === 'add-node a') graph.addNode('b');
    });
    graph.subscribe((patch) => {
      if (label(patch) === 'add-node b') throw boom;
    });

    // Nothing in this call is the failing thing: the throw belongs to the
    // nested `addNode('b')`, which the first listener made, and it comes out
    // here because that call is inside this one.
    const caught = catchError(() => graph.addNode('a'));
    expect(caught).toBeInstanceOf(PatchListenerError);
    const outer = caught as PatchListenerError;
    // The nested failure is itself a PatchListenerError, wrapped again by the
    // outer emission that the mutating listener threw out of, so the original
    // sits two causes down and is reachable without a search.
    const nested = outer.cause;
    expect(nested).toBeInstanceOf(PatchListenerError);
    expect((nested as PatchListenerError).cause).toBe(boom);
    // Both mutations stayed committed. Listeners run after the commit, so a
    // failure among them never rolls one back.
    expect(graph.nodes().map((node) => node.id)).toEqual(['a', 'b']);
  });
});
