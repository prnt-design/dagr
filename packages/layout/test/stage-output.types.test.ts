import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { defaultStages, layout } from '../src/index.js';
import type {
  OrderOutput,
  OrderStage,
  OrderedState,
  PositionOutput,
  PositionStage,
  PositionedState,
  PreparedState,
  RankOutput,
  RankStage,
  RankedState,
  RouteOutput,
  RouteStage,
  Size,
} from '../src/index.js';

/**
 * The compile-time half of the stage contract, pinned by the compiler rather
 * than argued for in prose.
 *
 * The four `...Output` types declare every field the runner owns, and every
 * field contributed upstream of that stage, as `never`. TypeScript does not
 * excess-property-check a SPREAD, so without those declarations a stage that
 * ended `{ ...input, ranks, reversedEdges }` compiled and ran clean, silently
 * handing back a `graph`, a `config` and a `sizes` map the runner then ignored.
 * A declared property IS assignability-checked through a spread, which is what
 * turns "a stage cannot replace the graph" from a claim into a rule.
 *
 * Every negative case below carries a `@ts-expect-error`, which fails the build
 * if the error STOPS occurring. Delete a `never` block and `pnpm typecheck`
 * goes red here, so the guarantee cannot rot quietly. The positive cases carry
 * none, so this file also proves a correct stage still compiles.
 *
 * What the blocks pin, exactly, is the SPREAD cases. A property written out by
 * name is excess-property-checked whether or not the output type declares it,
 * so `{ ranks, reversedEdges, graph: decoy }` and the explicit `sizes` in the
 * half-migration below were both rejected before the `never` fields landed.
 * They are kept because they are the mistakes a stage author actually makes,
 * and because a `never` field is what makes the compiler say the right thing
 * about them. The consequence for granularity: a spread carries every upstream
 * field at once, so deleting one `never` field from a type leaves the others
 * rejecting the same spread, and it is a whole block that has to go before a
 * directive here reports itself unused.
 *
 * Each `run` annotates its return type, so the compiler reports the failure at
 * the returned expression rather than at the whole stage object. Without the
 * annotation every directive would have to sit above `run`, where it would
 * suppress anything else wrong in the method body too.
 */

/**
 * Every field of the record a stage READS has a home in what that stage WRITES:
 * either a field it contributes, or a `never` refusing it.
 *
 * The cases below pin that the mechanism WORKS. These pin that it is COMPLETE,
 * and the two are different guarantees. Because a spread carries every upstream
 * field at once, a missing `never` is invisible to a `@ts-expect-error`: the
 * surviving guards keep rejecting the same spread, so no directive reports
 * itself unused and the build stays green while that one field quietly becomes
 * spreadable again.
 *
 * That matters because the records are still growing. M2.4b adds to the ranker,
 * M2.5 to the orderer, M2.7 to the positioner, and without this a field added to
 * a `...State` record has to be hand-mirrored onto every output type downstream
 * of it, remembered by someone who is thinking about something else. That is the
 * same "one line quietly carries a mistake when a new field is added upstream"
 * this milestone exists to remove, recreated one level up.
 *
 * Adding a field to a record without guarding it downstream fails here naming
 * the field: `Type '"whatever"' does not satisfy the constraint 'never'`.
 *
 * Exported so each is a declaration with a use rather than a dead local. Nothing
 * imports them: instantiating the alias IS the assertion, and it happens when
 * this file is typechecked.
 */
type Uncovered<TState, TOutput> = Exclude<keyof TState, keyof TOutput>;
type MustBeEmpty<T extends never> = T;

export type RankOutputCoversPreparedState = MustBeEmpty<Uncovered<PreparedState, RankOutput>>;
export type OrderOutputCoversRankedState = MustBeEmpty<Uncovered<RankedState, OrderOutput>>;
export type PositionOutputCoversOrderedState = MustBeEmpty<Uncovered<OrderedState, PositionOutput>>;
export type RouteOutputCoversPositionedState = MustBeEmpty<Uncovered<PositionedState, RouteOutput>>;

/** `a -> b`, the smallest graph a stage can be run against. */
function chain(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b', 'ab');
  return graph;
}

const ranks = new Map<NodeId, number>([
  ['a', 0],
  ['b', 1],
]);
const reversedEdges = new Set<EdgeId>();
const layers: readonly (readonly NodeId[])[] = [['a'], ['b']];
const positions = new Map<NodeId, { x: number; y: number }>([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 0, y: 90 }],
]);
const routes = new Map<EdgeId, readonly { x: number; y: number }[]>([
  [
    'ab',
    [
      { x: 0, y: 0 },
      { x: 0, y: 90 },
    ],
  ],
]);

/** A graph that is not the one the runner handed in. */
const decoy = new Graph();

// The four spreads the M2.4a migration deletes, one per stage. Each carries
// back at least `graph`, `config` and `sizes`, and the later ones carry back
// everything the stages upstream of them contributed as well.

const spreadingRank: RankStage = {
  name: 'spreading-rank',
  run(input: PreparedState): RankOutput {
    // @ts-expect-error the spread carries the runner's graph, config and sizes back
    return { ...input, ranks, reversedEdges };
  },
};

const spreadingOrder: OrderStage = {
  name: 'spreading-order',
  run(input: RankedState): OrderOutput {
    // @ts-expect-error the spread carries the runner's fields and the ranker's back
    return { ...input, layers };
  },
};

const spreadingPosition: PositionStage = {
  name: 'spreading-position',
  run(input: OrderedState): PositionOutput {
    // @ts-expect-error the spread carries everything upstream of this stage back
    return { ...input, positions };
  },
};

const spreadingRoute: RouteStage = {
  name: 'spreading-route',
  run(input: PositionedState): RouteOutput {
    // @ts-expect-error the spread carries everything upstream of this stage back
    return { ...input, routes };
  },
};

/** Naming the graph outright, which is the mistake stated rather than implied. */
const swappingRank: RankStage = {
  name: 'swapping-rank',
  run(): RankOutput {
    // @ts-expect-error a stage has no field to hand back a graph of its own in
    return { ranks, reversedEdges, graph: decoy };
  },
};

/**
 * The half-migration: fix the line the compiler flagged, leave `sizes` in the
 * spread. Before the `never` fields this compiled, dropped the returned `sizes`
 * on the floor, and vanished the invented node with no error at all, which is a
 * silently wrong layout rather than a failed one.
 */
const halfMigratedRank: RankStage = {
  name: 'half-migrated-rank',
  run(input: PreparedState): RankOutput {
    const sizes = new Map<NodeId, Size>(input.sizes);
    sizes.set('ab#1', { width: 1, height: 40 });
    // @ts-expect-error `sizes` is the runner's to build, so a stage cannot state one
    return { ...input, sizes, ranks, reversedEdges };
  },
};

const rejected: readonly { readonly name: string }[] = [
  spreadingRank,
  spreadingOrder,
  spreadingPosition,
  spreadingRoute,
  swappingRank,
  halfMigratedRank,
];

// The positive cases. No `@ts-expect-error` on either, so the file fails to
// compile if the `never` fields ever reject a stage that is doing its job.

/** A stage that states its own fields alone, which is the whole migration. */
const narrowRank: RankStage = {
  name: 'narrow-rank',
  run: () => ({ ranks, reversedEdges }),
};

/** A wrapper that adjusts the default's answer by spreading the OUTPUT. */
const nudgingPosition: PositionStage = {
  name: 'nudging-position',
  run(input) {
    const output = defaultStages.position.run(input);
    const moved = new Map<NodeId, { x: number; y: number }>();
    for (const [id, point] of output.positions) moved.set(id, { x: point.x + 7, y: point.y });
    return { ...output, positions: moved };
  },
};

describe('stage output types', () => {
  it('rejects every stage that hands back a field the runner owns', () => {
    // The assertions that matter are the `@ts-expect-error` comments above:
    // `tsc` fails the build if any of them stops erroring, and `vitest` never
    // sees them. This one keeps the six values referenced so none of them is
    // dead code, and names them in the order they are declared.
    expect(rejected.map((stage) => stage.name)).toEqual([
      'spreading-rank',
      'spreading-order',
      'spreading-position',
      'spreading-route',
      'swapping-rank',
      'half-migrated-rank',
    ]);
  });

  it('accepts a stage that states its own contribution and nothing else', () => {
    const result = layout({ graph: chain() }, { rank: narrowRank, position: nudgingPosition });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.get('a')?.x).toBe(7);
  });
});
