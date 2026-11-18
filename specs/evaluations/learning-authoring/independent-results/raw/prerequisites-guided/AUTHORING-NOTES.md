# Authoring notes: prerequisites (guided)

Initial output saved 2026-11-18T20:41:12Z, before any compile or browser check.

## Output files

- `initial/PrerequisitesExplorer.tsx` (read-only), sha256 2c281612fecd659fc5d02cd0124099b93139a08b54e3ae6c0d169a70520c1a6e
- `initial/prerequisites-data.ts` (read-only), sha256 df2dd62d2cca2f4cd295285eb8cfb7b99dfb884c0ef09532406d6aea932f556d
- `initial/SHA256SUMS` manifest
- Working copies, identical at save time: `PrerequisitesExplorer.tsx`, `prerequisites-data.ts`

## Sources accessed

- `prerequisites-brief.md`, `prerequisites-sources.md` (the only content sources for factual claims; snapshot ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2).
- `SKILL.md`, `references/learning-explorer.tsx` (authoring guidance).
- Published `@prnt/dagr-explorer@0.2.0` tarball via `npm pack --ignore-scripts` into the session scratchpad (not installed): read `package.json`, `dist/index.d.ts`, `dist/dagr-explorer.d.ts`, `dist/explorer-details.d.ts`, `dist/explorer-viewport.d.ts`, `dist/root.d.ts`, `dist/visible-set.d.ts` to confirm prop and slot signatures. Used for implementation only, not for lesson claims.
- Nothing else: no repository onboarding, other author outputs, study protocol, rubric or pilot material.

## Design

- One typed model (`Concept`, `Prerequisite`), 20 concepts, 25 edges, 5 views sharing IDs (Start here, Data and layout, Reading experience, Going further, All prerequisites). View edges are derived from the shared edge list.
- Direction convention: edge source is the prerequisite, target is what it is needed for (label "needed for", plus a per-edge `reason`). Stated in the graph label and intro text.
- Details: what it is, why it matters, example (each marked as from the README, adapted, or illustrative), "Learn first" / "Needed for" connection buttons using the slot's `connections` and `follow`, and source section references.
- `renderNode` is non-interactive; rich tier shows kind and a 3-line-clamped summary at the declared 260x140 size.

## Not performed

No typecheck, build, dependency install, browser run, or automated edge-endpoint check. Endpoints and IDs were reviewed by reading only.

## Known limitations

- `whyItMatters` lines are author framing derived from the README, not README quotes.
- Default `tiers` thresholds and tier-dependent overflow at 260x140 are unverified.
- The `--dagr-explorer-height` custom property is set via `style` on the root with a `CSSProperties` cast.
- The data module throws at import if a view lists an unknown concept id.
