# Documentation site

Docusaurus powers [dagr.prnt.design](https://dagr.prnt.design). The homepage is
**Dagr**, a data visualization toolkit with graph layout and motion strengths.
The homepage uses the shipped `DagrExplorer` to map the framework itself.
Packages shows all eight framework packages with dependent-to-dependency arrows:
solid manifest dependencies, dashed required peers, and explicit umbrella
forwarding labels. Features shows provides/uses relationships on the same typed
model. Renderer core/full entry differences, external peers, private chart
status and current-source limits are explained in details.

Group boundaries are member annotations, repeated per package to avoid enclosing
unrelated nodes. They are not nested layout. Search, outline, details and
connection following share Explorer state. An expandable server-rendered guide
keeps package explanations and dependency directions readable without JavaScript.
The historical commerce SystemAtlas fixture remains available but is not mounted
on the homepage. Model tests check package relationships against workspace manifests.

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
| Framework map and manifest validation | `src/components/FrameworkMap/` |
| Historical commerce atlas and VDSL fixture | `src/components/SystemAtlas/` |
| Live mutation demo | `src/components/LivingDemo/` and `packages/living-stage/` |
| Scale measurement | `src/components/LiveLayout/` |
| Theme | `src/css/custom.css` |
| Reader documentation | `docs/` |

The fixture validates every node configuration and edge before layout. Change
the registry, fixture, and associated tests together when evolving the language.

## Browser-only rendering

Renderer modules reach browser APIs through three.js. Mount them through
`BrowserOnly` and require them inside its callback; a static import still
evaluates during server rendering. The framework map uses Explorer’s three.js-free entry and renders on the server.
Its expandable package and feature guide remains readable without JavaScript.
Interactive navigation needs JavaScript.

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
