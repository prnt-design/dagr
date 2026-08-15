# demo

The playground Dagr is exercised in: a mock D&D campaign of 3,010 nodes, laid
out by `@dagr/layout` in a worker and drawn by `@dagr/render` on a canvas. Vite
and React, private, never published.

```bash
pnpm --filter demo dev     # http://localhost:5173
pnpm --filter demo build   # apps/demo/dist
```

Once the service exists, `main` deploys to `dagr-demo` on its own
`onrender.com` subdomain when CI is green, from the `render.yaml` at the repo
root. Creating a service from a blueprint prompts in Render's dashboard, so
until a maintainer answers that there is no URL and nothing here links to one. The docs site is the published one at
dagr.prnt.design; this is a working artifact, and a subdomain of prnt.design is
a promise about permanence a playground should not make.

## Adding a workspace dependency is TWO edits

`vite.config.ts`'s alias map and `tsconfig.json`'s `paths`, and neither is
optional. Both point every `@dagr/*` import at the package's SOURCE, so the demo
runs in a fresh clone with nothing built. Miss either one and the import
resolves through the package's `exports` to a `dist/` that a clean checkout does
not have.

The failure is worse than it sounds, because a local gate does not catch it:
`dist` is usually lying around from an earlier build, and CI typechecks before
it builds. M4.4 added `@dagr/layout` and shipped that mistake to review; the way
to check is to delete every `dist` in the workspace and run `pnpm typecheck`.

## What is on screen

`App.tsx` generates the campaign at module load and builds the scene in an
effect. Generating is synchronous, deterministic and about a millisecond;
laying it out is about a hundred worker round trips, which needs a document and
has to be cancellable.

| File | What it owns |
| --- | --- |
| `campaign-style.ts` | one table: the shape, size and colours of each node kind |
| `tiles.ts` | cutting the campaign into tiles, and packing them |
| `campaign-scene.ts` | the layout runs, the packing, and the y flip |
| `layout-worker.ts` | the worker end of `@dagr/layout`'s protocol |
| `FirstLight.tsx` | the canvas, the camera, the input, the overlay |
| `camera-input.ts` | the arithmetic between a DOM event and a camera call |

`main.tsx` mounts the app in StrictMode and `styles.css` holds every rule,
including the overlay's two-element split: the outer element is the node's world
box and scales with the zoom, and the inner one counter-scales through
`--dagr-overlay-inv-zoom` so its text is a constant number of CSS pixels.

The tiling is the plan's decision and `tiles.ts` carries the argument: one
Sugiyama pass over the whole campaign ranks 750 rooms into a couple of layers
and draws a ribbon 50 times wider than it is tall.

`campaign-style.ts` has THREE readers, which is why it is its own file. Layout is
told the size the renderer draws, and the overlay places a card against the same
box. A node laid out at one size and drawn at another overlaps its neighbours in
a picture whose layout says it does not, and no test of either half alone can
see it.

## The y flip

`@dagr/layout` computes y-down and `Camera2D` is y-up. The conversion happens
ONCE, in `campaign-scene.ts`'s `toWorld`, at the very end: tile layouts, the
shelf packing and the grids all stay in y-down space, so there is exactly one
line where the sign changes. Routes ride the same flip as the node boxes, and
that is asserted rather than assumed, because a route flipped differently from
its endpoints still starts and ends near the right nodes and only bulges the
wrong way in between, which reads as a routing bug.

## What a test can reach

`tiles.ts`, `campaign-style.ts` and `camera-input.ts` are pure, and all three
are covered: `test/tiles.test.ts` decides every claim the first two make against
the real dataset across three seeds and three scales, and
`test/camera-input.test.ts` covers the wheel arithmetic, the hash parsing, the
key map and the derived zoom range. `test/campaign-scene.test.ts` runs the whole
build with no worker, which `@dagr/layout` supports by falling back to the
calling thread, so the packing, the offsets and the flip are all checked without
a browser.

`camera-input.ts` exists BECAUSE of that coverage: it is what was extracted out
of `FirstLight.tsx` so a suite could reach it without a canvas.

What is left in `FirstLight.tsx` has no test file, and that is the same decision
`@dagr/render` documents for its own renderer rather than a gap: it needs a GPU
adapter, a laid-out canvas, a worker and live input events, and a jsdom suite
could only assert that a mock was called. The extraction is what makes that
remainder small enough to leave to a screenshot.
