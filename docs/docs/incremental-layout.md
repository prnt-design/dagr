---
id: incremental-layout
title: Incremental layout
sidebar_position: 8
---

# Incremental layout

Edit the graph and the parts of the drawing you did not touch stay where they
were. That is the claim Dagr competes on, and this page is the evidence for it
rather than the API behind it: what the stability of an incremental drawing
costs, what it buys, and how both were measured. The types, the engine and the
metrics themselves are on the [layout pipeline](./layout.md) page.

The numbers here come from a committed corpus,
`packages/layout/test/sequence-stability.golden.json`, produced by
`layout.sequence.golden.test.ts` and asserted on exactly. A change to the
pipeline that moves any of them moves the file too, so a stability regression
arrives as a diff someone can ask about rather than as a feeling.

## Why a session and not a patch

Every other stability test in the package measures one edit. A node arrives, and
the drawing before is compared with the drawing after. That is the right shape
for a contract and the wrong shape for the question this page answers.

The warm start is a constraint rather than a hint: a previous layering handed to
the order stage freezes the relative order of the nodes it names, so a crossing
that could be removed by swapping two of them stays there with nothing to give
it back. Measured over a single patch, that cost at most 1.59% in crossings, and
three of six graphs came out cheaper warm than cold. A rule that gives up a
fraction of a point per edit is invisible at one edit and is the whole story at
eighty. Only a session can ask.

So the corpus is six scripted sessions, each a base graph and a fixed list of
edits replayed one patch at a time:

| Session | Steps | Base nodes/edges | Final nodes/edges |
| --- | --- | --- | --- |
| `grow-tall` | 16 | 240/620 | 272/684 |
| `prune-wide` | 16 | 320/900 | 288/723 |
| `rewire-mid` | 16 | 260/780 | 260/780 |
| `reparent-mid` | 8 | 200/520 | 200/520 |
| `churn-balanced` | 16 | 240/640 | 240/640 |
| `pattern-blocks` | 12 | 180/460 | 228/508 |

`rewire-mid` moves an edge at a time, so nothing arrives to widen an influence
set and nothing leaves to shrink one: every node that moves moved because the
layering moved under it. `churn-balanced` adds four nodes and removes the same
four on the next step, so the graph is the base graph again after every second
patch. `pattern-blocks` adds a hub and its leaves in one patch, which is the
shape a pattern generator emits and the case where the order stage is handed a
cohort rather than a node.

## The three configurations

`PreparedState.previous` is the only way a previous run reaches a stage, and two
of the default stages read it: the rank stage hands the previous reversed set to
the cycle breaker and checks the previous ranks against the view it is about to
rank, and the order stage holds to the previous layering. So the corpus runs one
engine three times with that channel cut in three places.

- **Cold.** No stage sees a previous run. Every patch is a fresh layout, which
  is what a caller who throws the engine away and calls `layout()` again gets.
- **Warm order.** The order stage holds to the previous layering. The ranker
  starts cold, so the layers themselves are re-derived every time.
- **Incremental.** Every stage that reads a previous run gets one. This is what
  the engine does out of the box.

Same engine, same stages, same config, same tolerance, same script. The only
difference between two columns is what a stage was allowed to have seen.

## What it costs, and what it buys

Mean crossings across the session, and the mean distance a surviving node
travelled per patch:

| Session | Crossings cold | warm order | incremental | Displacement cold | warm order | incremental |
| --- | --- | --- | --- | --- | --- | --- |
| `grow-tall` | 5,009 | 5,462 | 5,701 | 502.1 | 103.1 | 87.8 |
| `prune-wide` | 14,683 | 15,741 | 15,578 | 1644.8 | 91.2 | 42.9 |
| `rewire-mid` | 11,245 | 12,975 | 12,801 | 1039.8 | 224.2 | 137.1 |
| `reparent-mid` | 4,840 | 4,840 | 4,840 | 0 | 0 | 0 |
| `churn-balanced` | 5,918 | 6,178 | 6,104 | 633.9 | 176.6 | 153.8 |
| `pattern-blocks` | 3,523 | 3,514 | 3,514 | 260.5 | 10.3 | 10.3 |

**The cost is 3.1% to 13.8% in crossings**, incremental against cold, on four of
the five sessions that change the graph. `pattern-blocks` is the fifth and comes
out cheaper warm than cold, by 0.3%. Over a single patch the same trade measured
at most 1.59%, so the honest reading is that the cost compounds: a session pays
several times what one edit suggested it would, and the largest session cost
here is roughly nine times the largest one-patch cost.

**What it buys is between 4.1x and 38.4x less movement.** `prune-wide` is the
extreme, at 1644.8 units per patch cold against 42.9 incremental, and
`churn-balanced` the mildest at 4.1x. The share of the drawing that moves at all
falls with it, and the relative order of the drawing stops churning entirely:

| Session | Moved share cold | incremental | Order churn cold | incremental |
| --- | --- | --- | --- | --- |
| `grow-tall` | 0.85 | 0.52 | 0.26 | 0.00 |
| `prune-wide` | 0.96 | 0.55 | 0.44 | 0.00 |
| `rewire-mid` | 0.97 | 0.73 | 0.40 | 0.00 |
| `reparent-mid` | 0.00 | 0.00 | 0.00 | 0.00 |
| `churn-balanced` | 0.97 | 0.79 | 0.36 | 0.00 |
| `pattern-blocks` | 0.61 | 0.08 | 0.20 | 0.00 |

Order churn at exactly zero, on every session and every step, is the constraint
being total rather than a metric being kind. Two nodes that shared a rank in the
previous drawing are in the same relative order in the next one, always. That is
the property a reader tracking a node across an edit actually relies on, and it
is also the reason the crossing count has nowhere to go: the swap that would
remove a crossing is the swap the constraint forbids.

The numbers here are counts and distances rather than timings, so they are the
same on any machine that runs the suite. What a run costs in milliseconds is
[on the pipeline page](./layout.md#what-a-run-costs), where it is scoped to the
machine it was measured on.

## Two things the corpus found

**Containment is not laid out.** `reparent-mid` changes nothing but which node
contains which, and every column draws the same picture every step: zero
displacement, zero rerouting, the same 4,840 crossings. That is the correct
answer today, because no stage in the pipeline reads a parent, and it is
asserted rather than left implicit so that the day inline compound layout lands
this is the row that says so.

**An edit and its exact undo do not return the drawing to where it started.**
`churn-balanced` adds four nodes and removes the same four, so the graph is
identical at the end of every cycle. The cold and warm-order columns redraw the
base graph and hold exactly what they held at the first cycle boundary, every
number identical at every later one. The incremental column does not: at one
cycle of the eight, its held reversed set gains an edge and keeps it, and the
ranking that follows mints ten more dummy nodes which it also keeps.

That is the retention rule working rather than a leak. A previously reversed
edge is held reversed while it stays a back edge, and the whole point of not
re-deciding is that a drawing does not flip when a graph changes. The price is
hysteresis, and nothing had measured it before this corpus. What is checked is
that it settles: the session's held state takes at most two distinct values
across the seven cycle boundaries it has, and every per-node map is still
exactly the roster of the drawing, so nothing is retained for a node that has
left.

## What is not here yet

Every relayout on this page is a full pipeline run, with one exception noted
below. The stability above comes from what the stages are handed rather than
from work they skip, so a patch that moves nothing still costs a cold layout in
time.

This page predicted that the incremental ranking, the stable coordinate
assignment and the fast paths would each move the incremental column when they
landed. All three have landed, and **not one of them moved a number here**. Each
has a reason, and none of them is that the corpus cannot see:

- **Incremental ranking** checks the previous ranks rather than being seeded
  from them, and longest path has one answer per graph, so a warm ranking IS the
  cold ranking. It changes the work and cannot change the drawing.
- **Stable coordinate assignment** slides a finished Brandes-Koepf drawing back
  onto the previous run's coordinates. `brandesKoepfPosition` is not the default
  position stage, so nothing in this corpus is drawn by it.
- **The zero-stage fast path** answers a patch that changes nothing the pipeline
  reads from the drawing already in hand. It fires on `reparent-mid`, which is
  the one session whose expected answer already was that nothing moves. That
  session is now the exception to the first sentence above: its relayouts run no
  stage at all.

What is still missing is the work the third bullet does not do: a fast path that
declines to run stages for an edit that DOES change the drawing, which is what
would make a small edit cheap in time rather than only stable in space.

The corpus does not yet carry a comparison between the current warm-start rule
and a softer one that would let the transpose pass break a held pair on a
strictly improving swap. That rule was measured and rejected on one-patch
evidence, and the compounding above is exactly the evidence that reopens it.

## Regenerating the numbers

```
UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.sequence.golden
```

Do it when you deliberately changed what the pipeline does and can say what
moved and why. A number that changed without an intended cause is something to
investigate rather than a file to refresh, and that goes for a number that
improved too.
