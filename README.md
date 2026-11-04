# PR screenshots

Not for merge. This orphan branch holds the images that pull request bodies in
`prnt-design/dagr` embed, so binaries never land on `main`.

Layout: one folder per PR, named `<YYYY-MM-DD>-pr-<number>/` (or
`<YYYY-MM-DD>-<ticket>/` when the PR does not exist yet). Link a file as

```text
https://github.com/prnt-design/dagr/blob/nii/pr-screenshots/<folder>/<file>.png?raw=true
```

Use that `blob/...?raw=true` form, not `raw.githubusercontent.com`. Only the
same-origin one carries the reader's session, so only it renders while the repo
is private.

A weekly job rebuilds this branch without folders dated more than
30 days ago, unless an open PR body still links a file in the
folder. It runs outside this repo, so there is nothing here to schedule.
History is rewritten on every prune: do not base work on this branch, and link
the branch rather than a commit sha.

Uploads go through the `attaching-pr-screenshots` Claude Code skill or the
GitHub contents API; a local checkout is not needed.