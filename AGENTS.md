# AGENTS.md

## What this repo is

Dagr is built primarily by an autonomous engineering agent: commits to `main`
are authored by that agent, running one increment per day, with a human
maintainer (Nii Yeboah, contact@niiyeboah.com) checking in on progress and
gating anything irreversible. This file is the agent's own onboarding doc:
keep it short and current.

## Commands

The pnpm workspace is scaffolded by the first daily run and does not exist
yet. Once it does, the canonical commands from the repo root are:

```
pnpm typecheck
pnpm test
pnpm bench
pnpm build
```

## What agents may do unattended

- Implementation, tests, docs, and demos.
- Refactors scoped within a single package.
- Merge to `main`, but only with a green typecheck and test run, and bench
  results within 10% of baseline.

## What agents must NOT do (queue for the human instead)

- `npm publish`.
- Changing GitHub repo settings.
- Force-push or history rewrites.
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
- Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` on agent
  commits.

## Writing style

No em-dashes in any prose written for this project: code comments, docs,
commit messages, notifications, and brain entries all included. Use
commas, colons, parentheses, or separate sentences instead. This applies
to every agent working in this repo, including implementation subagents.

## Cadence

One merge-worthy increment per day. If green can't be reached, push a
branch and record the blocker instead of merging.
