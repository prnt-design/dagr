# @prnt/dagr

The convenience entry point for Dagr. The root exports the graph model;
subpaths expose each package without merging conflicting names.

```sh
npm install @prnt/dagr react react-dom three
```

```ts
import { Graph } from '@prnt/dagr';
import { layout } from '@prnt/dagr/layout';
// Also available: @prnt/dagr/graph, @prnt/dagr/render, @prnt/dagr/react, @prnt/dagr/vdsl.

const graph = new Graph();
graph.addNode('source');
graph.addNode('sink');
graph.addEdge('source', 'sink', 'flow');
const result = layout({ graph });
```

Each entry point forwards the same exports and types as its corresponding
`@prnt/dagr-*` package. `@prnt/dagr` and `@prnt/dagr/graph` both forward
`@prnt/dagr-graph`. Importing the root does not initialize a renderer.
The umbrella installs all five packages. For a smaller dependency set,
install the scoped packages individually.

ES modules only. React bindings require React 19 and React DOM 19; rendering
uses three.js >=0.180.0 <1.0.0. See the [documentation](https://dagr.prnt.design/)
and the scoped package READMEs for API details and runtime requirements.
