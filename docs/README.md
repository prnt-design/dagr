# docs

The Docusaurus site behind [dagr.prnt.design](https://dagr.prnt.design):
the landing page in `src/pages/`, the docs in `docs/`, the muslin theme
port in `src/css/custom.css`. Render deploys `main` when CI is green; see
`render.yaml` at the repo root.

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

## What the live demo needs from the build

The site imports `@dagr/graph` and `@dagr/layout`, so both have to be built
before it. `render.yaml` runs `pnpm --filter docs... build`, which does that in
dependency order; the root `pnpm build` does too, because `pnpm -r` is
topological and the dependency creates the edge. Building the site alone against
a fresh clone fails until the packages have a `dist`.

Typecheck reads both packages from source through `paths` in `tsconfig.json`,
the way every other workspace package does, because `dist` does not exist in a
fresh clone or in CI, where typecheck runs before build. The bundler resolves
the built `dist` through the workspace symlink, which is the same artefact a
consumer installs.

The demo's copy of the corpus generator lives in `src/components/LiveLayout/corpus.ts`
and is a port of the bench kit's, which is private and never built.
`bench/test/docs-corpus-port.test.ts` runs both generators against each other,
so the 1k preset stays the graph the committed baseline gates on.
