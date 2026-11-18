# Authoring notes: codebase learning Explorer

## Outputs

- `initial/CodebaseExplorer.tsx` (component, default and named export `CodebaseExplorer`)
- `initial/codebase-data.ts` (typed nodes, edges, three views)
- `initial/MANIFEST.sha256` (SHA256 of the two files above, written before any compile or browser work)
- `src/` holds identical working copies for later repairs; `initial/` is read-only and must not change.

## Sources accessed

Content (the only basis for factual claims):
- `codebase-brief.md`
- `codebase-sources.md` (five package.json files at snapshot ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2)

Authoring guidance:
- `SKILL.md`, `references/learning-explorer.tsx`

Implementation only (API shape, not content):
- Published `@prnt/dagr-explorer@0.2.0` tarball from the npm registry (shasum 1ee7765066ed77cdfce133621c1d24a3abe21828), fetched with `npm pack` into the session scratchpad and extracted. Read: `README.md` (install, explorer section, styling variables, error codes), `dist/index.d.ts`, `types.d.ts`, `dagr-explorer.d.ts`, `root.d.ts`, `explorer-details.d.ts`, `explorer-viewport.d.ts`, `explorer-views.d.ts`, `visible-set.d.ts`, `errors.d.ts` (codes only). Nothing installed.

Not accessed: repository onboarding, other author outputs, study protocol or rubric, pilot material, prior authoring context. No other agents used.

## Content decisions

- Learner question: how are the five packages organized and what does each need? Three views share stable IDs: workspace packages, peers and dev tooling, and the shared source-to-published flow.
- Direction convention: arrows point from a package to what it needs; in the flow view, along the order a change travels. Stated in the root label and each view description.
- Claims about third-party packages (three, jsdom, fast-check, dagre) are limited to what the package.json files say. Purposes the packet does not state are recorded as "Not settled by the sources", not guessed.
- Inferred flow edges (`src-compiled`, `build-writes-dist`, `src-benched`) carry `inferred: true` and say so in the drawer.
- Two illustrations are marked as such; one depends on standard Node package resolution, which the packet does not state.
- Sources are cited as file + field. No URLs were constructed, because none were verified.

## Checks not performed

Per the brief, no install, typecheck, build, browser run or repair was done in this session. Edge endpoints and ID uniqueness were checked by reading only. Unverified: compile against the installed types, node content overflow at the declared 260x128 size, the dark-theme look of the scoped styles, and the extensionless `./codebase-data` import under the host's module resolution.
