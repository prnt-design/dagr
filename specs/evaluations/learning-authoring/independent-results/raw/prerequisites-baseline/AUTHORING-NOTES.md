# Authoring notes: prerequisites (baseline)

Authored 2026-11-18 in a fresh session with no prior authoring context.

## Outputs

- `PrerequisitesExplorer.tsx`: React TypeScript component (named and default export `PrerequisitesExplorer`). Imports `@prnt/dagr-explorer` and its optional `styles.css`.
- `prerequisitesData.ts`: concept nodes, prerequisite edges and three views (`path`, `data`, `ui`).
- `initial/`: immutable copies of both files as first authored, before any compile or browser check.
- `initial/SHA256SUMS`: SHA256 manifest of the initial copies.

## Sources accessed

Factual claims in the lesson content come only from:

- `prerequisites-brief.md` (task brief).
- `prerequisites-sources.md`: `packages/explorer/README.md` and `packages/explorer/src/types.ts` at snapshot ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2.

For implementation only (API shapes, not lesson claims), I read the public published tarball `https://registry.npmjs.org/@prnt/dagr-explorer/-/dagr-explorer-0.2.0.tgz`, extracted to the session scratchpad (not installed). Files read: `package.json`, `dist/index.d.ts`, `dist/dagr-explorer.d.ts`, `dist/explorer-details.d.ts`, parts of `dist/explorer-viewport.d.ts`, `dist/root.d.ts`, `dist/labels.d.ts`, `dist/visible-set.d.ts`, `dist/errors.d.ts`, `dist/layout.d.ts`, and the first lines of `CHANGELOG.md`. Findings:

- Published `src/types.ts` is identical to the supplied `types.ts`.
- Published `README.md` differs from the supplied one in one sentence (the supplied text says "Docked below the outline", published says "Over the outline"). The lesson does not use that sentence.
- Used from the declarations: `renderNode`'s context `{ tier: 'summary' | 'rich', selected, dimmed }`, `nodeAriaLabel`'s signature, `ExplorerDetailsContext`, `ExplorerApi`/`apiRef` type, `labels.search` key.

Not read: repository onboarding, authoring skills or references, other author outputs, study protocol or rubric, pilot material.

## Checks not performed

Per the brief, nothing was installed, type-checked, built or run in a browser. The component has not been compiled or rendered. Validation and any repairs are left to the parent.

## Known risks for validation

- `goTo` relies on calling `apiRef.inspect` in an effect after a controlled `viewId` change; whether the root's view-change reset runs before that effect is unverified.
- The `ui` and `data` views drop edges whose endpoint is outside the view, so some nodes there have no visible prerequisite edge.
- Wrapper sets `--dagr-explorer-height: 560px` on an ancestor element; the stylesheet import assumes a bundler that handles CSS imports.
- No groups are used in the data, to avoid outlines overlapping non-members in the auto layout; groups are taught in text only.
