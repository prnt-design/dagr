# Agent PR Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the two scheduled Dagr jobs from pushing straight to `main` onto
a pull request flow gated on green CI, and fix the CI bench failure that would
otherwise deadlock that gate.

**Architecture:** Four changes across two systems. Three are repo files
(`.github/workflows/ci.yml`, `bench/README.md`, `AGENTS.md`) and ship as one
pull request, which is itself the first PR through the new flow. The fourth is
dispatch state: two job prompts and the two templates backing them, updated
through MCP tools after the repo change has merged.

**Tech Stack:** GitHub Actions, pnpm workspace, dispatch MCP (`update_job`,
`update_template`, `get_job`, `create_pr`, `get_pr_status`).

## Global Constraints

- **No em-dashes in any prose.** Code comments, docs, commit messages, prompts,
  notifications and brain entries all included. Use commas, colons,
  parentheses, or separate sentences.
- Conventional-commit subjects.
- Commits authored as the repo-local `Dagr Agent <agent@prnt.design>` identity,
  with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never force-push, never rewrite history, never change GitHub repo settings.
- `AGENTS.md` is normally a human-owned file. This plan edits it under explicit
  maintainer approval given on 2026-07-27.

## Ordering constraint (read before starting)

Tasks 1 to 4 must merge to `main` **before** Task 5 runs. The job prompts start
requiring green CI in Task 5; if they start requiring it while CI still runs the
cross-architecture bench gate, every scheduled run blocks and nothing ships.

The next scheduled runs are 17:00 (`dagr-daily`) and 17:30 (`dagr-daily-b`).
Tasks 1 to 4 need to be merged before 17:00. If that slips, do Task 5 first with
`enabled: false` on both jobs, then re-enable after the merge.

---

### Task 1: Take the bench gate off CI

**Files:**
- Modify: `.github/workflows/ci.yml:38-46`

**Interfaces:**
- Produces: a CI workflow whose steps are typecheck, test, lint, build. Task 3
  documents this list in `AGENTS.md` and Task 5 makes the jobs gate on it.

- [ ] **Step 1: Confirm the failure is environmental before removing anything**

Run:

```bash
gh run view 30266353995 --log-failed | grep -c "FAIL"
git show --stat c08e444
```

Expected: a non-zero FAIL count against a commit whose stat shows only
`docs/` files. That is the evidence the gate is measuring the runner and not
the code. If the failing commit turns out to touch package source, stop and
re-diagnose: the premise of this plan is wrong.

- [ ] **Step 2: Remove the bench step and its comment**

In `.github/workflows/ci.yml`, delete this entire block (the comment and the
step it documents):

```yaml
      # Benchmarks run after build so a failure here is never what hides a
      # broken typecheck or a red test. `pnpm bench:ci` measures, compares
      # against bench/baseline.json, and re-measures once if this runner was too
      # busy to produce a readable measurement, which is a real risk directly
      # after the build step above. A regression fails on the first attempt and
      # is never retried. The tolerance is not a flat 10% of wall clock: see
      # bench/README.md for why, and for what to do when this step goes red.
      - run: pnpm bench:ci
```

Replace it with:

```yaml
      # The benchmark gate deliberately does not run here. `bench/baseline.json`
      # is captured on the maintainer's machine (darwin, arm64, Apple M4) and CI
      # runs x64 Ubuntu. The harness normalizes against a control workload,
      # which holds for a runner that is uniformly slower but not across
      # architectures, where the benchmarked work and the control degrade by
      # different factors. Gating here reported eleven regressions between +23%
      # and +76% on a commit that changed one docs page. The gate is enforced
      # instead by the agent before it opens a pull request, on a machine that
      # matches the baseline. See bench/README.md.
```

- [ ] **Step 3: Verify the workflow still parses and the step is gone**

Run:

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); \
print([s.get('run') for s in d['jobs']['check']['steps'] if 'run' in s])"
```

Expected exactly:
`['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm test', 'pnpm lint', 'pnpm build']`

If `pnpm bench:ci` is still in that list, the deletion missed the step itself.

- [ ] **Step 4: Confirm the bench scripts survive for local use**

Run:

```bash
grep -n "bench:ci\|bench:check\|bench:baseline" package.json
```

Expected: all three scripts still present in `package.json`. This task removes
a caller, not the harness. If they are gone, restore them.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: take the benchmark gate off CI and leave it local

bench/baseline.json is an Apple M4 capture and CI runs x64 Ubuntu. The
control-workload normalization holds for a uniformly slower runner, not
across architectures. Commit c08e444 changed one docs page and the gate
reported eleven regressions between +23% and +76%, which is the machine
being measured rather than the code.

Every run on main since the gate landed has been red. The gate keeps its
teeth on the agent's own machine, where the baseline is valid, as a
pre-merge step.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Correct bench/README.md

**Files:**
- Modify: `bench/README.md:4`, `bench/README.md:10`, `bench/README.md:13`,
  `bench/README.md:22-31`

**Interfaces:**
- Consumes: the CI step list produced by Task 1.
- Produces: nothing other tasks read. This task exists because Task 1 makes
  four passages in this file false, and a stale doc about a gate is how the
  gate gets misread later.

- [ ] **Step 1: Fix the subtitle on line 4**

Replace:

```
reasoning that makes that rule survive contact with a CI runner.
```

with:

```
reasoning that makes that rule survive contact with a busy machine.
```

- [ ] **Step 2: Fix the script comment on line 10**

Replace:

```
pnpm bench:ci         # what CI runs: both of the above, re-measuring once if the run was unreadable
```

with:

```
pnpm bench:ci         # both of the above, re-measuring once if the run was unreadable
```

- [ ] **Step 3: Replace the CI claim on line 13**

Replace:

```
CI runs `pnpm bench:ci` on every pull request.
```

with:

```
The agent runs `pnpm bench:ci` before it opens a pull request, and does not
merge on a regression. CI does not run it.

The gate lives here rather than on CI because the baseline is machine-matched.
`bench/baseline.json` records the machine it was captured on, and a comparison
is only meaningful against the same one. GitHub's x64 Ubuntu runners are not
the maintainer's arm64 Apple M4, and the ratio normalization below corrects for
a slower machine, not for a different architecture. Gating on CI reported
eleven regressions between +23% and +76% on a commit that changed one docs
page.
```

- [ ] **Step 4: Reframe the noise section, lines 22 to 31**

The paragraph currently attributes the load to CI's build step. That load is
now the persona reviewers on the agent's own machine, which is what both
runners already observed on 2026-07-27. Replace the paragraph beginning `The
noise is predictable rather than hypothetical.` and ending `nothing is being
claimed about the code.` with:

```
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
```

- [ ] **Step 5: Verify no stale CI claim survives anywhere in the file**

Run:

```bash
grep -n -i "CI runs\|on CI\|CI job\|pull request" bench/README.md
```

Expected: every remaining hit reads as either the new local-gate framing or the
`.mjs` note near line 180 about running under bare node. Any line still
asserting that CI executes the benchmarks is a miss. Also confirm the file is
clean of em-dashes:

```bash
grep -n "—" bench/README.md || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add bench/README.md
git commit -m "$(cat <<'EOF'
docs(bench): describe the gate as local, not as a CI step

Four passages claimed CI runs the benchmarks. It no longer does. The
busy-machine paragraph also attributed the load to CI's build step; the
load is now the persona reviewers sharing the agent's machine, which is
what both runners observed today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Write the merge procedure into AGENTS.md

**Files:**
- Modify: `AGENTS.md:27-28` (the unattended-merge bullet), and insert a new
  section after the `## What agents may do unattended` block.

**Interfaces:**
- Consumes: the CI step list from Task 1.
- Produces: a section titled exactly `## How work reaches main`. Task 5's
  prompts reference it by that title, so the heading text must match verbatim.

- [ ] **Step 1: Update the unattended-merge bullet**

Replace lines 27 and 28:

```
- Merge to `main`, but only with a green typecheck and test run, and bench
  results within 10% of baseline.
```

with:

```
- Merge their own pull request, but only with a green local gate and green CI
  on the PR. See "How work reaches main" below.
```

- [ ] **Step 2: Insert the new section**

Immediately after the `## What agents may do unattended` list and before
`## What agents must NOT do (queue for the human instead)`, insert:

```markdown
## How work reaches main

Every change reaches `main` through a pull request. No agent pushes to `main`
directly.

1. Run the full local gate from the repo root:
   `pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci`.
   All five must pass. Lint and build are in this list because CI runs them,
   so skipping them locally is a way to turn main red. The bench gate runs
   here rather than on CI because the committed baseline is machine-matched;
   see `bench/README.md`.
2. Rebase onto `origin/main`. If the rebase brought in changes, run the gate
   again. Rebasing is not a formality: the changes it pulls in are exactly the
   ones your local gate has never seen.
3. Push the branch and open a pull request.
4. The PR body records this run's persona reviews: which personas ran, what
   each found, and how every finding was resolved, or accepted with a reason.
   The PR is the consolidated record of the run, so someone reading it later
   should not have to reconstruct the review from anywhere else.
5. Wait for CI to conclude on the PR. A run takes about 90 seconds.
6. Green CI merges the PR and deletes the branch. Red CI does not merge: fix
   it on the branch and push again. If green cannot be reached, leave the PR
   open, record the blocker, release the workboard claim, and stop. An open
   PR with a written blocker is a good outcome. A red `main` is not.

If `main` moves while the PR is open, rebase onto it and let CI run again.
Never force-push, and never merge a PR whose checks have not concluded.
```

- [ ] **Step 3: Verify the heading matches what Task 5 will reference**

Run:

```bash
grep -n "^## How work reaches main$" AGENTS.md
```

Expected: exactly one hit. Task 5's prompts cite this title verbatim, so a
reworded heading silently breaks the reference.

- [ ] **Step 4: Verify no em-dashes and no contradiction left behind**

Run:

```bash
grep -n "—" AGENTS.md || echo "clean"
grep -n "within 10% of baseline" AGENTS.md || echo "no stale merge rule"
```

Expected: `clean`, and `no stale merge rule`. The second guards against Step 1
being skipped, which would leave two different merge rules in one file.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs: make the pull request flow the operating contract

Agents merged straight to main with no PR and no gate between local
judgement and the default branch. Records the procedure in the file every
run already reads, so the four job prompts can reference one source
instead of restating it four times and drifting.

Edited with the maintainer's explicit approval, since this file is
normally human-owned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Ship tasks 1 to 3 through the new flow

This task dogfoods the design. If opening and merging this PR is awkward, the
procedure in Task 3 is wrong and should be fixed before Task 5 encodes it into
four prompts.

**Files:** none modified. This task runs commands.

**Interfaces:**
- Consumes: the commits from Tasks 1, 2 and 3.
- Produces: those changes merged to `main`, which Task 5 depends on.

- [ ] **Step 1: Run the full local gate**

Run:

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci
```

Expected: all five pass. AGENTS.md permits no exception for this step.

- [ ] **Step 2: Rebase onto origin/main**

```bash
git fetch origin
git rebase origin/main
```

If the rebase brought in changes, re-run Step 1 before continuing.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 4: Open the pull request**

Use the dispatch `create_pr` tool with `baseBranch: "main"`, a title of
`ci: move agent merges onto pull requests and fix the CI bench gate`, and a
body covering: the two problems, the diagnosis with the `c08e444` evidence,
the two decisions, and confirmation that the local bench gate ran and passed.

- [ ] **Step 5: Wait for CI and confirm it is green**

Poll with the dispatch `get_pr_status` tool until the checks conclude, or:

```bash
gh pr checks --watch
```

Expected: the `check` job passes. This is the first green CI on this repo since
01:06 today, and it is the evidence that Task 1 fixed the real cause. If it is
red, read the failure: a red run here means the bench gate was not the only
problem and Task 5 must not proceed.

- [ ] **Step 6: Merge the PR**

```bash
gh pr merge --merge --delete-branch
```

- [ ] **Step 7: Confirm main is green**

```bash
gh run list --branch main --limit 1
```

Expected: `success`. Do not start Task 5 until this shows green.

---

### Task 5: Update the two jobs and two templates

**Files:** none. This task edits dispatch state through MCP tools.

The same four edits apply to all four records. The prompt text is identical
across `dagr-daily`, `dagr-daily-b`, template `10c67030-b2c2-49ac-99a9-e8e37003bffc`
and template `87bb26b6-d4e3-4c59-bc1b-135fd52aaf17`. Templates back the jobs, so
skipping them means the next job recreated from a template silently reverts to
pushing to `main`.

**Interfaces:**
- Consumes: the `## How work reaches main` heading from Task 3, merged to
  `main` by Task 4.

- [ ] **Step 1: Confirm Task 4 actually landed**

```bash
git fetch origin && git show origin/main:AGENTS.md | grep -c "^## How work reaches main$"
```

Expected: `1`. If this is `0`, the prompts are about to reference a section
that does not exist on `main`. Stop and finish Task 4.

- [ ] **Step 2: Rewrite the branch-and-merge coordination bullet**

In the `## Coordination` list, replace:

```
- Always work on a branch. Before merging: git fetch, rebase onto
  origin/main; if the rebase brought in changes, re-run typecheck + tests;
  then merge to main and push. If the push is rejected, rebase and retry.
  Never force-push.
```

with:

```
- Always work on a branch. Never push to main directly. Your increment
  reaches main through a pull request that you open and, once CI is green,
  merge yourself. Read "How work reaches main" in AGENTS.md each run and
  follow it; it is the canonical procedure and this prompt does not restate
  it. Never force-push.
```

- [ ] **Step 3: Rewrite step 5 of the building phase**

Replace:

```
5. MERGE: rebase, re-verify if needed, merge to main and push (per the
   coordination rules). Docs for this run's feature land in the same change.
```

with:

```
5. SHIP: follow "How work reaches main" in AGENTS.md. Run the full local
   gate (typecheck, test, lint, build, bench:ci), rebase onto origin/main and
   re-run the gate if the rebase brought changes, push the branch, open the
   PR with create_pr, poll get_pr_status until CI concludes, and merge only
   on green. The PR body carries this run's persona review record: which
   personas ran, what each found, and how every finding was resolved or
   accepted with a reason. Docs for this run's feature land in the same PR.
   Budget about 20 minutes for CI; it usually takes 90 seconds.
```

- [ ] **Step 4: Rewrite the first hard rule**

Replace:

```
- Never merge without green typecheck + tests (+ bench within 10%).
```

with:

```
- Never merge without both a green local gate (typecheck, test, lint, build,
  bench within tolerance) and green CI on the pull request. Never push to
  main directly.
```

- [ ] **Step 5: Correct the two stale lines in the planning-phase block**

That block only runs when `state.phase == "planning"`, which is already past,
but leaving contradictions in a prompt is how a future reader learns the wrong
rule. Replace:

```
2. GitHub Actions CI: on every PR and push to main, run typecheck + test
   (+ bench once it exists). No allowed-to-fail steps.
```

with:

```
2. GitHub Actions CI: on every PR and push to main, run typecheck, test,
   lint and build. No allowed-to-fail steps. Benchmarks are gated locally
   against a machine-matched baseline, not on CI; see bench/README.md.
```

and replace:

```
4. Verify green locally (pnpm typecheck && pnpm test), merge to main, push.
```

with:

```
4. Verify green locally, then ship it per "How work reaches main" in
   AGENTS.md.
```

- [ ] **Step 6: Apply all five edits to the two jobs**

Call `update_job` twice, with `name: "dagr-daily"` then `name: "dagr-daily-b"`,
`directory: "/Users/daemon-ai/src/dagr"`, passing the fully rewritten `prompt`.
Pass only `prompt`; leave schedule, timeout and every other field untouched.

- [ ] **Step 7: Apply the same edits to the two templates**

Call `update_template` twice, with `templateId:
"10c67030-b2c2-49ac-99a9-e8e37003bffc"` then
`"87bb26b6-d4e3-4c59-bc1b-135fd52aaf17"`, passing the same `prompt`.

- [ ] **Step 8: Read all four back and verify**

Call `get_job` for both names and `get_template` for both ids. For each of the
four prompts confirm:

- `merge to main and push` does not appear
- `How work reaches main` appears at least twice
- `Never push to main directly` appears
- no em-dash appears anywhere in the text

All four must pass all four checks. A template that still says `merge to main
and push` reintroduces direct pushes the next time a job is created from it.

- [ ] **Step 9: Confirm the two prompts are still identical to each other**

The two runners differ only in name and schedule, and their prompts have always
been byte-identical. Diff the two job prompts against each other and confirm the
only differences are the ones that were already there. A divergence introduced
here means one runner will behave differently from the other, which is the
hardest class of bug to notice in this setup.

---

### Task 6: Watch the first real run

- [ ] **Step 1: Watch the 17:00 run**

`dagr-daily` fires at 17:00 and `dagr-daily-b` at 17:30. Confirm the first one
opens a PR rather than pushing, that CI runs on it, and that it merges on green.

- [ ] **Step 2: Confirm main stayed green**

```bash
gh run list --branch main --limit 3
```

Expected: `success`. This is the outcome the whole plan is for: the maintainer
stops getting red-CI notifications on merges to `main`.

- [ ] **Step 3: Report what needs the maintainer**

`main` is still unprotected, so this flow is convention rather than
enforcement. Enabling branch protection with `check` as a required status is a
repo-settings change, which agents may not make. Raise it with the maintainer
rather than attempting it.

---

## Self-review

**Spec coverage.** Every section of `specs/2026-07-27-agent-pr-workflow-design.md`
maps to a task: the CI workflow change to Task 1, the `bench/README.md`
corrections to Task 2, the `AGENTS.md` procedure to Task 3, the PR flow and
persona review record to Tasks 3 and 5, the four prompt updates to Task 5, and
the out-of-scope branch protection note to Task 6 Step 3. The spec's ordering
constraint is stated up front and enforced by Task 5 Step 1.

**Type consistency.** The heading `## How work reaches main` is defined in Task
3 Step 2, verified in Task 3 Step 3, referenced in Task 5 Steps 2, 3 and 5, and
re-verified against `origin/main` in Task 5 Step 1. The CI step list
(typecheck, test, lint, build) is asserted in Task 1 Step 3 and repeated
identically in Task 3 Step 2 and Task 5 Steps 3 and 4.
