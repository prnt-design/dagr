# Benchmark harness

The machinery behind the charter's "benchmarks within 10% of baseline", and the
reasoning that makes that rule survive contact with a busy machine.

```
pnpm bench            # run every package's benchmarks, writing a report each
pnpm bench:check      # compare that run to bench/baseline.json, non-zero on a regression
pnpm bench:baseline   # record that run as the new baseline
pnpm bench:ci         # both of the first two, re-measuring once if the run was unreadable
```

The agent runs `pnpm bench:ci` before it opens a pull request, and does not
merge on a regression. CI does not run it.

The gate lives here rather than on CI because the baseline is machine-matched.
`bench/baseline.json` records the machine it was captured on, and a comparison
is only meaningful against the same one. GitHub's x64 Ubuntu runners are not
the machine the baseline came from, and the ratio normalization below corrects
for a slower machine, not for a different architecture. Gating on CI reported
eleven regressions between +23% and +76% on a commit that changed one docs
page.

Which machine that is has changed once and can change again: the current file
was captured on the dispatch box, an x64 AMD EPYC-Rome VM, replacing a capture
from the maintainer's arm64 M1 Pro after `bench:ci` on the VM showed the
mismatch signature (failures concentrated in a package the change never
touched; every `@dagr/graph` ratio had moved +10.2% to +69.8% with no commits
to its `src`, which is exactly the shift the control cannot cancel). The
mismatch now points the other way: a run on the maintainer's arm64 machines
will fail against this file the same way, and moving development back there
means recapturing on the same terms, three agreeing runs on a quiet machine.
The CI argument above is unchanged by the baseline being x64 Linux: the
remaining reason the gate stays local is runner noise and runner identity, not
which architecture the file happens to name.

## When the runner is too busy to measure

A regression and an unreadable measurement are different facts and get
different responses. `bench:check` exits 1 for a regression and 2 when the run
was too noisy to read; `bench:ci` retries only on 2, after letting the machine
settle, and a real regression fails on the first attempt and is never retried.

The noise is predictable rather than hypothetical. The agent runs this gate on
the same machine that just ran its persona reviewers, and a run started while
those were still resident put 7 of 10 benchmarks past the readability ceiling.
The same benchmarks on a settled machine a few seconds later came back with all
10 readable and inside tolerance. Failing a merge over that would make the gate
a flake generator, which is what this design set out to avoid; passing it
silently would make the gate a no-op, which is what the harness was written to
fix. Measuring again is the only answer that is neither. Two unreadable runs in
a row fail the gate, and say plainly that nothing was measured, so nothing is
being claimed about the code.

Run the gate after the reviewers have exited. They are themselves the load.

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
`10% + 5% control drift + baseline rme + current rme`, capped at 25%. A noisy
runner gates wider, on evidence, rather than failing at random. Because that
would otherwise make a noisy enough benchmark unfailable, past 15% of margin of
error a measurement is reported as `noisy` and read as neither a pass nor a
fail. An unreadable measurement is a fact worth printing, not a green tick.

That 5% is a separate term rather than padding folded into the 10%, because it
is a different kind of error. `rme` describes sampling noise inside one
measurement. Control drift is systematic: one control workload cannot normalise
arithmetic, allocation and cache behaviour at once, so a benchmark whose mix
differs from the control's moves against it between runs even when both were
measured cleanly. Measured here on `2.5k outEdges`, almost pure pointer chasing
against an allocation-heavy control: five runs on one idle machine, no code
change, its own margin of error steady near 0.7%, landing between -9.5% and
+9.9%. Without the term that benchmark gates at about 11% and flakes.

So the effective floor is nearer 15% than 10%, and that is said plainly rather
than dressed up, because the honest reading of the charter's 10% is "10% of a
number this harness can actually resolve". Shrinking it is earned by making the
control track better, most likely a second control for low-allocation work, and
not by asserting a tighter number than the measurement supports. A benchmark
that drifts persistently while its code is untouched is evidence for that second
control, not for a wider tolerance: a wider tolerance hides the drift and the
regression together.

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
the first that cannot: a GPU frame time is measured by hand in a browser, and
there is no automated way to re-measure it again later, even on the baseline
machine, so it has nothing to gate against. The roadmap records that exemption
deliberately rather than discovering it later.

An exemption is written into the baseline entry and must carry a reason:

```json
"@dagr/render > frame time, 10k animating": {
  "gate": "off",
  "reason": "GPU frame time. Hand-measured in a browser, no automated re-measurement path",
  "note": "Apple M4, Chrome 141, zoomed to fit at 2x DPR"
}
```

`gate: "off"` without a `reason` is a hard error, so an exemption is always a
decision someone wrote down rather than the quiet way to stop a failing
benchmark from failing. An exempt entry does not have to appear in the run at
all, which is what lets a hand-measured number live here, and `pnpm
bench:baseline` carries it across rather than deleting it on the next capture.
A key the run does produce keeps its `gate` and `reason` too, with the stats
beneath refreshed, so recapturing cannot silently re-gate an entry: lifting an
exemption is the same kind of act as adding one, a hand edit with the reason
for it in the commit. (The first rule here let a produced key reclaim its
gate; it was reversed when the first produced-and-exempt entry arrived,
because a capture that re-gated `2.5k successors` by side effect would re-arm
the exact flake its exemption exists to prevent.)

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

The shapes are pinned here because they propagate: M3.9 states its fast-path
targets as absolute latencies on the 10k one, and M4.10 measures a frame budget
on it laid out. Those two only compare to each other if they are looking at the
same graph. A share of edges spans several layers, because those become the
dummy chains that outnumber real nodes on a real layout, and a small share point
backwards so cycle breaking has something to find.

**M2.9 split, and this paragraph used to say it commits golden files against
these two.** It commits two different artefacts against two different corpora,
and which is which matters to anyone reading either. Its published cost table,
`packages/layout/test/layout-cost.json`, is measured on THESE corpora, so it is
the one M3.9 and M4.10 compare against and the reason a stage-by-stage
millisecond figure for the 10k now exists. Its dagre parity corpus is a separate
set of nine hand-authored graphs at varied box sizes, in
`packages/layout/test/dagre-parity-corpus.ts`, and is not these. Two reasons,
and the first one is not negotiable: parity's crossing metric is a geometric
count over emitted polylines, which is quadratic in segments and does not run at
the 214,222 segments the 10k produces. The second is that every graph here is a
seeded layered random graph drawn at one uniform box size, which is the
distribution this package's own stages were tuned against and the regime M2.8's
review found a real bug hiding outside of. Neither corpus substitutes for the
other and neither is going away.

## What must not change quietly

`controlWorkload` in `src/control.ts`. Every recorded ratio is relative to it, so
editing it silently rebases the entire committed baseline. If it has to change,
change it and run `pnpm bench:baseline` in the same commit, and say so in the
message.

The same hazard, from the other end: a milestone that grows the WORKLOAD a
benchmark measures rebases that benchmark's entry just as surely, without
touching a line of bench code. M2.4b was the first: dummy chains take the nodes
the layout pipeline places on the 10k corpus from 10,000 to 184,222, and the
segments it orders and counts crossings between from 13,131 to 214,222. It
remains the only one. M2.5 through M2.8 were each expected to do it again and
none of them did: replacing a later stage with a better algorithm changes what
a benchmark COSTS, which is what the tolerance is for, and only a change to
what a benchmark PROCESSES rebases it. M2.8's own entry in `ROADMAP.md` states
that distinction, having had to make it. Recapturing can be right in the case
this paragraph is about, and it is the same recipe: recapture in the same commit
and say why in the message. What separates it from talking a gate out of a
failure is one habit, so make it one: PREDICT
THE MAGNITUDE BEFORE YOU MEASURE, from what the change actually does, and put
the predicted figure next to the measured one in the commit message. A ratio
near the prediction is a measurement of known extra work. A ratio well above it
is a regression hiding inside a rebase, in the one place nobody will look
again.

Two consequences, because a habit with no consequence is a note to self. **A
ratio above the prediction blocks the recapture** until the excess is attributed
to named work in the commit message. Attributing it means measuring it, not
arguing it: M2.4b predicted its rank entry at +50% to +200%, measured +410.9%,
and timed the stage in one process to show that 90.38ms of its 115.60ms was the
splitter minting 174,222 ids, at which point the excess had a name and the
prediction was the thing that had been wrong. **And the recapture is the
maintainer's call rather than the agent's**, whichever way the prediction came
out. An agent measures, states both options and asks; it does not run
`bench:baseline` to turn its own gate green. The one exception already on the
record is a machine mismatch, where the baseline names a machine that is not the
one in front of you, and that is a different fact about a different thing.

## The third reason to recapture: the baseline itself was mis-measured

The two cases above are both about the RUN moving. This one is about the
BASELINE having been wrong when it was taken, and it is worth its own section
because it took four milestones to recognise and because the gate's own advice
points the wrong way on it.

The symptom is the harness printing `is N% faster than baseline. Refresh the
baseline so the gain is protected` on the same handful of entries, run after
run, in a package the milestones taking those measurements never touched.
M2.4c, M2.6d, M2.8 and M2.9 each recorded it on four `@dagr/graph` entries and
each declined to act, correctly, because a recapture is the maintainer's call.
That note is written for a real gain. There was no gain: `git log` over
`packages/graph/src` since the capture is empty, so there was nothing to
protect.

**The diagnostic is the margin of error, not the median.** Sort the entries by
the rme the BASELINE run recorded and the pattern is unmistakable. Measured
across the eleven `@dagr/graph` entries on a machine at a 1-minute load of 3.46,
against a baseline captured at an unrecorded and evidently higher one: every rme
fell, the five entries whose baseline rme was above 2% came in 29.0% faster on
average, and the six below 2% came in 1.7% faster.

The mechanism is intermittent interference inflating the TAIL of a run, and the
floor is what shows it. Three consecutive runs of `2.5k successors` on an idle
machine recorded minima of 1.927, 1.883 and 1.829ms, a spread of 5.4%, while
their maxima were 4.68, 2.46 and 2.89 and their 99th percentiles 4.58, 2.35 and
2.49. The work itself takes the same time every run. What changes is how often
something else on the machine interrupts it, and a benchmark drawing its median
from a few hundred samples inherits more of that than one drawing from tens of
thousands. That is the same fact as the rme correlation above, seen from the
other end, and it is one explanation rather than two.

The counter-case to rule out is control drift, and it is one division. Every
ratio is `median / control median`, so a control that got slower makes every
entry look faster without anything moving. Divide any entry's `medianMs` by its
`ratio` to recover the control the baseline was taken against and compare it to
the one being shipped. Here it is 0.06525ms against 0.06337ms, a control 2.9%
FASTER, which pushes ratios the other way and so rules that explanation out
rather than supporting it.

That division is also the difference between the two ways an entry can be
quoted, and they can disagree by enough to matter. `2.5k outEdges` moved -8.6%
by median and -5.9% by ratio across this recapture, and the 2.9% between them is
exactly the control. The gate reads ratios. A prediction written in medians has
to be scored in medians.

### How to take the replacement

**Gate on reproducibility, which is what a baseline is for.** Run the suite
three times and require the medians to agree before capturing. One clean-looking
run cannot demonstrate that a second run will land near it, and that is the only
property that matters: the gate's entire job is to compare a later run to this
file. And compare the runs directly, entry by entry; a green `bench:check`
between them is not the agreement test, because entries already sitting at the
25% tolerance cap pass it with medians a quarter apart.

**Throw away the first run after an idle spell.** On the dispatch box, the
first suite run after the machine had been idle put `rank > 1k` at 13.29% rme
and 39 samples where the two runs behind it recorded 1.5 to 2.5% at 57 to 60,
read at the median, not the mean. The rejected single-run capture before it
carried the same signature, 14.06% at 39 samples. Warm the machine with a
discarded run, then take the three that count. The capture that shipped did
this, and picked the run closest to the three runs' per-entry medians.

**Compare the MEDIAN, and check you are reading it.** A vitest bench report has
a `median` field and does not have `p50`. `1000 / hz` is the MEAN, and a
fallback chain that reaches for it silently produces a table of means, which is
precisely the statistic this harness gates on the median to avoid: a single
interrupted sample moves it a long way and moves the median barely at all. A
three-run comparison built on means was what first suggested a cold-start effect
here, and the effect disappeared when the same runs were read at their floors:
the minima were flat while the maxima were not.

**Record the load average you captured at.** `machineInfo` in `src/baseline.mjs`
writes `loadAverageAtCapture` as of the M2.9 follow-up. The baseline it replaced
carried nothing of the kind, so answering "was that taken on a busy machine"
meant inferring it from rme. The name is deliberately narrow and the docstring
says why: it is sampled by `bench:baseline`, a process that runs after the
benchmarks, so it includes the run's own load and describes the moment of
capture rather than the moment of measurement.

### What not to gate the capture on

Two instruments that look right and are not.

**The 1-minute load average, alone.** It lags, so a capture that starts under
the ceiling can finish above it. A capture gated only on load produced a file
whose own margins of error were WORSE than the run it replaced on five entries,
topping out at 5.48%.

**Every entry's rme under a ceiling.** Three of the fifteen benchmarks draw
their median from 10, 10 and 30 samples, because one iteration takes 73ms to
1.1s and vitest samples for a fixed wall clock. None of the three is reliably
under 3%: across six rejected runs on an idle machine `rank > 10k` recorded
3.65% to 5.36% and `pipeline > 1k` 2.90% to 4.64%, and the shipped capture has
them at 7.15% and 4.45%. They can each land under 3% and cannot be counted on
to, so requiring all fifteen under 3% in one run is a bet those three lose, and
a capture gated that way was rejected six times running before the ceiling was
recognised as unreachable rather than the machine as busy. rme was the EVIDENCE
that the old baseline was taken badly; it is not the property a good baseline
has to have.

### The weakest entries in the current file, named rather than left to be found

One entry is exempt outright. `2.5k successors` carries `"gate": "off"` in the
current file, because across nine quiet-machine runs on the dispatch box its
control-normalized ratio ranged 37.7 to 61.8, a 64% band, while its within-run
rme stayed under 6%: the between-run variance is real, exceeds the 25%
tolerance cap, and a gate on it would flag noise rather than regressions. The
full evidence is in the entry's own `reason`. Re-enable it if the baseline
moves to a machine where three runs agree on it.

Among the gated entries, `build > 1k nodes and 4k edges from empty` (7.46% rme
at 99 samples, median 4.09ms) and `rank > 10k` (7.15% at 13 samples) are the
weakest: the tolerance formula adds both runs' rme, so each gates at the 25%
cap, which is close to ungated. They are left that way deliberately, because
turning them off reduces real coverage and switching the gate to a trimmed
statistic changes every entry in the file. Both are decisions to take on
purpose rather than side effects of a recapture.


## Layout

`src/control.ts`, `src/corpus.ts` and `src/register.ts` are TypeScript, compiled
by vitest, and reached through `@dagr/bench` by a `paths` entry and a vitest
alias in each consuming package. `src/gate.mjs`, `src/collect.mjs`,
`src/baseline.mjs` and `bin/bench-check.mjs` are plain `.mjs` with JSDoc types,
because they run under bare `node`, in a job that has deliberately not built
anything yet; `checkJs` keeps them under the same strict compiler as everything
else. `src/names.mjs` holds the two names both halves need.
