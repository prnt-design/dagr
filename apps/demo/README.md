# demo

The playground Dagr is exercised in. Two demos behind a switch, one at a time:
the **living graph**, a build pipeline edited while you watch with a count of
what each edit moved, and the **campaign**, a mock D&D campaign of 3,010 nodes
laid out in a worker. Vite and React, private, never published.

```bash
pnpm --filter demo dev     # http://localhost:5173
pnpm --filter demo build   # apps/demo/dist
```

NO DEPLOY. This built to `dagr-demo.onrender.com` for one day, and both demos
now live on the docs site, at
[/demos/living](https://dagr.prnt.design/demos/living) and
[/demos/campaign](https://dagr.prnt.design/demos/campaign), where a reader finds
them under the site's own nav instead of on a second service. What is here is a
local playground: `pnpm dev` and a browser.

ONE AT A TIME, and not stacked. Each stage mounts a canvas, and two live
canvases is two GPU device contexts for a page that can only be looking at one.
The switch is a `useState` and no router: a route each is right for a site a
visitor navigates, and both deployed demos already have one.

It opens on the living graph, and `#view=campaign` opens on the other. That key
is why `scripts/capture.mjs` still works: every committed screenshot is of the
campaign, taken by navigating to a hash and waiting for the stage to say it has
drawn, and without it a capture would wait sixty seconds for a stage that was
never mounted. It is read once at mount, with `URLSearchParams`, which is also
how the stage reads `#node=` and `#zoom=` out of the same hash.

## What is left here, and what moved

Everything on either canvas is a package, `@dagr/campaign-stage` and
`@dagr/living-stage`, because the docs site mounts the same two components and
two copies would drift. This app is the page around them.

| File | What it owns |
| --- | --- |
| `App.tsx` | the header, the demo switch, the facts panels, and the worker this app builds |
| `main.tsx` | the StrictMode mount, and the three stylesheets in order |
| `layout-worker.ts` | the worker end of `@dagr/layout`'s protocol |
| `styles.css` | the page: its palette, the facts panel, the stage's frame |
| `scripts/capture.mjs` | the committed screenshots, taken reproducibly |

`App.tsx` calls `useCampaignScene` rather than mounting `CampaignStage`, because
the facts below the canvas are written from the same scene the canvas draws and
calling the hook twice would lay the campaign out twice.

The worker is built HERE and handed to the stage as `createWorker`. `new
Worker(new URL(...))` is an expression the bundler reads statically, and this
app's bundler is Vite where the docs site's is webpack, so each host owns its
entry. Vite emits `layout-worker.ts` as its own chunk from that expression, and
a worker loads exactly one script.

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

The alias map is LONGER than this app's dependency list, and that is deliberate:
the stage's own source imports `@dagr/graph`, `@dagr/layout` and `@dagr/render`,
and an alias is a path mapping rather than a dependency, so those entries are
what keep the whole tree on source. An alias key also matches anything under it
as a path, which is why `@dagr/campaign-stage/stage.css` has an entry of its own
ahead of the package's: without it the specifier is rewritten into
`.../src/index.ts/stage.css` and the build fails on "not a directory".

## The stylesheets, in order

`main.tsx` imports `@dagr/campaign-stage/stage.css`, then
`@dagr/living-stage/living.css`, then `styles.css`, and the order is load
bearing: the page adds the frame around whichever stage is mounted (its height,
its border) and a host override has to come after what it overrides. Both
stages' colour tokens are their own rather than `:root`'s, so mounting either in
a docs site does not make it read a variable the host happens to share a name
with. This page's `:root` tokens are the same values, declared twice on purpose.

Both are imported unconditionally even though one stage is on screen at a time:
a stylesheet is a static import either way, and two of them are a few hundred
bytes against a bundle that carries three.js.

## No tests here

They live with the code they cover, in `packages/campaign-stage/test/` and
`packages/living-stage/test/`. What is left in this app is the page chrome, the
demo switch and the worker entry, and a jsdom suite over any of those would
assert that a mock was called.

```bash
pnpm --filter @dagr/campaign-stage test
pnpm --filter @dagr/living-stage test
```
