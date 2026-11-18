# Authoring notes: codebase baseline

## Outputs
- `output/DagrCodebaseExplorer.tsx`: default-exported React component (`DagrCodebaseExplorer`) built on `DagrExplorer` from `@prnt/dagr-explorer` 0.2.0. Imports `@prnt/dagr-explorer/styles.css`.
- `output/codebase-data.ts`: typed views (`runtime`, `dev`, `packaging`), guided tour steps and self-check questions.
- `initial/`: read-only copies of both files as first authored, with `initial/SHA256SUMS`.

## Source access
- Read: `codebase-brief.md`, `codebase-sources.md` (five package.json files at snapshot ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2). All factual claims about Dagr in the component and data come from these.
- For implementation only: the published `@prnt/dagr-explorer@0.2.0` tarball (README.md and dist/*.d.ts) and the `Size` type in published `@prnt/dagr-render@0.2.0` dist/geometry.d.ts, fetched with `npm pack` into the session scratchpad. Nothing was installed.
- Not read: repository onboarding, authoring skills or references, other authors' outputs, study protocol or rubric, pilot material.

## Not performed
- No dependency install, typecheck, build, test or browser run. The component has not been compiled or rendered.

## Known limitations and assumptions
- Tour steps call `api.selectView` then `api.inspect` in the same tick (README: the methods see each other), then `reveal` on the next animation frame. Not verified in a browser.
- `ExplorerView.description` is shown by the component above the graph; whether the explorer itself also renders it was not checked.
- The packaging view's group outlines assume each package's component is laid out apart from the others; overlaps would be cosmetic (`strictGroups` is off).
- Assumes the host bundler handles the CSS import and a TypeScript config with the JSX runtime for React 18 or 19.
- `@dagr/bench` is shown only as referenced; its manifest is not in the packet. Version ranges are shown as declared, not resolved.
