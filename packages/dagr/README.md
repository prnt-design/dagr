# @prnt/dagr

The convenience entry point for Dagr. The root exports the graph model;
subpaths expose each package without merging conflicting names.

```sh
npm install @prnt/dagr react react-dom three   # the renderer and React parts need three
```

```ts
import { Graph } from '@prnt/dagr';
import { layout } from '@prnt/dagr/layout';
// Also available: @prnt/dagr/graph, @prnt/dagr/render, @prnt/dagr/render/core,
// @prnt/dagr/react, @prnt/dagr/vdsl and @prnt/dagr/explorer.

const graph = new Graph();
graph.addNode('source');
graph.addNode('sink');
graph.addEdge('source', 'sink', 'flow');
const result = layout({ graph });
```

Each entry point forwards the same exports and types as its corresponding
`@prnt/dagr-*` package. `@prnt/dagr` and `@prnt/dagr/graph` both forward
`@prnt/dagr-graph`. `@prnt/dagr/render/core` forwards
`@prnt/dagr-render/core`, the renderer's camera and edge-path arithmetic with
no three.js, and `@prnt/dagr/explorer` forwards `@prnt/dagr-explorer`, the
DOM and SVG graph explorer. Importing the root does not initialize a
renderer. The umbrella installs all six packages. For a smaller dependency
set, install the scoped packages individually.

ES modules only. The umbrella requires React 19 and React DOM 19. The
explorer itself also runs on React 18, so a React 18 site installs
`@prnt/dagr-explorer` directly rather than through the umbrella. three.js
(>=0.180.0 <1.0.0) is marked an optional peer: `@prnt/dagr/render` and
`@prnt/dagr/react` load it, and the root, `@prnt/dagr/graph`,
`@prnt/dagr/layout`, `@prnt/dagr/render/core`, `@prnt/dagr/vdsl` and
`@prnt/dagr/explorer` never do. `@prnt/dagr-render` marks it optional too,
so a site that uses neither of those two entries installs no three.js. Install
`three` yourself to use `@prnt/dagr/render` or `@prnt/dagr/react`. See the [documentation](https://dagr.prnt.design/)
and the scoped package READMEs for API details and runtime requirements.
