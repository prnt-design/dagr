# Documentation site

Docusaurus powers [dagr.prnt.design](https://dagr.prnt.design). The homepage is
**Dagr**, an engineering showcase led by a chess opening atlas. The atlas uses
Dagr layout and a canvas scene with cached overview boards, zoom-dependent
piece detail, and offscreen culling. Its inspector provides keyboard navigation
and a single SVG board.

**Inside the graph** is the architecture deep dive below it, with three modes:

- **Architecture:** a source-derived runtime map, laid out by `@dagr/layout`
  and displayed with HTML and SVG. Node selection is application UI.
- **Follow an edit:** the shared `@dagr/living-stage` demo, initially paused.
- **Rich content:** a small `DagrCanvas` scene with React `Html` nodes and a
  world-space edge annotation.

The homepage also runs the seeded layout benchmark in a worker. Its timing
includes the worker round trip and is not a renderer frame-rate measurement.

## Develop

```bash
pnpm --filter docs... build
pnpm --filter docs start
```

Workspace dependencies must be built before Docusaurus resolves their `dist`
exports. Typecheck resolves their source through `tsconfig.json` paths.
Adding a package requires a dependency, a source path, and a check of the
Render deployment filters in `render.yaml`.

## Where to edit

| Surface | Source |
| --- | --- |
| Landing page | `src/pages/index.tsx` and its CSS module |
| Chess atlas | `src/components/ChessAtlas/` |
| Architecture and inspector | `src/components/ArchitectureExplorer/` |
| Live mutation demo | `src/components/LivingDemo/` and `packages/living-stage/` |
| Scale measurement | `src/components/LiveLayout/` |
| Theme | `src/css/custom.css` |
| Reader documentation | `docs/` |

Architecture data is a curated runtime overview, not an automatically extracted
dependency graph. Keep its claims and source links aligned with the packages.

## Browser-only rendering

Renderer modules reach browser APIs through three.js. Mount them through
`BrowserOnly` and require them inside its callback; a static import still
evaluates during server rendering. The architecture map itself is server-rendered
and remains readable without JavaScript.

Worker entrypoints belong to the host bundler. The `dagr-worker-runtime` plugin
keeps webpack runtime code in the worker bundle and declares the bootstrap
requirements Docusaurus's chunk plugin needs. Keep it for `LiveLayout`.

## Archived campaign

`/demos/campaign` and the historical `/docs/campaign` redirect now reach an
archive notice. The public site does not mount the campaign. Its fixture,
stage, host component, and captures remain in the repository. The local demo
can still open it explicitly with `#view=campaign`; it is absent from the
visible switch.

`HeroGraph.tsx` and its generated data remain as an earlier design artifact.
The homepage no longer uses them. The live benchmark's corpus port is checked
against the bench generator by `bench/test/docs-corpus-port.test.ts`.
