# docs

The Docusaurus site behind [dagr.prnt.design](https://dagr.prnt.design):
the landing page in `src/pages/`, the docs in `docs/`, the campaign demo at
`/demos/campaign`, the muslin theme port in `src/css/custom.css`. Render
deploys `main` when CI is green; see `render.yaml` at the repo root.

## The campaign demo, and the two things it needs

`src/pages/demos/campaign.tsx` is the route. Everything on the canvas is
`@dagr/campaign-stage`, the same component `apps/demo` mounts, so what the site
shows and what the playground shows cannot drift.

It is mounted through `<BrowserOnly>` AND required rather than imported, in
`src/components/CampaignDemo/`. `BrowserOnly` stops the component rendering
during the server build; it does nothing about a top-level `import`, which is
hoisted and evaluated whether or not anything renders it, and the stage reaches
a GPU adapter through three.js.

The worker beside it is this site's own entry, not the package's, because
webpack resolves `new Worker(new URL(...))` from the module that writes it. It
is a second copy of the landing page demo's two-line worker for that reason, and
both of them need the `dagr-worker-runtime` plugin in `docusaurus.config.ts`:
without it a worker entrypoint gets no runtime bootstrap, throws on its first
line, and never answers, which the page cannot tell from a slow layout.

The stylesheet is `@dagr/campaign-stage/stage.css`, imported by the component
rather than by the package's own modules, and its colours are its own: the stage
is a viewport into a scene the renderer paints on near black, so it stays dark
under the site's light theme rather than following it.

## The two figures on the landing page, and which is which

The hero, near the title, is committed engine output. `scripts/generate-hero-graph.mjs`
builds a 20 node graph, runs `layout` on it, and writes coordinates and routes
to `src/components/heroGraphData.json`, which `HeroGraph.tsx` draws inline so
every color resolves from the theme tokens. Regenerate it after a `pnpm build`
at the repo root:

```bash
pnpm --filter docs generate:hero   # src/components/heroGraphData.json
```

Regenerate whenever the layout engine changes enough that the drawing stops
representing it. Those two files are load-bearing: they are what the page shows
when JavaScript is off.

The scale figure below it is not committed anything. `src/components/LiveLayout/`
generates the benchmark corpus in the visitor's browser, lays it out with
`@dagr/layout` in a web worker, and reports the time it took on their machine.
Nothing to regenerate, and nothing that can go stale: it runs whatever the site
was built from.

It replaced a committed SVG of the same corpus and a quoted millisecond figure.
`generate-perf-graph.mjs`, `perfStats.json` and `static/img/bench-1k-*.svg` are
gone with it, so do not look for a `generate:perf` script.

## What the demos need from the build

The site imports `@dagr/graph`, `@dagr/layout` and `@dagr/campaign-stage`,
which brings `@dagr/campaign` and `@dagr/render` with it, so all of them have to
be built before it. `render.yaml` runs `pnpm --filter docs... build`, which does
that in dependency order; the root `pnpm build` does too, because `pnpm -r` is
topological and the dependency creates the edge. Building the site alone against
a fresh clone fails until the packages have a `dist`.

Typecheck reads the packages from source through `paths` in `tsconfig.json`,
the way every other workspace package does, because `dist` does not exist in a
fresh clone or in CI, where typecheck runs before build. The bundler resolves
the built `dist` through the workspace symlink, which is the same artefact a
consumer installs.

ADDING A WORKSPACE DEPENDENCY IS TWO EDITS, the same trap `apps/demo/README.md`
documents in its own form: a `paths` entry here, so typecheck reads source, and
a `dependencies` entry in `package.json`, so the bundler can resolve the package
at all. The `paths` map is longer than what this site imports by name, because
typecheck follows `@dagr/campaign-stage`'s source into the packages it imports.
A local gate proves nothing about a fresh clone while a stale `dist` is lying
around: delete every `dist` in the workspace before trusting one.

The demo's copy of the corpus generator lives in `src/components/LiveLayout/corpus.ts`
and is a port of the bench kit's, which is private and never built.
`bench/test/docs-corpus-port.test.ts` runs both generators against each other,
so the 1k preset stays the graph the committed baseline gates on.
