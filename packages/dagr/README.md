# @prnt/dagr

The convenience entry point for Dagr. The root exports the graph model;
subpaths expose each package without merging conflicting names.

```sh
npm install @prnt/dagr react react-dom three   # three only for render and react
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
(>=0.180.0 <1.0.0) is an optional peer: `@prnt/dagr/render` and
`@prnt/dagr/react` need it, and the root, `@prnt/dagr/graph`,
`@prnt/dagr/layout`, `@prnt/dagr/render/core`, `@prnt/dagr/vdsl` and
`@prnt/dagr/explorer` do not. See the [documentation](https://dagr.prnt.design/)
and the scoped package READMEs for API details and runtime requirements.
