# @dagr/living-stage

The animated demo as a mountable React component: a seeded graph, three verbs
that edit it, and a readout that says how little of the drawing each edit moved.
Private, never published.

```tsx
import { LivingStage } from '@dagr/living-stage';
import '@dagr/living-stage/living.css';

<LivingStage />;
```

Two hosts mount it: `apps/demo`, the local playground, and the docs site's
[`/demos/living`](https://dagr.prnt.design/demos/living) route, which is the
deployed one. It is a package rather than a page for the same reason
`@dagr/campaign-stage` is: a component cannot be imported from an app, and two
copies of a demo drift.

## What it is for

Dagr's headline claim is that layout is stable under an edit. The measurements
behind that claim are published, over a six-session corpus, on the
[incremental layout](https://dagr.prnt.design/docs/incremental-layout) page. The
landing page repeats the claim. Until this package there was nothing anywhere
that let a visitor SEE it: the campaign demo never mutates a graph, so it proves
scale and semantic zoom and says nothing about stability.

**This package's job is to make the published numbers legible, not to produce
new ones.** Every number it shows is read off one `LayoutDelta` for one edit.

## The three verbs

Each is exactly one `graph.batch`, so the engine sees one patch and answers with
one delta, and `<DagrCanvas animate>` glides rather than reseats.

| Verb | What it does | What the delta says |
| --- | --- | --- |
| `grow` | three tasks and their dependencies appear | 3 added, 6 moved, 26 of 35 stayed put |
| `prune` | those three go away again | 3 removed, 6 moved, 26 of 32 stayed put |
| `relayout` | one dependency appears between two tasks already there | 0 added, 0 removed, 6 moved, 29 of 35 stayed put |

`relayout` is the honest one and the one to watch: nothing arrives and nothing
leaves, so the moved count is the entire story of the edit.

## Five things that are the way they are for a measured reason

**The edits are batched.** Unbatched, each mutating call is its own patch and
its own relayout, React commits once holding the last, and `<DagrCanvas>`
correctly reseats rather than gliding. The picture is right either way, which is
why nothing but a test catches it. `test/edit-script.test.ts` counts the
patches, and reverting the `graph.batch` in `applyStep` turns it red.

**The camera fits once.** That is `<DagrCanvas>`'s decision, taken in M5.1 and
upheld since: a camera that chases every edit hides the stability it exists to
reveal, because a drawing that stays put while the camera moves is
indistinguishable from a drawing that moves. What this package does is make the
rule keepable. `STAGE_WIDTHS` puts nine nodes in the widest column so that a
three-node cluster grown into a six-wide one cannot widen the drawing, the
relayout verb adds no rank, and `AUTOPLAY_CYCLE` is the identity, so the demo
can play forever inside the frame it was fitted to. `test/lap.test.ts` asserts
the bounds are unchanged on every step of a lap. There is a **refit** button
over the canvas, pressed by a person.

**The relayout verb skips exactly two ranks, and two other shapes of it were
tried and measured first.** Moving an edge's source a stage FORWARD changes the
target's rank, which inserts a rank, which shifts every layer below it: the
delta said 25 of 25 nodes moved, beside a readout whose purpose is to say how
few do. Swapping an edge's source for another node in the SAME stage moves
nothing at all, in all 200 candidate swaps this graph offers, because
`gridPositionStage` places a node by its rank and its index within the rank. A
dependency that skips two ranks lands in between: it bends through a virtual
node in the rank it crosses, and that nudges the six nodes nearest it.

**Neither grow target is the rank the relayout verb crosses.** The skip edge's
virtual node sits in `resolve` and takes a node's worth of separation with it,
so growing `resolve` to nine and then linking across it made the column ten wide
and the drawing 50 units wider than the frame the camera had been fitted to.
`test/lap.test.ts` caught that, not a reader.

**The readout refuses to claim a number it cannot support.** `<DagrCanvas>`
calls `onLayout` once per COMMIT, not once per layout, so two unbatched edits in
one task are two deltas and one call carrying the second. `readEdit` compares
the `from` that came with the delta against the result it last counted, by
identity, and says so rather than reporting the last hop as the whole edit. The
demo batches everything, so this is defensive, and it exists because the
alternative is a wrong number beside a correct drawing.

## Modules

| File | What it owns |
| --- | --- |
| `living-graph.ts` | the seeded six-stage pipeline, and the widths that bound the drawing |
| `edit-script.ts` | the three verbs, their availability rules, and the `graph.batch` |
| `readout.ts` | one delta to displayable counts, and the continuity check |
| `appearance.ts` | the colour ramp, and the halo on what the last edit touched |
| `use-reduced-motion.ts` | the media query, server-safe |
| `LivingStage.tsx` | the page around all of it |

```bash
pnpm --filter @dagr/living-stage test
```

`test/lap.test.ts` is the one that keeps the demo honest: it runs a lap through
the real layout engine and asserts that every edit leaves most of the drawing
where it was, that every edit moves something, and that none of them makes the
drawing bigger. Both of the relayout verbs that turned out to be wrong passed
every structural test in `edit-script.test.ts` and failed here.
