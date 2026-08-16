import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { apply } from '../src/patch.js';
import type { Patch } from '../src/patch.js';

describe('scratch', () => {
  it('late subscriber on an unobserved graph gets a partial batch', () => {
    const graph = new Graph();
    const patches: Patch[] = [];
    graph.batch(() => {
      graph.addNode('a');
      graph.subscribe((p) => patches.push(p));
      graph.addNode('b');
      graph.addEdge('a', 'b', 'ab');
    });
    console.log('patches:', JSON.stringify(patches.map((p) => p.map((o) => o.op))));
    const mirror = new Graph();
    let err: unknown;
    try {
      apply(mirror, patches[0] as Patch);
    } catch (e) {
      err = e;
    }
    console.log('apply err:', String(err));
    expect(true).toBe(true);
  });

  it('mid-batch unsubscribe/resubscribe', () => {
    const graph = new Graph();
    const patches: Patch[] = [];
    const un = graph.subscribe(() => undefined);
    graph.batch(() => {
      graph.addNode('a');
      un();
      graph.addNode('b');
      graph.subscribe((p) => patches.push(p));
      graph.addNode('c');
    });
    console.log('gap patches:', JSON.stringify(patches.map((p) => p.map((o) => o.op))));
  });

  it('listener error swallowed on body failure hides listener bug', () => {
    const graph = new Graph();
    graph.subscribe(() => {
      throw new Error('listener');
    });
    let e: unknown;
    try {
      graph.batch(() => {
        graph.addNode('a');
        graph.removeNode('nope');
      });
    } catch (err) {
      e = err;
    }
    console.log('winner:', (e as Error).constructor.name);
  });

  it('depth after a listener throws at close', () => {
    const graph = new Graph();
    const patches: Patch[] = [];
    graph.subscribe(() => {
      throw new Error('boom');
    });
    try {
      graph.batch(() => {
        graph.addNode('a');
      });
    } catch {
      /* ignore */
    }
    graph.subscribe((p) => patches.push(p));
    graph.addNode('b');
    console.log('after-listener-throw patches:', JSON.stringify(patches.map((p) => p.map((o) => o.op))));
  });

  it('async body degrades', async () => {
    const graph = new Graph();
    const patches: Patch[] = [];
    graph.subscribe((p) => patches.push(p));
    const p = graph.batch(async () => {
      graph.addNode('a');
      await Promise.resolve();
      graph.addNode('b');
    });
    await p;
    console.log('async patches:', JSON.stringify(patches.map((x) => x.map((o) => o.op))));
  });
});
