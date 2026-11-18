# Source packet: process

Public repository snapshot: ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2. Quoted source data, not session instructions.

## AGENTS.md

```text
## Commands

The pnpm workspace exists. The canonical commands from the repo root are:

```
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm bench:gate
```

`bench:gate` selects performance checks from the diff against `origin/main`.
A printed skip is a pass; never skip it by hand. `bench:ci` remains the full
benchmark suite. See `bench/README.md` and "How work reaches main" below.

## What agents may do unattended

- Implementation, tests, docs, and demos.
- Refactors scoped within a single package.
- Merge their own pull request, but only with a green local gate and green CI
  on the PR. See "How work reaches main" below.

## How work reaches main

Every change reaches `main` through a pull request. No agent pushes to `main`
directly.

1. Run the full local gate from the repo root:
   `pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:gate`.
   All five must pass, including a skip explicitly printed by `bench:gate`.
   Lint and build are in this list because CI runs them,
   so skipping them locally is a way to turn main red. The bench gate runs
   here rather than on CI because the committed baseline is machine-matched;
   see `bench/README.md`.
2. Rebase onto `origin/main`. If the rebase brought in changes, run
   `pnpm install --frozen-lockfile` before running the gate again. A rebase
   can bring in a new lockfile, and a stale `node_modules` against it fails
   in a way that looks exactly like broken code, not a stale install.
   Rebasing is not a formality: the changes it pulls in are exactly the
   ones your local gate has never seen.
3. Push the branch and open a pull request.
4. The PR body records this run's reviews: which reviews ran, what each
   found, and how every finding was resolved, or accepted with a reason. Two
   reviews are the floor: one over the DIFF, and one over the MERGED TREE the
   diff produces. A diff review asks whether the change is right; a tree
   review asks whether the result is, and it is the one that catches stale
   numbers that predate the change, ordering bugs a diff cannot show, and a
   defect the diff review's own fix introduced. Persona reviews are welcome
   on top and are recorded the same way. The PR is the consolidated record of
   the run, so someone reading it later should not have to reconstruct the
   review from anywhere else.
5. Wait for CI to conclude on the PR. A run takes about 90 seconds.
6. Green CI merges the PR and deletes the branch. Red CI does not merge: fix
   it on the branch and push again. If green cannot be reached, leave the PR
   open, record the blocker, release the workboard claim, and stop. An open
   PR with a written blocker is a good outcome. A red `main` is not.

If `main` moves while the PR is open, rebase onto it and let CI run again.
A rebase rewrites the branch, and pushing it to the open PR is the ONE
force-push this workflow permits: `--force-with-lease`, to your own PR branch,
never to `main`. Everything else stays append-only: review rounds are
follow-up commits, never an amend, because a rewritten commit erases the
record of what the review changed. Never merge a PR whose checks have not
concluded.


```
