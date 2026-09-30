# Documentation site

Docusaurus powers [dagr.prnt.design](https://dagr.prnt.design). The homepage is
**Dagr**, an engineering showcase led by a commerce system atlas. The atlas
uses `@prnt/dagr-vdsl` to declare seven node kinds and validate typed connections,
`@prnt/dagr-layout` for geometry, and HTML/SVG for rendering. Search finds names,
kinds, routes, and schema fields. Selecting a connection or search result zooms
to its node; the overview, summary, and rich detail levels follow camera scale.
The inspector mirrors node content and provides a live connection validator.

The architecture is an illustrative example, not Dagr's internal architecture
or live infrastructure. Configuration values are sample language data.
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
| System atlas and VDSL fixture | `src/components/SystemAtlas/` |
| Live mutation demo | `src/components/LivingDemo/` and `packages/living-stage/` |
| Scale measurement | `src/components/LiveLayout/` |
| Theme | `src/css/custom.css` |
| Reader documentation | `docs/` |

The fixture validates every node configuration and edge before layout. Change
the registry, fixture, and associated tests together when evolving the language.

## Browser-only rendering

Renderer modules reach browser APIs through three.js. Mount them through
`BrowserOnly` and require them inside its callback; a static import still
evaluates during server rendering. The system atlas content is server-rendered; its expandable node and connection
list remains readable without JavaScript. Interactive navigation needs JavaScript.

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
