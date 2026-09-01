# The campaign demo moves into the docs site, and reads its edges

**Date:** 2026-08-15
**Status:** delivered. D1 shipped the same day as PR #40, except for the one
step a blueprint cannot take (see below); D2 and D3 followed, and the
maintainer's 2026-08-16 message extended the track through D6, all shipped.
The ROADMAP's "Demo into the docs site" section carries the task record.
**Supersedes:** the standalone `dagr-demo` Render service (PR #33) as the
demo's home, and the P7 landing-page link that was never added.

## What Nii asked

1. No separate `dagr-demo` site. The demo belongs on `dagr.prnt.design`,
   either on the landing page or on a demos tab.
2. Nodes need more spacing. Edges need color coding by where they come from,
   and an edge-highlight feature to see where an edge came from and goes.

## Why the second site was the wrong home

It was the cheapest thing that produced a URL, and it did that. It is the
wrong end state for three reasons that were visible at the time and traded
away for speed: a visitor to the docs site does not find the demo (the
landing page did not link to it, and even linked, it is an outbound hop that
loses the site's chrome and nav); two static services on one blueprint is
twice the deploy surface for one artifact; and the docs site already
compiles the engine into the visitor's browser for the layout benchmark, so
adding the renderer is a dependency step, not an architecture change.

## Where it goes

A **demos tab**, `/demos/campaign`, in the docs site's own nav, with the
landing page linking to it. Not on the landing page itself: the campaign
canvas wants the full viewport height and its own keyboard focus, and the
landing page has a hero, a benchmark figure and a pitch that would all be
pushed below a canvas that eats the fold. A dedicated route also leaves room
for the animated demos Nii asked for as a follow-up (a session being played,
a campaign being authored) as sibling pages under the same tab, which is a
better shape than one landing page that grows a carousel.

Mechanism: a Docusaurus page under `docs/src/pages/demos/campaign.tsx`
mounting the same component `apps/demo` mounts, moved into a place both can
import. The clean move is `apps/demo/src` becoming a private workspace
package (`@dagr/demo-campaign` or fold it into `@dagr/campaign` as a
`/react` entry) that exports `<CampaignStage>`; `apps/demo` keeps existing
as the dev playground that imports it, and the docs site imports the same
thing. Docusaurus renders in SSR, and the stage needs `window`, so the page
wraps it in `<BrowserOnly>`. `three` enters `docs/package.json` because
`@dagr/render` peers on it. `render.yaml`: the `dagr-demo` service is
removed, `buildFilter` grows `packages/render/**` and `packages/campaign/**`
because the site ships them now, and the docs `buildCommand` already builds
workspace deps in dependency order. The `apps/demo` README and P7 links
retarget to `/demos/campaign`. The M4.11 worker plugin note applies: the
layout worker chunk in Docusaurus needs the `dagr-worker-runtime` plugin
already in place for the benchmark; verify the campaign's worker resolves
under it, since it is a different entry.

## Spacing, edge color, edge highlight

**Spacing.** The tiles are laid out with `@dagr/layout` defaults (node
separation and rank separation as the layout config's defaults). Raise them
for the campaign: the demo's tile layout call gets an explicit
`nodeSeparation` and `rankSeparation`, chosen by measuring rather than
picking, and the packer's tile gap rises with them. What Nii is reacting to
is almost certainly the fitted view, where 3,010 nodes at zoom 0.053 leave
no visible gap between neighbors; spacing that reads well fitted may still
read sparse zoomed in, so the choice wants a look at both ends. Note the
zoom floor moves with the scene extent (P2's derived limits), so more
spacing lowers the floor and shrinks nodes at the fitted view; that trade is
the reason to measure.

**Edge color by source.** Today edges are colored by ROLE group (routed
kinds dashed in one color, overlay kinds bowed in another). Nii wants them
colored by where they come from, which reads as the SOURCE NODE'S kind
color: a ribbon out of a quest node is quest-green, out of a location is
location-blue, so a reader can trace provenance across the canvas. The
plumbing exists: P5 built `campaignEdges` on a color function keyed on the
edge, and `nodeColor(node)` is the palette. The change is the function:
`colorOf(edge) = nodeColor(sourceNode)`, with the role split kept as the
DASH distinction (routed dashed, overlay solid or vice versa) so both facts
survive. Alpha stays low at the far view or 7,100 colored edges become the
picture; the P5 zoom-derived width and alpha ramp already handles that.

**Edge highlight.** Hover a node (P7's `nodeAtPoint`, no picking needed) and
its incident edges brighten to full alpha and width while the rest dim, with
the far end of each highlighted edge getting a title label even if its tier
would not show one at this zoom. That answers "where does this edge come
from and go" without picking edges themselves, which would need M4.8.
Mechanism: `setEdgeStyle` per group is too coarse (it styles a whole group),
so highlighting is a per-edge attribute: P5's tessellator already returns a
range per route, so a highlight is a slice write into a per-edge intensity
attribute the ribbon shader multiplies alpha and width by. That is a small
`@dagr/render` change (one attribute channel; the budget has one free
vertex-buffer slot and this is a candidate for it, which should be said in
the M4.10 record) plus a demo hook off the existing hover state. Hovering an
edge directly stays deferred to M4.8.

## Phasing

| Phase | Lands | Notes |
| --- | --- | --- |
| D1 | Demo component extracted to a shared package; docs `/demos/campaign` route with `<BrowserOnly>`; landing page and README link to it; `render.yaml` loses `dagr-demo`, gains the render/campaign build filters | The move. Verify the worker chunk under Docusaurus. `dagr-demo.onrender.com` can be left up until D1 deploys, then removed by the blueprint sync |
| D2 | Spacing measured and raised; edge color by source-node kind with role kept as dash | Demo-side, small |
| D3 | Per-edge highlight attribute in `@dagr/render`; hover-driven highlight of incident edges and far-end labels in the demo | Touches the ribbon shader; costs the free channel unless packed |

D2 and D3 are independent of D1 and of each other. D1 is the one Nii asked
for first and the one with a deploy consequence.

### What D1 did differently from the sketch above

The shared package is `@dagr/campaign-stage`, a new private package rather
than a `/react` entry on `@dagr/campaign`: the dataset package is
zero-dependency by decision and a subpath export does not change what
installing it pulls in, so React, the renderer and three would all have become
its problem.

**The layout worker did not move into the package**, which is the one real
departure. `new Worker(new URL('./layout-worker.ts', import.meta.url))` is an
expression the bundler resolves from the module that writes it, and the two
hosts are Vite and webpack: a `new URL` inside `node_modules` would have to
resolve, and emit a self-contained chunk, under both. So `CampaignStage` takes
a `createWorker: () => Worker` prop and each host keeps its own worker entry.
That is also what makes the verification above meaningful: the docs site's
entry is a site-owned module of the same shape as the benchmark's, which the
`dagr-worker-runtime` plugin already covers, rather than an expression inside
a dependency that has to survive two bundlers. Verified by loading the built
site: 3,010 nodes, 101 tiles, 95 layout runs, gated on `data-renderer-drawn`
and a floor on the canvas-only PNG rather than on the readout.

**The phasing table above is wrong about how the service goes away**, and the
correction is the most useful thing D1 learned. It says
`dagr-demo.onrender.com` can be "removed by the blueprint sync". A blueprint
sync never deletes an existing resource, even one whose definition has gone
from the file, and a resource removed from the blueprint but left in the
dashboard is recreated by the next sync. Removing the block is still the first
step, and the second is a hand in the Render dashboard. The claim came from
reading the sync's overwrite behaviour, which is real, as a delete behaviour.

The stylesheet is a named entry, `@dagr/campaign-stage/stage.css`, imported by
the host: a package that builds through `tsc` copies no CSS into `dist`, so an
import inside a module would resolve under Vite and point at nothing under
webpack. Its colour tokens moved onto `.stage` in the same pass, since they
were reading the demo page's `:root` and a docs site's `:root` means other
things by the same names.

## Not in scope

- Picking edges directly (M4.8).
- Animated demos (the recorded follow-up); this plan leaves them a home.
- Reworking the docs landing page beyond the link.
