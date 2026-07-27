# Benchmark harness

The machinery behind the charter's "benchmarks within 10% of baseline", and the
reasoning that makes that rule survive contact with a CI runner.

```
pnpm bench            # run every package's benchmarks, writing a report each
pnpm bench:check      # compare that run to bench/baseline.json, non-zero on a regression
pnpm bench:baseline   # record that run as the new baseline
```

CI runs `pnpm bench` then `pnpm bench:check` on every pull request.

## Why this is not a 10% comparison of milliseconds

Taken literally, "within 10% of baseline" means recording wall-clock times on
one machine and re-measuring them on another. That rule fails constantly, for
reasons that have nothing to do with the code under test, and a gate that cries
wolf gets muted. A muted gate is worth less than no gate, because it also looks
like coverage. Three decisions keep the 10% honest.

**It gates on a ratio, never on milliseconds.** Every bench file runs a fixed
control workload alongside its real ones and each benchmark is recorded as
`median / control median`, measured in the same worker. A runner twice as slow
as the baseline machine runs the control twice as slow too, so the ratio does
not move. Measured across two runs here, two separate workers agreed on the
control to within 1%.

**It gates on the median, not the mean.** A single garbage collection or
scheduler hiccup drags the mean a long way. In the run that motivated this, a
0.016ms operation recorded a 12ms maximum, which put 4.9% of relative margin of
error on the mean while the median barely moved.

**The tolerance widens by the measured noise of the two runs being compared.**
`10% + baseline rme + current rme`, capped at 25%. A quiet pair gates at about
10%; a noisy runner gates wider, on evidence, rather than failing at random.
Because that would otherwise make a noisy enough benchmark unfailable, past 15%
of margin of error a measurement is reported as `noisy` and read as neither a
pass nor a fail. An unreadable measurement is a fact worth printing, not a green
tick.

The residual after all three is real and worth knowing: one control cannot
normalise arithmetic, allocation and cache behaviour at once, so ratios still
drift a few percent between runs. Observed drift here has been under 10% against
tolerances of 11% to 25%. The noise allowance is what covers it. If a benchmark
drifts persistently while its code is untouched, the fix is a second control
matching that class of work, not a wider tolerance: a wider tolerance hides the
drift and the regression together.

## Why it exists

`pnpm bench` used to be `pnpm -r --if-present bench` with no package defining
one, so it passed forever while measuring nothing. Worse, the algorithms review
during M1.3 verified that reverting the allocation guard in `diffAttrs` leaves
all 329 tests passing: a whole class of performance regression was invisible to
the suite.

That case was re-run against this harness. The tests still pass, all 329 of
them. The gate fails at +87.8% on
`2k updateNodeAttrs, unwatched` against a +25.0% allowance, and every other
benchmark stays green.

So most of the code here is guards against the gate quietly becoming a no-op
again. It fails if the run collected no benchmarks; if the baseline holds
nothing to gate against; if a benchmark in the baseline vanished from the run,
because a rename or a removal is a decision and not a silent drop; if a bench
file registers no control; if two packages report the same key; if the reports
are stale, meaning `pnpm bench` was not run first; and if more than half the
gated benchmarks came back too noisy to read, which is the shape the gate would
take if it degraded into measuring nothing.

A benchmark in the run but not in the baseline is reported as `new` and does not
fail, because there is nothing to compare it against. Run `pnpm bench:baseline`.

## Exemptions

Not every benchmark can join the gate. ROADMAP M4.10's 10k-at-60fps figure is
the first that cannot: a GPU frame time measured on one machine has nothing
comparable to gate against on a CI runner, and the roadmap records that
exemption deliberately rather than discovering it later.

An exemption is written into the baseline entry and must carry a reason:

```json
"@dagr/render > frame time, 10k animating": {
  "gate": "off",
  "reason": "GPU frame time. No comparable CI GPU to re-measure against",
  "note": "Apple M4, Chrome 141, zoomed to fit at 2x DPR"
}
```

`gate: "off"` without a `reason` is a hard error, so an exemption is always a
decision someone wrote down rather than the quiet way to stop a failing
benchmark from failing. An exempt entry does not have to appear in the run at
all, which is what lets a hand-measured number live here, and `pnpm
bench:baseline` carries it across rather than deleting it on the next capture.

## Adding a benchmark

Add a `*.bench.ts` under your package's `bench/`, call `registerControl()` once
at the top level, and size each benchmark so one iteration takes a few
milliseconds. That is not arbitrary: vitest samples for a fixed wall-clock
window, so a microsecond iteration is mostly loop overhead and a
hundred-millisecond one yields a handful of samples and a median that means
nothing. Pass `{ time: 3000 }` for a genuinely heavy workload instead of
shrinking it below what it is meant to measure.

Then run `pnpm bench && pnpm bench:baseline` and commit the baseline with the
run, saying in the message what changed to justify the numbers.

Two traps worth knowing. Make sure the benchmark actually does the work: writing
the same attribute value every iteration takes `diffAttrs`'s no-change early
return, which is how the first version of `graph.bench.ts` had its watched and
unwatched numbers agreeing to within 1% while M1.3 had measured them 1.8x apart.
And read the results back through a sink the optimiser cannot see is dead, or
the loop may not survive to be measured.

## The corpora

`smallCorpus()` is 1k nodes and 4k edges; `largeCorpus()` is 10k and 40k. Both
are seeded and deterministic, generated by the same mulberry32 the graph
invariant suite and the layout random suite already use.

They emit plain descriptions, arrays of ids and endpoint pairs, rather than a
`Graph`. `@dagr/graph` is zero-dependency and benchmarks itself, so a corpus
importing it would make the kit and the package it measures depend on each
other, and `@dagr/render` wants the same corpus as coordinates with no graph
model near it.

The shapes are pinned here because they propagate: M2.9 commits golden files
against a corpus, M3.9 states its fast-path targets as absolute latencies on the
10k one, and M4.10 measures a frame budget on it laid out. Those three only
compare to each other if they are looking at the same graph. A share of edges
spans several layers, because those become the dummy chains that outnumber real
nodes on a real layout, and a small share point backwards so cycle breaking has
something to find.

## What must not change quietly

`controlWorkload` in `src/control.ts`. Every recorded ratio is relative to it, so
editing it silently rebases the entire committed baseline. If it has to change,
change it and run `pnpm bench:baseline` in the same commit, and say so in the
message.

## Layout

`src/control.ts`, `src/corpus.ts` and `src/register.ts` are TypeScript, compiled
by vitest, and reached through `@dagr/bench` by a `paths` entry and a vitest
alias in each consuming package. `src/gate.mjs`, `src/collect.mjs`,
`src/baseline.mjs` and `bin/bench-check.mjs` are plain `.mjs` with JSDoc types,
because they run under bare `node` in a CI job that has deliberately not built
anything yet; `checkJs` keeps them under the same strict compiler as everything
else. `src/names.mjs` holds the two names both halves need.
