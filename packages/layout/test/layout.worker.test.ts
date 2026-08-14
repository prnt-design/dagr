import { MessageChannel } from 'node:worker_threads';
import { Graph } from '@dagr/graph';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StageContractError,
  WorkerTransportError,
  createLayout,
  networkSimplexRankStage,
  serveLayout,
} from '../src/index.js';
import type { LayoutPort, LayoutStageOverrides, RankStage } from '../src/index.js';
import { buildCorpusGraph, goldenCorpus } from './golden-corpus.js';

/**
 * A real structured-clone boundary, in one thread.
 *
 * `MessageChannel` is the whole point of testing worker mode this way. A fake
 * port that handed the object straight over would prove the protocol
 * type-checks and nothing else, and every property M2.10 actually claims is
 * about what survives the crossing: that no function is in the message, that
 * the buffers are transferred rather than copied, that an error arrives as
 * something a caller can catch. Both ends here go through the same serialiser a
 * real `Worker` would, so all of that is under test without spawning a thread
 * or building a worker bundle to point one at.
 */
function channel(stages?: LayoutStageOverrides): {
  readonly engineSide: LayoutPort;
  readonly workerSide: LayoutPort;
  readonly close: () => void;
} {
  const { port1, port2 } = new MessageChannel();
  const stop = serveLayout(port2, stages);
  return {
    engineSide: port1,
    workerSide: port2,
    close: () => {
      stop();
      port1.close();
      port2.close();
    },
  };
}

/** What a port was asked to send, and how many listeners it is still holding. */
interface PortSpy extends LayoutPort {
  readonly posts: readonly { readonly message: unknown; readonly transfer: ArrayBuffer[] }[];
  readonly listening: () => number;
}

function spy(port: LayoutPort): PortSpy {
  const posts: { message: unknown; transfer: ArrayBuffer[] }[] = [];
  let listeners = 0;
  return {
    posts,
    listening: () => listeners,
    postMessage(message, transfer) {
      // Recorded BEFORE the post, because the post is what detaches the
      // buffers: the array is kept and its contents are inspected afterwards.
      posts.push({ message, transfer });
      port.postMessage(message, transfer);
    },
    addEventListener(type, listener) {
      listeners += 1;
      port.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      listeners -= 1;
      port.removeEventListener(type, listener);
    },
    start() {
      port.start?.();
    },
  };
}

function diamond(): Graph {
  const graph = new Graph();
  for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id);
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'c', 'ac');
  graph.addEdge('b', 'd', 'bd');
  graph.addEdge('c', 'd', 'cd');
  // A long edge, so the run has a dummy chain to rejoin and the routes coming
  // back have more than two points in them.
  graph.addEdge('a', 'd', 'ad');
  return graph;
}

const open: (() => void)[] = [];

afterEach(() => {
  for (const close of open.splice(0)) close();
});

/** A channel that closes itself when the test ends. */
function served(stages?: LayoutStageOverrides): ReturnType<typeof channel> {
  const wired = channel(stages);
  open.push(wired.close);
  return wired;
}

describe('a run that crosses a worker boundary', () => {
  it('lays a graph out exactly as the sync run does', async () => {
    const { engineSide } = served();
    const engine = createLayout({ worker: engineSide });
    await expect(engine.runAsync(diamond())).resolves.toEqual(engine.run(diamond()));
  });

  it('lays a corpus graph out exactly as the sync run does', async () => {
    const entry = goldenCorpus[0];
    if (entry === undefined) throw new Error('the golden corpus is empty');
    const { engineSide } = served();
    const engine = createLayout({ worker: engineSide, config: { nodeSep: 12, rankSep: 30 } });
    await expect(engine.runAsync(buildCorpusGraph(entry))).resolves.toEqual(
      engine.run(buildCorpusGraph(entry)),
    );
  });

  // The stages are the worker's, because functions do not cross. So the two
  // sides are only the same layout when they run the same algorithms, and an
  // engine that quietly ran the pipeline on this thread would pass every test
  // above and none of this one. The corpus graph is here rather than the
  // diamond for exactly that reason: the two rankers agree on a graph that
  // small, so a difference to detect has to be a graph big enough to have one,
  // and the second assertion is what says the first one is load bearing.
  it('runs the stages the worker was served with', async () => {
    const entry = goldenCorpus[0];
    if (entry === undefined) throw new Error('the golden corpus is empty');
    const stages = { rank: networkSimplexRankStage };
    const { engineSide } = served(stages);
    const engine = createLayout({ worker: engineSide });
    const answer = await engine.runAsync(buildCorpusGraph(entry));
    expect(answer).toEqual(createLayout({ stages }).run(buildCorpusGraph(entry)));
    expect(answer).not.toEqual(createLayout().run(buildCorpusGraph(entry)));
  });

  it('sizes the nodes on the calling side, where the callback lives', async () => {
    const seen: string[] = [];
    const { engineSide } = served();
    const engine = createLayout({
      worker: engineSide,
      config: {
        nodeSize: (node) => {
          seen.push(node.id);
          return { width: 20, height: 10 };
        },
      },
    });
    const result = await engine.runAsync(diamond());
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    expect(result.nodes.get('a')).toMatchObject({ width: 20, height: 10 });
  });

  // What crosses is the layout's view of the graph, so an attribute holding
  // something structured cloning cannot carry is not this package's problem.
  // `@dagr/graph` never reads an attribute, so a callback or a DOM node in a
  // bag is legal there, and sending the document would have turned that into a
  // run that fails for a reason nothing about layout explains.
  it('carries a graph whose attributes could never be cloned', async () => {
    const graph = new Graph();
    graph.addNode({ id: 'a', attrs: { render: () => 'a' } });
    graph.addNode({ id: 'b', attrs: { render: () => 'b' } });
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { onClick: () => undefined } });
    const { engineSide } = served();
    const engine = createLayout({ worker: engineSide });
    await expect(engine.runAsync(graph)).resolves.toEqual(engine.run(graph));
  });

  it('moves the numbers rather than copying them', async () => {
    const wired = served();
    const engineSide = spy(wired.engineSide);
    const engine = createLayout({ worker: engineSide });
    await engine.runAsync(diamond());

    const request = engineSide.posts[0];
    if (request === undefined) throw new Error('nothing was posted');
    // One buffer out: the sizes. The ids beside them are strings, which cannot
    // be transferred, and the config is four numbers.
    expect(request.transfer).toHaveLength(1);
    // Detached, which is what transferred means: the sending side no longer
    // holds the bytes. A copy would have left this at its original length.
    expect(request.transfer[0]?.byteLength).toBe(0);
  });

  it('moves the answer back the same way', async () => {
    const { port1, port2 } = new MessageChannel();
    const workerSide = spy(port2);
    const stop = serveLayout(workerSide);
    open.push(() => {
      stop();
      port1.close();
      port2.close();
    });
    await createLayout({ worker: port1 }).runAsync(diamond());

    const answer = workerSide.posts[0];
    if (answer === undefined) throw new Error('nothing was posted back');
    // Three buffers back: the node boxes, the point counts, the route points.
    // `bounds` is four numbers and is cloned, because a buffer of its own would
    // cost more in overhead than the copy it saves.
    expect(answer.transfer).toHaveLength(3);
    expect(answer.transfer.map((buffer) => buffer.byteLength)).toEqual([0, 0, 0]);
  });

  it('keeps overlapping runs apart', async () => {
    const { engineSide } = served();
    const engine = createLayout({ worker: engineSide });
    const pair = new Graph();
    pair.addNode('x');
    pair.addNode('y');
    pair.addEdge('x', 'y', 'xy');
    const [first, second] = await Promise.all([
      engine.runAsync(diamond()),
      engine.runAsync(pair),
    ]);
    expect([...first.nodes.keys()]).toEqual(['a', 'b', 'c', 'd']);
    expect([...second.nodes.keys()]).toEqual(['x', 'y']);
    expect(second).toEqual(engine.run(pair));
  });

  // Two engines on one port is a case this protocol invites, and request ids
  // counted per engine would have made it silently wrong: both would send id 1,
  // both listeners would match the first answer, and the loser would decode the
  // winner's numbers against its own ids. The sizes are what catch it. Equal
  // node and edge counts on both sides mean no length check can fire, so a
  // shared counter is the only thing standing between this and a layout with
  // every id present, every number finite, and everything in the wrong place.
  it('keeps two engines sharing one port apart', async () => {
    const { engineSide } = served();
    const wide = createLayout({ worker: engineSide, config: { defaultNodeSize: { width: 200, height: 10 } } });
    const narrow = createLayout({ worker: engineSide, config: { defaultNodeSize: { width: 20, height: 10 } } });
    const pair = (first: string, second: string): Graph => {
      const graph = new Graph();
      graph.addNode(first);
      graph.addNode(second);
      graph.addEdge(first, second, `${first}${second}`);
      return graph;
    };
    const [a, b] = await Promise.all([
      wide.runAsync(pair('a', 'b')),
      narrow.runAsync(pair('x', 'y')),
    ]);
    expect(a.nodes.get('a')).toMatchObject({ width: 200 });
    expect(b.nodes.get('x')).toMatchObject({ width: 20 });
    expect(b.nodes.get('a')).toBeUndefined();
  });

  // The graph is the caller's and is mutable, and this package is animation
  // first, so editing one while a run is in flight is an ordinary sequence. The
  // answer describes the graph that was ASKED about, so it is decoded against
  // the ids that were sent rather than against whatever the graph holds by the
  // time it lands. Without the snapshot this resolves to `b` wearing `a`'s box.
  it('answers the graph it was asked about, not the graph as it now stands', async () => {
    const { engineSide } = served();
    const engine = createLayout({
      worker: engineSide,
      config: { nodeSize: (node) => ({ width: node.id === 'a' ? 200 : 20, height: 10 }) },
    });
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b', 'ab');
    const answer = engine.runAsync(graph);
    // Same node and edge count afterwards, so no length check can catch this.
    graph.removeNode('a');
    graph.addNode('c');
    graph.addEdge('c', 'b', 'cb');
    const result = await answer;
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.get('a')).toMatchObject({ width: 200 });
    expect(result.nodes.get('b')).toMatchObject({ width: 20 });
    expect([...result.edges.keys()]).toEqual(['ab']);
  });

  // `isLayoutMessage` checks a tag and not a shape, so an answer wearing the
  // right tag with the wrong contents reaches the decoder. What the caller gets
  // is this family's own member rather than a bare `TypeError` about a property
  // of undefined, which would say nothing about where the run went wrong.
  it('rejects with a transport error when an answer is tagged but malformed', async () => {
    const wired = served();
    const engine = createLayout({ worker: wired.engineSide });
    const answer = engine.runAsync(diamond());
    // The engine counts request ids for the whole module, so the id this run
    // was given is not knowable here. Reply to every plausible one: the entry
    // that matches settles the run, and the rest are dropped as unmatched.
    for (let id = 1; id < 200; id += 1) {
      wired.workerSide.postMessage({ dagr: 'layout-result', id }, []);
    }
    await expect(answer).rejects.toThrow(WorkerTransportError);
  });

  // Serving layout on a port does not claim the port, so a caller who already
  // had a worker can put layout on it rather than starting a second one.
  it('ignores traffic that is not its own', async () => {
    const wired = served();
    const engine = createLayout({ worker: wired.engineSide });
    const answer = engine.runAsync(diamond());
    wired.workerSide.postMessage({ hello: 'world' }, []);
    wired.workerSide.postMessage({ dagr: 'layout-result', id: 4096 }, []);
    await expect(answer).resolves.toEqual(engine.run(diamond()));
  });

  it('leaves no listener on a port once its runs have settled', async () => {
    const wired = served();
    const engineSide = spy(wired.engineSide);
    const engine = createLayout({ worker: engineSide });
    await engine.runAsync(diamond());
    expect(engineSide.listening()).toBe(0);
    // And picks it up again for the next run rather than going deaf.
    await expect(engine.runAsync(diamond())).resolves.toEqual(engine.run(diamond()));
    expect(engineSide.listening()).toBe(0);
  });
});

describe('a run that fails in the worker', () => {
  const forgetful: RankStage = {
    name: 'forgetful',
    run: () => ({ ranks: new Map<string, number>(), reversedEdges: new Set<string>() }),
  };
  const exploding: RankStage = {
    name: 'exploding',
    run: () => {
      throw new TypeError('the stage exploded');
    },
  };

  // A `StageContractError` carries nothing but strings, so it arrives as
  // itself: a stage that left work undone reads the same whether it ran here or
  // there, down to which id it dropped.
  it('rejects with the stage contract error the stage would have thrown', async () => {
    const { engineSide } = served({ rank: forgetful });
    const engine = createLayout({ worker: engineSide });
    await expect(engine.runAsync(diamond())).rejects.toThrow(StageContractError);
    const error = await engine.runAsync(diamond()).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StageContractError);
    expect(error).toMatchObject({
      code: 'STAGE_CONTRACT',
      stage: 'forgetful',
      id: 'a',
      detail: 'no rank was assigned',
    });
  });

  // Anything outside the family cannot arrive as itself, because structured
  // cloning does not carry a class. The text survives and the wrapper says
  // where it came from, which beats a `TypeError` that is not the one thrown.
  it('quotes an error that is not one of the family', async () => {
    const { engineSide } = served({ rank: exploding });
    const engine = createLayout({ worker: engineSide });
    const error = await engine.runAsync(diamond()).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WorkerTransportError);
    expect(error).toMatchObject({ code: 'WORKER' });
    expect((error as Error).message).toContain('TypeError');
    expect((error as Error).message).toContain('the stage exploded');
  });

  // The run rejects rather than the worker throwing into its own global scope,
  // which is the one failure worse than the error: a promise pending forever.
  it('goes on serving after a run has failed', async () => {
    const { engineSide } = served({ rank: forgetful });
    const engine = createLayout({ worker: engineSide });
    await expect(engine.runAsync(diamond())).rejects.toThrow(StageContractError);
    await expect(engine.runAsync(diamond())).rejects.toThrow(StageContractError);
  });
});
