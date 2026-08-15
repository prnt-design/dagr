# @dagr/campaign-stage

The campaign demo as a mountable React component: the canvas, the camera, the
input, the HTML overlay and the scene build. Private, never published.

It exists because two pages draw the same thing. `apps/demo` is the playground
the engine is exercised in, and `/demos/campaign` on the docs site is the one a
reader lands on. Before this package they were one page, and moving the demo
into the docs site without moving the code would have left two of them to drift.

```tsx
import { CampaignStage } from '@dagr/campaign-stage';
import '@dagr/campaign-stage/stage.css';

<CampaignStage createWorker={() => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })} />;
```

## What a host still owns

**The worker entry.** `new Worker(new URL(...))` is an expression the bundler
resolves from the module that writes it, and the two hosts are Vite and webpack.
A `new URL` inside this package would have to resolve, and emit a self-contained
chunk, under both; each host writing its own is one expression each in a place
its own bundler already handles. It is also what puts the docs site's entry
where the `dagr-worker-runtime` plugin covers it.

`createWorker` is called once per mount and its identity is never compared, so
an inline arrow is safe: an effect keyed on it would tear down a hundred layout
runs on any re-render.

**The stylesheet**, `@dagr/campaign-stage/stage.css`, imported by the host and
not by the modules that own the class names. The package builds through `tsc`,
which copies no CSS into `dist`, so an import inside a module would resolve
under Vite and point at a file that is not there under webpack.

**The height.** `.stage` fills the element it is mounted in. The demo page gives
it a band between 600 and 780 pixels with the facts panel under it; the docs
route gives it the viewport under the navbar.

## What travels with it

| File | What it owns |
| --- | --- |
| `campaign-style.ts` | one table: the shape, size and colours of each node kind |
| `tiles.ts` | cutting the campaign into tiles, packing them, and every gap in the drawing |
| `campaign-scene.ts` | the layout runs, the packing, and the y flip |
| `campaign-edges.ts` | the three edge groups, the bows, and the ink an edge is drawn in |
| `campaign-tiers.ts` | the overlay's title and card tiers, both gates, and the far-end labels a hover adds |
| `edge-highlight.ts` | which edges touch a node, which nodes are at their far ends, and what a hover dims |
| `use-campaign-scene.ts` | the campaign, the worker's lifetime, and the scene |
| `FirstLight.tsx` | the canvas, the camera, the input, the overlay |
| `camera-input.ts` | the arithmetic between a DOM event and a camera call |
| `stage.css` | every rule, including `campaign-cards.css` for the tiers |

`CampaignStage` is `useCampaignScene` plus `FirstLight`. A host that wants to
write prose about the scene calls the hook itself and passes the pieces down,
which is what `apps/demo` does for its facts panel; calling the hook twice on
one page would lay the campaign out twice.

## How to read the drawing

A node's colour is its STRATUM: amber is the narrative spine, blue the
geography, violet the people, green the quests, red the pressure clocks, grey
the reference material. Within a family the deeper kinds are darker, so a region
reads as a heading over its rooms.

An edge's colour is its SOURCE node's, a step darker, so a line says where it
comes from: a ribbon out of a quest is quest green wherever it lands. An edge's
DASH is its role, which is the split `@dagr/campaign`'s `EDGE_ROLES` makes:
dashed for the hierarchy and flow kinds a layout routes, solid for the dense
cyclic kinds it never sees, and the dash flows source to target, which is the
arrowhead this renderer does not draw. Colour cannot carry both facts, because
sixteen kinds times two roles is thirty-two inks nobody can tell apart.

The overlay kinds fade in over 1.5 to 4 CSS pixels per world unit, so the social
and clue webs are absent while a reader is looking at the shape of the campaign
and there once they are asking about one node's neighbourhood.

HOVER A NODE and its own edges stay at full width and alpha while every other
edge falls to a fifth of both, which is a twenty-fifth of the ink. The far end of
each lit edge gets a name even when nothing at that zoom is wide enough to have
earned one, which is what answers "where does this edge go" without following the
line. It is one `setEdgeIntensity` call per edge group and one `setNodes` on a
second overlay layer, both only when the hovered node changes.

The highlight has a floor: it only fires once the hovered node is at least 24 CSS
pixels wide, which is the same gate the title tier opens at. At the fitted
campaign a pointer crosses hundreds of nodes and none of them is a pixel wide, so
dimming 7,100 edges there would answer a question nobody asked.

Spacing is the campaign's own rather than `@dagr/layout`'s default, and
`CAMPAIGN_SPACING` in `tiles.ts` carries the measurement that chose it,
including what the fitted view pays for it.

## The colour tokens are on `.stage`

Not on `:root`. The stage grew up on a page that owned its whole document and
read `--ink`, `--amber` and friends off it. A docs site has no such variables
and its own tokens mean other things by similar names, so the stage declares its
own on its container and inherits nothing from a host. The palette is the
renderer's, amber on near black: this is a viewport into a scene with its own
colours, so it does not follow a light theme.

Anything measuring this text in a headless browser has to pin the font. See the
note in `apps/demo/scripts/capture.mjs`: a bare box resolves the whole monospace
stack to a 6.000px advance at 12px, about a sixth narrower than a reader sees,
and the card sizes were budgeted against a real face. The token to pin is
`--dagr-stage-mono`, on `.stage`.

## What a test can reach

`tiles.ts`, `campaign-style.ts`, `camera-input.ts`, `campaign-edges.ts` and the
tier builders are pure and covered in `test/`; `campaign-scene.test.ts` runs the
whole build with no worker, which `@dagr/layout` supports by falling back to the
calling thread, so the packing, the offsets and the flip are checked without a
browser.

`FirstLight.tsx` has no test file, which is the same decision `@dagr/render`
documents for its own renderer rather than a gap: it needs a GPU adapter, a
laid-out canvas, a worker and live input events, and a jsdom suite could only
assert that a mock was called. `camera-input.ts` exists BECAUSE of that: it is
what was extracted so a suite could reach the arithmetic without a canvas.

## Building it

`tsc -p tsconfig.build.json`, and the build config drops the `paths` map that
typecheck uses. Pulling `../render/src` into the program puts files outside
`rootDir` and tsc refuses to emit, so the build resolves the Dagr packages
through node_modules to their published types, and they have to be built first.
The root `pnpm build` handles that: `pnpm -r` is topological and the
dependencies create the edges.

The docs site reads this package's `dist`. A change here that has not been built
is a site that ships the last one.
