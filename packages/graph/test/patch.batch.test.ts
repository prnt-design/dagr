import { describe, expect, it } from 'vitest';
import { DuplicateNodeError, NodeNotFoundError } from '../src/errors.js';
import { Graph } from '../src/graph.js';
import { PatchListenerError, apply, invert } from '../src/patch.js';
import type { Patch } from '../src/patch.js';

/** A listener that records every patch it is handed. */
function recorder(): { patches: Patch[]; listener: (patch: Patch) => void } {
  const patches: Patch[] = [];
  return { patches, listener: (patch) => patches.push(patch) };
}

/** The op tags of a patch, in order, which is what most of these assert on. */
function tags(patch: Patch): string[] {
  return patch.map((op) => op.op);
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

describe('Graph batch', () => {
  it('emits one patch holding every op the body made, in order', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('a');
      graph.addNode('b');
      graph.addEdge('a', 'b', 'ab');
    });

    expect(patches).toHaveLength(1);
    expect(tags(patches[0] as Patch)).toEqual(['add-node', 'add-node', 'add-edge']);
  });

  it('commits every mutation as the body makes it, so reads inside see them', () => {
    const graph = new Graph();
    const seen: number[] = [];
    graph.subscribe(() => undefined);

    graph.batch(() => {
      graph.addNode('a');
      seen.push(graph.nodeCount);
      graph.addNode('b');
      seen.push(graph.nodeCount);
    });

    // A batch is not a staging area. It holds the emission back and nothing
    // else, so the graph inside the body is the graph the calls have made.
    expect(seen).toEqual([1, 2]);
  });

  it('emits nothing for a body that changed nothing', () => {
    const graph = new Graph();
    graph.addNode('a');
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.updateNodeAttrs('a', {});
    });

    expect(patches).toEqual([]);
  });

  it('emits nothing for an empty body', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => undefined);

    expect(patches).toEqual([]);
  });

  it('returns what the body returned', () => {
    const graph = new Graph();
    const node = graph.batch(() => graph.addNode('a'));
    expect(node.id).toBe('a');
  });

  it('folds a nested batch into the outermost one', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('a');
      graph.batch(() => {
        graph.addNode('b');
        graph.batch(() => {
          graph.addNode('c');
        });
      });
      graph.addNode('d');
    });

    expect(patches).toHaveLength(1);
    expect(tags(patches[0] as Patch)).toEqual(['add-node', 'add-node', 'add-node', 'add-node']);
  });

  it('emits a frozen patch, ops included', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('a');
      graph.addNode('b');
    });

    const patch = patches[0] as Patch;
    expect(Object.isFrozen(patch)).toBe(true);
    expect(patch.every((op) => Object.isFrozen(op))).toBe(true);
  });

  // The whole of M1.3's first question. A batch is a `Patch` and not a type of
  // its own, so everything already written against a patch reads one without
  // being told it is a batch.
  it('makes a batch an ordinary patch: `apply` reproduces it', () => {
    const source = new Graph();
    const mirror = new Graph();
    const { patches, listener } = recorder();
    source.subscribe(listener);

    source.batch(() => {
      source.addNode('a');
      source.addNode('b');
      source.addEdge('a', 'b', 'ab');
    });
    apply(mirror, patches[0] as Patch);

    expect(mirror.nodes().map((node) => node.id)).toEqual(['a', 'b']);
    expect(mirror.edges().map((edge) => edge.id)).toEqual(['ab']);
  });

  it('makes a batch an ordinary patch: `invert` undoes it', () => {
    const graph = new Graph();
    graph.addNode('keep');
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('a');
      graph.addNode('b');
      graph.addEdge('a', 'b', 'ab');
    });
    apply(graph, invert(patches[0] as Patch));

    expect(graph.nodes().map((node) => node.id)).toEqual(['keep']);
    expect(graph.edgeCount).toBe(0);
  });

  // M1.3's second question, answered the way the rest of this package answers
  // it: nothing here is transactional.
  it('commits what ran before a failed call and emits it before the error leaves', () => {
    const graph = new Graph();
    graph.addNode('a');
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    const caught = catchError(() => {
      graph.batch(() => {
        graph.addNode('b');
        graph.addNode('a');
        graph.addNode('c');
      });
    });

    expect(caught).toBeInstanceOf(DuplicateNodeError);
    // The mutations that ran stayed, and the ones after the throw never did.
    expect(graph.nodes().map((node) => node.id)).toEqual(['a', 'b']);
    // A listener that learned nothing would be a listener drifted from a graph
    // it is mirroring, so the ops that did commit are emitted on the way out.
    expect(patches).toHaveLength(1);
    expect(tags(patches[0] as Patch)).toEqual(['add-node']);
  });

  it('closes the batch when the body throws, so the next mutation emits on its own', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    catchError(() => {
      graph.batch(() => {
        graph.addNode('a');
        graph.removeNode('missing');
      });
    });
    graph.addNode('b');

    expect(patches).toHaveLength(2);
    expect(tags(patches[1] as Patch)).toEqual(['add-node']);
  });

  it('closes a nested batch when the inner body throws and the outer catches it', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('a');
      try {
        graph.batch(() => {
          graph.addNode('b');
          throw new Error('inner');
        });
      } catch {
        // The outer batch carries on, and the inner body's ops are part of it:
        // a nested batch is depth on one buffer rather than a buffer of its own.
      }
      graph.addNode('c');
    });

    expect(patches).toHaveLength(1);
    expect(tags(patches[0] as Patch)).toEqual(['add-node', 'add-node', 'add-node']);
  });

  it('surfaces a listener failure at the close of the batch', () => {
    const graph = new Graph();
    const boom = new Error('listener failed');
    graph.subscribe(() => {
      throw boom;
    });

    const caught = catchError(() => {
      graph.batch(() => {
        graph.addNode('a');
      });
    });

    expect(caught).toBeInstanceOf(PatchListenerError);
    expect((caught as PatchListenerError).cause).toBe(boom);
  });

  it('lets the body error win over a listener that throws on the way out', () => {
    const graph = new Graph();
    graph.subscribe(() => {
      throw new Error('listener failed');
    });

    const caught = catchError(() => {
      graph.batch(() => {
        graph.addNode('a');
        graph.removeNode('missing');
      });
    });

    // Both failed, and the body's is the one the caller asked about. A
    // listener throwing over the top of it would hide why the batch ended.
    expect(caught).toBeInstanceOf(NodeNotFoundError);
  });

  it('hands the batch to every listener registered when it closes', () => {
    const graph = new Graph();
    const early = recorder();
    const late = recorder();
    graph.subscribe(early.listener);

    graph.batch(() => {
      graph.addNode('a');
      graph.subscribe(late.listener);
      graph.addNode('b');
    });

    // The emission happens once, at the close, over the listener set as it is
    // then. So a listener that subscribed halfway through still reads the
    // whole batch, ops that predate its subscription included.
    expect(tags(early.patches[0] as Patch)).toEqual(['add-node', 'add-node']);
    expect(tags(late.patches[0] as Patch)).toEqual(['add-node', 'add-node']);
  });

  it('gives the first listener to watch only what was collected after it', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();

    graph.batch(() => {
      graph.addNode('a');
      graph.subscribe(listener);
      graph.addNode('b');
    });

    // Not the same case as the one above, and the difference is the reason the
    // rule is about what was COLLECTED rather than about the whole batch:
    // nothing was watching when `a` was added, so no op for it was ever built,
    // and an unwatched graph keeping a journal is what that would cost.
    expect(tags(patches[0] as Patch)).toEqual(['add-node']);
  });

  it('keeps collecting through a gap in the listener set, so no batch has a hole', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    const unsubscribe = graph.subscribe(() => undefined);

    graph.batch(() => {
      graph.addNode('a');
      unsubscribe();
      graph.addNode('b');
      graph.subscribe(listener);
      graph.addEdge('a', 'b', 'ab');
    });

    // Collection stops at the listener set only until a batch has started
    // collecting. Otherwise this patch would hold `a` and the edge and not `b`,
    // and a mirror replaying it would be asked for an edge to a node that
    // never arrived.
    expect(tags(patches[0] as Patch)).toEqual(['add-node', 'add-node', 'add-edge']);
    const mirror = new Graph();
    expect(() => apply(mirror, patches[0] as Patch)).not.toThrow();
    expect(mirror.edgeCount).toBe(1);
  });

  it('drops the batch for a listener that unsubscribed inside it', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    const unsubscribe = graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('a');
      unsubscribe();
      graph.addNode('b');
    });

    // The other side of the same rule, and the reason to leave a batch you did
    // not open alone: there is one emission and it had already stopped
    // watching by the time it happened.
    expect(patches).toEqual([]);
  });

  it('gives a listener that mutates during the close its own patch', () => {
    const graph = new Graph();
    const { patches, listener } = recorder();
    graph.subscribe(listener);
    graph.subscribe((patch) => {
      if (patch.length > 1) graph.addNode('mirrored');
    });

    graph.batch(() => {
      graph.addNode('a');
      graph.addNode('b');
    });

    // The depth is back to zero before the emission, so the listener's own
    // mutation is a patch of its own rather than being swallowed into the batch
    // it is reading. The recorder subscribed first, so it reads the batch and
    // then the nested patch the second listener made out of it.
    expect(patches).toHaveLength(2);
    expect(tags(patches[0] as Patch)).toEqual(['add-node', 'add-node']);
    expect(tags(patches[1] as Patch)).toEqual(['add-node']);
  });

  it('keeps a cascade whole inside a batch', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b', 'ab');
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.removeNode('a');
      graph.addNode('c');
    });

    // `removeNode` emits its incident edges before the node itself, and
    // batching concatenates rather than reorders, so the cascade keeps the
    // order `invert` needs.
    expect(tags(patches[0] as Patch)).toEqual(['remove-edge', 'remove-node', 'add-node']);
  });

  it('costs an unwatched graph no journal', () => {
    const graph = new Graph();
    graph.batch(() => {
      graph.addNode('a');
      graph.addNode('b');
    });
    const { patches, listener } = recorder();
    graph.subscribe(listener);

    graph.batch(() => {
      graph.addNode('c');
    });

    // Nothing was collected while nobody was watching, so the first batch
    // cannot leak into the second.
    expect(tags(patches[0] as Patch)).toEqual(['add-node']);
  });
});
