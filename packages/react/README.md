# @dagr/react

[Dagr](https://dagr.prnt.design) as one React component: a graph goes in, a
picture comes out.

```sh
pnpm add @dagr/react @dagr/graph @dagr/render three react react-dom
```

`@dagr/graph`, `@dagr/render`, `react` and `react-dom` are peer dependencies.
`@dagr/layout` is a real dependency and comes with the install.

```tsx
import { Graph } from '@dagr/graph';
import { DagrCanvas, Html } from '@dagr/react';

const graph = new Graph();
graph.addNode({ id: 'plan' });
graph.addNode({ id: 'build' });
graph.addEdge({ source: 'plan', target: 'build' });

export function Board() {
  return (
    <DagrCanvas graph={graph} style={{ width: '100%', height: 480 }}>
      <Html node="plan">Plan</Html>
      <Html node="build">Build</Html>
    </DagrCanvas>
  );
}
```

Four exports carry the package. `DagrCanvas` is the component. `useDagr` is the
layout on its own, for a caller drawing it their own way or reading the geometry
beside a canvas somebody else owns. `Html` puts React content in world
coordinates over the canvas. `useDagrCanvas` is how anything inside reaches the
renderer.

What is not here yet, so you know before you reach for it: no hover, selection
or drag (M5.2), and no animation wired through the component (M4.7c).

## Read this first: the `graph` prop is watched, not compared

A `Graph` is mutable, so comparing it by identity the way React compares
everything would mean `graph.addNode(...)` changed nothing on screen until you
also replaced the object. Instead the hook subscribes to the graph through
`useSyncExternalStore`, and **both of these redraw**:

```tsx
graph.addNode({ id: 'ship' });
setGraph(rebuildFromScratch());
```

There is one narrow window this leaves open and it is real. React subscribes in
an effect, after the render that read the store, and effects run child first.
A **child's** mount effect that edits the graph runs before the canvas has
subscribed, so that one edit is not picked up. Edit in a parent effect, or in an
event handler, and it is.

## Documentation

The component, the hook, the overlay and the conversion are on the
[React bindings](https://dagr.prnt.design/docs/react) page.

MIT © prnt.design
