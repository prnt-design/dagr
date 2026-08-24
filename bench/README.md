# Benchmark harness

The machinery behind the charter's "benchmarks within 10% of baseline", and the
reasoning that makes that rule survive contact with a busy machine.

```
pnpm bench            # run every package's benchmarks, writing a report each
pnpm bench:check      # compare that run to bench/baseline.json, non-zero on a regression
pnpm bench:baseline   # record that run as the new baseline
pnpm bench:ci         # measure up to three times, and pass when two runs agree
```

The agent runs `pnpm bench:ci` before it opens a pull request, and does not
merge on a regression. CI does not run it.

The gate lives here rather than on CI because the baseline is machine-matched.
`bench/baseline.json` records the machine it was captured on, and a comparison
is only meaningful against the same one. Since 2026-08-18 that is enforced
rather than only stated: run this gate on a runner the baseline does not name,
CI's included, and it says so instead of reporting the regressions it appears to
have found. GitHub's x64 Ubuntu runners are not
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
It has since changed again without anyone moving: the box became an Intel Xeon
Skylake on 2026-08-18, this file still names the EPYC, and a recapture is queued
rather than taken. See "The machine in the file" below for how the gate says so
now, and for what it cost to find out by hand.
The CI argument above is unchanged by the baseline being x64 Linux: the
remaining reason the gate stays local is runner noise and runner identity, not
which architecture the file happens to name.

**The current file was captured on 2026-08-16 between 05:20 and 05:29 UTC and
supersedes PR #21's capture of 2026-08-14.** Same machine, different conditions,
which is the whole reason for it: PR #21 was taken when one agent ran on this
box at a time, and the box now carries several sessions at once. The maintainer
called the recapture after four sessions escalated the same symptom. It was
taken in a trough between the neighbours' bursts, with the 1-minute load between
0.40 and 2.13 for the whole set, a warmup run discarded, and FIVE measured runs
rather than three: the first three disagreed by 32.5% on `build > 1k` and 26.7%
on `isAcyclic, acyclic`, so two more were taken to find out which of them was
representative. The file is run 3. `loadAverageAtCapture` reads 1.3 because
`bench:baseline` sampled it when the file was written, half an hour after the
runs it holds; the figures above are what the measurements were taken under, and
that gap is the reason the field's name is as narrow as it is.

**Measure closeness over the GATED entries only when picking which run to
commit.** The first pick here was run 4, on a per-entry closeness computed over
all fifteen: `2.5k successors` is exempt, it swings further than anything else
in the file, and it pulled the choice by more than the gated entries did. Over
the fourteen that actually gate, run 3 sits at 2.28% mean absolute deviation
from the per-entry medians and run 4 at 2.94%. Run 4 was quieter WITHIN its runs
by about 0.5 percentage points of rme per entry, which is a real cost, and
centring still wins: a baseline off-centre by 10% moves every future comparison
against that entry and prints `is N% faster than baseline` forever, while rme
only widens the allowance and hits the same 25% cap either way.

**The old file was not far wrong, and that is the finding.** Eleven of the
fourteen gated entries moved less than 6%, the largest being `2.5k outEdges` at
-11.0%, `sources, 10k` at -10.8% and `isAcyclic, acyclic` at +9.4%. So the
flakiness that motivated this was never mostly a stale baseline: it is the
between-run spread on this machine, measured over the five capture runs as a
30.6% band on `build > 1k`, a 40.7% band on `isAcyclic, acyclic`, a 39.8% band
on `rank > 1k` and a 35% band on the already-exempt `2.5k successors`, on an
idle box with no code changing. A fresh baseline re-centres those bands; it
cannot narrow them. Two of three is what keeps them from failing a merge, and
the two changes ship together for that reason.

**A recapture moves the effective tolerance even though it touches no
constant**, and saying "the tolerances are unchanged" without that sentence
would be a half-truth. The formula adds the BASELINE's margin of error, so a
noisier baseline gates wider on that entry. Comparing each entry against an
equally noisy re-run, seven of the fourteen widened and four now sit at the 25%
cap where two did: `build > 1k`, `rank > 10k`, and now `descendants, 10k`
(1.60% rme to 5.86%) and `pipeline > 1k` (4.45% to 12.70%). Those four are close
to ungated, and they are named here for the same reason the weakest entries are
named below: an allowance nobody wrote down is the kind that stops being
noticed. Narrowing them is a capture on a quieter machine or a second control,
not a smaller number asserted here.

## The machine in the file

**The baseline records the machine it was captured on, and since 2026-08-18 the
gate reads it back.** If the machine that ran the benchmarks is not the machine
the baseline names, `bench:check` rejects the comparison and says which fields
differ, instead of printing the regressions it appears to have found.

It reads back the fields that decide whether two runs are comparable at all:
`platform`, `arch`, `cpu`, `cores` and `node`. It ignores `ci` and
`loadAverageAtCapture`, which describe who started a run and how busy the box
was, because gating on those would block a merge over a neighbour's build. A CPU
model is compared with its whitespace collapsed, since `os.cpus()` pads some
models to a fixed width and a merge blocked by two spaces would teach the next
reader to distrust the check. A report that records no machine at all is noted
rather than failed: the field is optional in schema 1, and a hand-written
baseline without one is not evidence of a mismatch.

**It is reported as a harness error and not as a regression**, which is the same
distinction a stale package report gets and for the same reason. A different
machine reproduces on the next run by construction, so `bench:ci` fails on the
first measurement rather than spending three reproducing it. That matters more
here than anywhere else in the harness: a mismatched baseline moves whole
families of entries at once, so it fails the SAME entries every run, which is
exactly the shape this gate calls its strongest evidence for a real regression.

**Why it was worth adding, measured rather than supposed.** The dispatch box was
an AMD EPYC-Rome VM when the committed baseline was captured on 2026-08-16 and
an Intel Xeon Skylake on 2026-08-18. Nothing announced it, and the harness had
recorded `machine.cpu` on both sides all along without ever comparing them, on
the argument that the gate reads control-normalised ratios and a ratio corrects
for a slower machine. It corrects for a UNIFORMLY slower machine. One control
workload normalises one mix of arithmetic, allocation and cache behaviour, so a
CPU with a different cache and memory profile moves everything whose mix differs
from the control's, which is the control drift already named above arriving as a
step change rather than as noise. Unmodified `main` failed its own gate 2 of 2 on
2026-08-18 morning and again that evening at a 1-minute load of 0.54 under a
5-minute 0.40, the quietest start on record here.

Which of the two evening runs is being quoted matters, so here are both. RUN 1
IS THE DIAGNOSIS. It failed exactly six entries, at +27.1% to +44.3%: `2.5k
outEdges`, `descendants, 10k`, both `pipeline` entries and both `rank` entries,
every one of them memory-latency bound. Every allocation-heavy entry passed on
that same run, `2k updateNodeAttrs` at +0.0%, +1.7% and -6.2% and both
`isAcyclic` entries inside 0.3%, which is the two families separating cleanly.
Run 2 was the louder of the two: it failed eleven, adding the three
`updateNodeAttrs` entries, `build > 1k` at +61.9% and `topologicalOrder`, and
taking `descendants, 10k` to +69.8%. A loud box adds names to the list, exactly
as the `diffAttrs` verification in ROADMAP M0.2 recorded. The six that failed
BOTH runs are run 1's six. Two days of sessions read all of this as a regression
in their own branch, and one of them spent four gates and a hand-written A/B
proving that its own code was not the cause.

**There is deliberately no way to compare across machines anyway.** An override
flag would be the quiet no-op this harness exists to prevent, and it would be
reached for on exactly the runs where the numbers mean least. The answer to a
mismatch is a recapture, which is the section above and is the maintainer's
call.

**What this does not fix.** It does not make a gate green, and it is not the
second control workload. The between-run spread measured for the recapture,
30.6% on `build > 1k` across five idle runs with no code changing, was measured
on ONE machine and is a separate problem that a machine check cannot see.

## Two of three

`pnpm bench:ci` measures up to three times and passes when two runs pass. Two
runs that fail fail it. Three runs that never agree are reported as undecided,
which is not a pass either: the property this gate claims is a REPEATABLE pass,
and a set of runs that never repeated has not shown one. A passing gate
therefore costs two measurements, and a failing or undecided one costs two or
three; a measurement here is about 70 seconds.

It measured once before 2026-08-16, and what changed is not the code but the
machine. This box now carries several agent sessions at a time, some of them in
an unrelated checkout that cannot read the gate lock, and the committed baseline
was captured when one agent ran at a time. The result, measured across five
sessions on branches that changed nothing the gate can see: unmodified `main`
failed a run and passed the next a minute later; a markdown-only branch passed
at a 1-minute load of 4.56, failed at 5.07 and passed again at a HIGHER 6.18; a
branch whose diff was zero bytes against `packages/graph`, `packages/layout` and
`bench` reported `descendants, 10k` at +94.9% and `rank > 1k` at +59.9%, on a
run where the pipeline entry that RUNS ranking came in at -5.5%. Sessions coped
by re-running the gate until it went green, by hand, which is exactly the habit
that hides a real regression. The gate does the repeating itself now, and says
what it saw.

Repeating is not a way to let a regression through, and the arithmetic is the
argument. A regression is in the code, so it fails the SAME entry every run,
which means it fails twice and the gate fails with it. Noise picks a different
entry each run: across those five sessions the failures were `descendants, 10k`,
`updateNodeAttrs, watched`, `build > 1k`, `rank > 1k`, `isAcyclic` and
`topologicalOrder`, none of which the branches could have touched. So a failure
prints which of the two shapes it saw, naming the entries: the same entry twice
reads as real until the code says otherwise, and a different entry each time
reads as this box. That sentence costs nothing beyond runs already taken, and it
is the cheapest real-versus-noise test the project has.

This is the other half of a bargain, and the halves only work together. No
tolerance CONSTANT was loosened to absorb the noise, because a wider tolerance
hides the drift and the regression together, and a fresh baseline plus
repetition is what replaces a looser number. Say it that precisely, though: the
formula adds the baseline's own margin of error, so recapturing on a noisier
machine widens the effective allowance on the entries whose rme rose, seven of
fourteen here. The numbers are in the baseline-machine section above, because an
allowance that moved without anyone editing a constant is exactly the kind that
stops being noticed.

**What two of three does not fix, measured rather than guessed.** A burst of
neighbour load on this box runs for about eight minutes and a whole gate takes
two to four, so a burst that arrives mid-gate can fail the same entry twice. It
did on 2026-08-16 at 06:00, on a branch whose diff was zero bytes against
`packages/graph`: `sources, 10k` failed at +25.3% and then at +40.4% while the
1-minute load went from 2.37 to 6.37, and the gate duly reported the same entry
twice. The same-entry report is therefore evidence and not proof, which is why
it says to read a repeat as real UNTIL THE CODE SAYS OTHERWISE rather than
asserting it. Two checks settle it and both are cheap: read the failing entry
against the rest of the same run, since a stage entry failing while the pipeline
entry that runs that stage is negative cannot describe a regression, and re-run
once the box is quiet. Repetition narrows the window that noise can fail a merge
through. It does not close it, and nothing available here does.

A regression and an unreadable measurement are still different facts and still
get different responses. `bench:check` exits 1 for a regression and 2 when the
run was too noisy to read, and an unreadable run is neither a pass nor a fail:
it does not count towards either two. What used to be "retry once on exit 2"
generalises into the attempt budget above, and three unreadable runs say plainly
that nothing was measured, so nothing is being claimed about the code.

The noise is predictable rather than hypothetical. The agent runs this gate on
the same machine that just ran its persona reviewers, and a run started while
those were still resident put 7 of 10 benchmarks past the readability ceiling.
The same benchmarks on a settled machine a few seconds later came back with all
10 readable and inside tolerance. Failing a merge over that would make the gate
a flake generator, which is what this design set out to avoid; passing it
silently would make the gate a no-op, which is what the harness was written to
fix. Measuring again is the only answer that is neither.

A harness error is not measured again. A stale report, a missing baseline, a
duplicate key or a malformed exemption reproduces on the next run by
construction, so the gate fails on the first one rather than spending two more
measurements reproducing it. That distinction is also why a stale package report
is not read as a regression: a dropped package leaves every baseline entry under
it looking `missing`, which has a regression's shape and none of its meaning.

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
control to within 1%. That claim is about a runner that is UNIFORMLY slower, and
it is the one claim in this file with a hard edge: a machine with a different
cache and memory profile moves everything whose mix differs from the control's
while the control looks fine, which is why the gate now refuses to compare
across machines at all. See "The machine in the file".

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

**Take a fourth and a fifth run when three do not agree, rather than picking
one of the three.** The 2026-08-16 recapture had to: `build > 1k` sat 32.5%
above its neighbours on run 2 and `isAcyclic, acyclic` spanned 26.7% across the
set, and three runs cannot say which of them is the odd one out. Two more runs
answered it in two minutes, and they also moved the choice, since the run that
looked closest to the medians of three was not the one closest to the medians of
five. The cost is 70 seconds a run; the alternative is committing a file that
makes one entry print `is 31% faster than baseline` on every future run, which
is the pathology this whole section is about.

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
full evidence is in the entry's own `reason`. The 2026-08-16 recapture measured
it again over five quiet runs, at 37.51 to 50.71, a 35% band, so the exemption
stands. Re-enable it if the baseline moves to a machine where three runs agree
on it.

Among the gated entries, four are weakest by margin of error, and the whole list
is given rather than the top two, because each of them gates at the 25% cap
against a similarly noisy re-run and a reader trusting a short list would not
know the rest were there: `pipeline > 1k` (12.70% rme at 10 samples, median
124.16ms), `rank > 10k` (9.49% at 13), `build > 1k nodes and 4k edges from
empty` (8.31% at 91, median 4.02ms) and `descendants, 10k` (5.86% at 183). The
cap is close to ungated. They are left that way deliberately, because turning
them off reduces real coverage and switching the gate to a trimmed statistic
changes every entry in the file. Both are decisions to take on purpose rather
than side effects of a recapture.

READ BETWEEN-RUN SPREAD AS A SEPARATE WEAKNESS FROM rme, because the two do not
pick the same entries. Over the five runs of the 2026-08-16 capture, on an idle
box with no code changing, `build > 1k` spanned 30.6%, `isAcyclic, acyclic`
40.7% and `rank > 1k` 39.8%, while `rank > 1k` recorded rme between 1.3% and
4.8% in those same runs: it is quiet WITHIN a run and moves BETWEEN runs, which
is precisely the error the control is supposed to cancel and does not. Those
three are what two of three is carrying, and they are the standing argument for
the second control workload this file keeps naming. `rank > 1k` has now been the
failing entry five times across six sessions, which makes it the entry to look
at first.


## Layout

`src/control.ts`, `src/corpus.ts` and `src/register.ts` are TypeScript, compiled
by vitest, and reached through `@dagr/bench` by a `paths` entry and a vitest
alias in each consuming package. `src/gate.mjs`, `src/collect.mjs`,
`src/baseline.mjs` and `bin/bench-check.mjs` are plain `.mjs` with JSDoc types,
because they run under bare `node`, in a job that has deliberately not built
anything yet; `checkJs` keeps them under the same strict compiler as everything
else. `src/names.mjs` holds the two names both halves need.
