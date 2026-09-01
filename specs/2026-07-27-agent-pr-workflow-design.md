# Agent PR workflow

Date: 2026-07-27
Status: implemented. The live process is AGENTS.md's "How work reaches main";
this file is kept as the argument behind it.

## Problem

Two scheduled dispatch jobs (`dagr-daily`, `dagr-daily-b`) build Dagr, eight
runs a day between them. Both merge straight to `main` and push. No pull
request is ever opened, so there is no consolidated artifact for a run's work
and no gate between an agent's local judgement and the default branch.

Separately, CI has been red on `main` for every run since `bench:ci` was wired
into the workflow at 01:06 on 2026-07-27. Four consecutive failures, including
on commits that changed only documentation.

These two problems interact. Gating merges on green CI without fixing the CI
failure would block every run forever.

## Diagnosis: why CI is red

`bench/baseline.json` records the machine it was captured on:

```json
"machine": { "platform": "darwin", "arch": "arm64", "cpu": "Apple M4",
             "cores": 10, "node": "v25.6.1", "ci": false }
```

CI runs `ubuntu-latest`, which is x64. The bench harness normalizes with a
control workload (`median / control median`) precisely so a slower runner does
not fail the gate, and that reasoning holds for a runner that is uniformly
slower. It does not hold across architectures, where memory-bound graph
traversal and the control workload degrade by different factors.

The evidence is the last red run, commit `c08e444`, which touched one docs
page and nothing else. Eleven benchmarks reported regressions between +23% and
+76%. No code changed, so no code regressed. The gate is measuring the
difference between an Apple M4 and a shared Ubuntu runner.

A second, independent cause: the job prompts mandate `pnpm typecheck && pnpm
test` before merging, but CI also runs `pnpm lint` and `pnpm build`. A run can
satisfy its own gate and still push a commit that fails CI.

## Decisions

1. **The bench gate moves off CI and stays local.** CI runs typecheck, test,
   lint and build. The agent runs `pnpm bench:ci` on its own machine, where
   the M4 baseline is valid, as a mandatory pre-merge step.
2. **Agents merge their own PRs** once CI is green, preserving the unattended
   eight-runs-a-day cadence.

Rejected: recording a second CI baseline (shared runners are noisy and the
baseline drifts with runner generations, so it becomes ongoing flake
maintenance), and making bench non-blocking on CI (AGENTS.md requires no
allowed-to-fail steps, and an unenforced gate decays into noise).

## Design

### CI workflow

`.github/workflows/ci.yml` drops the `pnpm bench:ci` step. The comment block
above it is replaced with one explaining that the bench gate is enforced
locally against a machine-matched baseline, and why a cross-architecture
comparison cannot gate.

The gate loses no teeth. On 2026-07-27 the `dagr-daily` run caught a 165x
regression in M2.4b through the local bench gate and correctly refused to
merge. A gate that reports +76% on a docs commit could never have isolated
that signal.

### The merge step

Step 5 of both job prompts changes from "rebase, merge to main, push" to:

1. Run the full local gate: `pnpm typecheck && pnpm test && pnpm lint && pnpm
   build && pnpm bench:ci`. Lint and build are new to this list and close the
   second cause above.
2. Rebase onto `origin/main`. If the rebase brought in changes, re-run the
   gate.
3. Push the branch and open a PR with `create_pr`.
4. Poll `get_pr_status` until CI concludes. A run takes about 90 seconds; cap
   the wait at 20 minutes.
5. If CI is red, fix on the branch, push, and poll again. If green cannot be
   reached, leave the PR open, write the blocker into `state.blockers`,
   release the workboard claim, append a `blocked` event, notify, and stop.
   Never merge a red PR.
6. If CI is green, merge the PR and delete the branch. If `main` moved
   underneath, rebase, push and poll again rather than forcing.

The existing hard rule "never merge without green typecheck + tests (+ bench
within 10%)" gains "and green CI on the pull request".

### Persona reviews

Personas keep running where they run today: on the working diff, before the PR
is opened, launched with `dispatch_launch_persona` and selected by the
packages the diff touches. That ordering already works, drawing 14 to 18
findings per run, all addressed.

What changes is that the PR body carries the review record: which personas
ran, what each found, and how every finding was resolved or accepted with a
reason. The PR becomes the consolidated artifact for the run instead of the
review history living only in brain events.

### Where the procedure lives

The operating prompt is currently duplicated four times: two jobs and the two
templates backing them. Any edit is a four-way sync that will drift.

The canonical merge procedure moves into `AGENTS.md`, which every run already
reads and which agents may not edit. The four prompts reference it rather than
restating it. This is the one part of the change that touches a human-owned
policy file.

## Out of scope, queued for the human

`main` is unprotected. This design is convention-only until branch protection
requires the CI check on `main`. Agents may not change repo settings by
charter, so enabling it is the maintainer's action. Without it, nothing
prevents a future run from pushing directly.

## Consequences

A PR can be green on GitHub while the local bench gate blocks the merge. That
is intended and preserves the M2.4b behavior.

Runs get slower by roughly the CI poll, a few minutes against a four hour
timeout.

Two runners now open PRs concurrently. Workboard claims already prevent
package overlap, so their PRs should not conflict; whichever merges second
rebases.

## Files

- `.github/workflows/ci.yml`: remove the bench step, rewrite its comment.
- `bench/README.md`: line 13 states CI runs `pnpm bench:ci` on every pull
  request, which stops being true. The "when the runner is too busy to
  measure" section now describes the agent's own machine under persona load
  rather than a GitHub runner.
- `AGENTS.md`: add the PR workflow as the operating contract.
- Job prompts `dagr-daily` and `dagr-daily-b` via `update_job`, and templates
  `10c67030` and `87bb26b6` via `update_template`: rewrite step 5, the
  branch-and-merge coordination bullet, and the hard rule.
