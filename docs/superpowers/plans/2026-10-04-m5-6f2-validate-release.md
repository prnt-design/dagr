# M5.6f-2 explorer browser validation and release readiness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development`. This plan is a design brief.

**Goal:** Prove the explorer works in real browsers, fix what that finds,
record the measured SVG ceiling, add it to the `@prnt/dagr` umbrella, and mark
it publishable. Publishing itself stays with the maintainer.

**Spec:** `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`,
sections "Tests" (browser validation), "Release posture", "Increments", and
"Amendments".

## Global constraints

- **Allowed manifest edits, approved by the maintainer:**
  - `packages/explorer/package.json`: remove `"private": true`. Nothing else
    in it changes. (Approved by the spec's approval, "Release posture".)
  - `packages/dagr/package.json`: add the `./explorer` and `./render/core`
    exports, add `@prnt/dagr-explorer` (`workspace:^`) to `dependencies`, and
    add `peerDependenciesMeta: { "three": { "optional": true } }`. Nothing
    else. (Approved by the maintainer on 2026-10-04 as option A.)
  - No `version` changes anywhere. No publish.
- Any fix to `packages/explorer/src` found by the browser checks is test
  first, under both React configs, and keeps the 22-name public surface.
- The browser harness is committed under `bench/browser/` like the existing
  ones (read `bench/browser/README.md`): `playwright-core` is not a workspace
  dependency and the harness documents how to run it. It is not part of
  `pnpm test` or CI.
- No em-dashes in any prose. Commits: author `Dagr Agent <agent@prnt.design>`,
  trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## 1. Browser validation

A committed harness, `bench/browser/explorer-check.mjs`, serves the built docs
site and drives `/docs/explorer` with Playwright in **Chromium and WebKit**, at
**1440 by 900** and **390 by 844** (with touch and `isMobile` for the second).
It saves screenshots and writes a JSON report. Each check is an assertion; the
script exits non-zero on any failure. Checks:

- Both demos mount; no console errors or page errors; no horizontal page
  overflow at either width.
- Wheel over an unfocused graph scrolls the page and does not zoom; after a
  click into the graph, wheel zooms and the page does not scroll.
- Drag pans 1:1; the click that ends a drag does not open the drawer.
- A `Ctrl` wheel (trackpad pinch) zooms the graph while it has focus and is
  left to the page when it does not.
- On the 390 viewport with touch: the first tap focuses and does not open a
  node; a two-finger pinch (synthesized touch events) zooms.
- Keyboard: Tab reaches exactly one node in the graph, arrows move focus and
  the camera reveals the node, Enter opens the drawer once, Space once,
  Escape closes it and focus returns to the opener.
- Search: typing and Enter inspect the first match; the "more matches" line
  appears with a short query on the large demo.
- The large demo's mounted-node readout never exceeds the cap plus pins
  during a scripted sequence of zooms and pans.
- `prefers-reduced-motion: reduce` (emulated): a zoom applies in one frame.
- Resize the page: the camera keeps its place unless it was at fit.
- Text stays crisp at rest after a zoom (no `will-change` left on the plane).

Screenshots at least: each demo at rest, zoomed, with the drawer open, in
light and dark, in both browsers and both widths.

**Anything that fails is fixed in the package, test first, in this PR.** If a
failure is a browser limitation that cannot be fixed, record it in the README
under a "Known browser differences" heading with the browser and the behavior.

## 2. The measured SVG ceiling

A second harness mode measures frame time while panning the SVG base at fit
zoom for synthetic graphs of 500, 1,000, 2,000, 4,000 and 8,000 nodes in
Chromium (headless, on this machine): median and 95th percentile frame time
over a scripted pan. State the ceiling as the largest size whose 95th
percentile stays under 16.7 ms, with the machine named. Write the number and
the table into `docs/docs/explorer.md` (Limits) and the package README, and the
spec's "The base-layer seam" sentence that promises it.

## 3. The umbrella

Add `packages/dagr/src/explorer.ts` (`export * from '@prnt/dagr-explorer';`)
and `packages/dagr/src/render-core.ts` (`export * from '@prnt/dagr-render/core';`)
and the manifest entries above. Update `packages/dagr/README.md`: the new
subpaths, and that React 18 sites install `@prnt/dagr-explorer` directly
because the umbrella requires React 19. Extend the packaging gate and
`verify-tools.mjs` so the umbrella's two new subpaths resolve and keep
runtime identity with the scoped packages, as the existing subpaths do. Add
the explorer to the root `README.md` packages table.

## 4. Publishable

Remove `"private": true` from `packages/explorer/package.json`. Confirm the
packaging gate's checks all pass for it as a published package, and that
`verify:tools` passes for all seven tarballs.

## 5. Records

- Spec: amendment 17 for this slice (the explorer joins the umbrella, which
  reverses "Release posture"'s "does not join"; the measured ceiling; any
  browser-driven fix). Update "Release posture".
- `ROADMAP.md`: check M5.6f and the parent M5.6.
- `packages/explorer/CHANGELOG.md`: the browser validation, fixes, ceiling,
  and that the package is publishable. `packages/dagr/CHANGELOG.md`: the new
  subpaths under the existing `## 0.1.3` heading, because 0.1.3 is
  unpublished and will carry them, as #101 did for the render core entry. The
  explorer's own changelog moves its `Unreleased` entries under `## 0.1.3`
  too, since it ships in 0.1.3. Same for `packages/render/CHANGELOG.md` if anything
  there changes (it should not).
