# Authoring notes: process walkthrough

## Outputs

- `src/ProcessExplorer.tsx`: the component (`ProcessExplorer`, also the default export).
- `src/process-data.ts`: four views (Path to main, Local gate, Reviews, Guardrails) and node and edge data.
- `initial/ProcessExplorer.tsx`, `initial/process-data.ts`: read-only copies frozen 2026-11-18T20:44:32Z, before any compile or browser check.
- `initial/SHA256SUMS`: the manifest for those copies.

## Source access

- Content: only `process-brief.md` and `process-sources.md` in this directory (AGENTS.md excerpt, snapshot ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2). Every node has a `source` section reference and a verbatim `quote` from that packet.
- Implementation: the published `@prnt/dagr-explorer@0.2.0` tarball from the npm registry (`npm view`, `npm pack`), extracted to the session scratchpad. I read its README.md and `dist/*.d.ts` (index, types, root, dagr-explorer, explorer-details, explorer-viewport, explorer-views, visible-set) and `src/size.ts` and `src/visible-set.ts` for default constants. Nothing was installed into a project.
- Not read: repository onboarding, authoring skills or references, other author outputs, the study protocol or rubric, pilot material.

## Checks

None were run. No install, typecheck, build, or browser check took place. Validation is the parent's.

## Assumptions and limitations

- The host's bundler must handle the side-effect CSS import `@prnt/dagr-explorer/styles.css` and the extensionless import `./process-data`. Under NodeNext resolution that import would need a `.js` extension.
- The component uses `satisfies`, so it needs TypeScript 4.9 or later.
- Colors are fixed for a light page, matching the package's default stylesheet. There is no dark theme.
- The source describes loops (red CI → fix → CI again; a rebase → gate again). The data keeps the graph acyclic: the rerun gate is its own node, and the red-CI loop back to CI is stated in text, not drawn as an edge.
- Two edges are inferred from step order, not stated: "no changes after rebase → push", and "main moved" branching from the open-PR stage.
- The node "Work on a branch" is inferred from "Push the branch" and the PR requirement.
