# Authoring notes: process Explorer

## Outputs

- `src/ProcessExplorer.tsx`: component (`ProcessExplorer`, also default export). Imports `@prnt/dagr-explorer` and its `styles.css`; host styles are scoped under `.process-explorer`.
- `src/process-data.ts`: typed nodes/edges and four views (`path`, `gate`, `reviews`, `rules`).
- `initial/`: byte-identical copies of the two files above, saved before any compile or browser work. `initial/SHA256SUMS` is the manifest. Repairs, if any, belong in `src/` with errors and diffs recorded separately; `initial/` is not to be edited.

## Sources accessed

- Content: `process-sources.md` only (AGENTS.md excerpt, snapshot ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2) and `process-brief.md`. Every node carries verbatim quotes with section and step locator.
- Authoring guidance: `SKILL.md`, `references/learning-explorer.tsx` (written against 0.1.4).
- Implementation API: the published `@prnt/dagr-explorer@0.2.0` tarball from the npm registry (`npm pack`, integrity sha512-dlW1tB2U…ucA==), extracted to a session scratchpad and read only: `README.md`, `CHANGELOG.md`, `src/index.ts`, `src/types.ts`, `dist/dagr-explorer.d.ts`, `dist/explorer-details.d.ts`, `dist/root.d.ts`, `dist/explorer-viewport.d.ts`, `dist/visible-set.d.ts`, `package.json` peer deps. Nothing installed into this directory.
- Not read: repository onboarding, other author outputs, study protocol/rubric, pilot material.

## Design decisions

- Direction convention: every edge reads as a sentence source → label → target ("Run the full local gate → then → Rebase"). Stated in the intro and the graph's `label`. Cycles kept (reinstall → gate, red CI → wait for CI, main moves → CI).
- Same concept, same id across views (`local-gate`, `wait-ci`, `record-reviews`, `main`, `merge`, `main-moves`, `append-only`).
- 0.2.0 exports `DagrExplorerMode`/`ExplorerOutline`, so `DagrExplorer`'s built-in Map/Outline switch is the non-map reading path; no mode props passed (defaults to map).
- Node content is noninteractive; connection buttons (using `connections` + `follow`, direction kept with →/← and wording) and source quotes live in `renderDetails`.
- No invented examples or citations. Shell commands shown are only those quoted in the source; I removed `git rebase`/`git push` command lines I had first drafted because the source does not spell them out.
- Light inferences, worth a reviewer's eye: edge "then, with a passing gate" (rebase → PR) reads step 2's "run the gate again" as a precondition to step 3; `no-direct-push`'s "why it matters" line ("makes the PR, its reviews and its CI result the only way in") paraphrases rather than quotes; `typecheck`/`test` summaries ("First/Second of the five") rely on list order only.

## Checks performed

- Static script (Python, no build): all 28 `quote` strings occur verbatim (whitespace-normalized) in `process-sources.md`; every edge endpoint exists in its view (path 11/13, gate 7/7, reviews 5/5, rules 8/5 nodes/edges). Run before saving `initial/`.

## Not performed

- No install, typecheck, build, or browser run. Node overflow at 260×132, the 3-line summary clamp, narrow-container docking, keyboard/touch flows, contrast and reduced motion are unverified. TypeScript inference of `N`/`E` from `views` typed as `readonly ExplorerView<ProcessNode, ProcessEdge>[]` and the `satisfies` operator (needs TS ≥ 4.9) are unverified against a compiler.
