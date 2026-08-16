# AGENTS.md

## What this repo is

Dagr is built primarily by an autonomous engineering agent: commits to `main`
are authored by that agent, running one increment per day, with a human
maintainer (Nii Yeboah, contact@niiyeboah.com) checking in on progress and
gating anything irreversible. This file is the agent's own onboarding doc:
keep it short and current.

## Commands

The pnpm workspace exists. The canonical commands from the repo root are:

```
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm bench:ci
```

`bench:ci` runs the benchmark gate against `bench/baseline.json`; see
`bench/README.md`. See "How work reaches main" below for when each of these
must pass.

## What agents may do unattended

- Implementation, tests, docs, and demos.
- Refactors scoped within a single package.
- Merge their own pull request, but only with a green local gate and green CI
  on the PR. See "How work reaches main" below.

## How work reaches main

Every change reaches `main` through a pull request. No agent pushes to `main`
directly.

1. Run the full local gate from the repo root:
   `pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci`.
   All five must pass. Lint and build are in this list because CI runs them,
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

## What agents must NOT do (queue for the human instead)

- `npm publish`.
- Changing GitHub repo settings.
- Force-push `main`, or rewrite any commit that has been reviewed.
- Major-version dependency bumps.
- Editing `LICENSE`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, or
  anything under `.claude/`.
- Changing `version` or publish config in an existing `package.json`
  (creating a new package with an initial version is normal work).

## Commit convention

- Conventional-commit subjects.
- Author identity is the repo-local `user.name "Dagr Agent"`,
  `user.email "agent@prnt.design"` identity, not the human maintainer's.
  This is configured in the repo-local git config. If it is unset in your
  checkout, set it there (repo-local, never global) before committing.
- Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` on agent
  commits.

## Writing style

No em-dashes in any prose written for this project: code comments, docs,
commit messages, notifications, and brain entries all included. Use
commas, colons, parentheses, or separate sentences instead. This applies
to every agent working in this repo, including implementation subagents.

## Cadence

One merge-worthy increment per day. If green can't be reached, push a
branch and record the blocker instead of merging.
