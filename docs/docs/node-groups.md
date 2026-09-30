---
id: node-groups
title: Node groups and boundaries
sidebar_position: 8
---

# Node groups and boundaries

A node group draws a labeled, dashed rectangle around selected nodes. Use it
for trust boundaries, ownership, deployment zones, or a subsystem outline.

```tsx
import { DagrCanvas, Html } from 'dagr/react';
import type { NodeGroup } from 'dagr/react';

const groups: readonly NodeGroup[] = [{
  id: 'processing',
  label: 'PROCESSING GROUP',
  nodeIds: ['parse', 'validate'],
  padding: 30,
  color: 0x9b88e9,
}];

<DagrCanvas graph={graph} groups={groups} animate>
  <Html node="parse">Parse input</Html>
  <Html node="validate">Validate input</Html>
</DagrCanvas>;
```

The same APIs are available from `@prnt/dagr-react` and `@prnt/dagr-render`.
The boundary follows the positions actually drawn, including intermediate
animation frames. It shares the canvas camera and draw loop. Its transparent
interior leaves edges visible and never takes pointer events from the graph.

## Membership and layout

`nodeIds` is explicit visual membership. It can overlap another group's
membership, and a larger group can include all the members of a smaller one.
Missing IDs are ignored; a group with no present members is hidden. Duplicate
group IDs and invalid padding or colors throw before replacing existing groups.
Use new arrays when updating the React prop.

**Groups do not change layout.** The current layout pipeline does not keep
members together or keep other nodes outside a boundary. A rectangle around
separated members can enclose unrelated nodes. Choose positions and membership
that communicate your architecture accurately. Compound layout remains planned.
A trust boundary is an annotation, not an authorization mechanism.

The graph model's `parent` relationship is separate. To show its direct
children, supply `nodeIds: graph.children(parentId)`.
Include nested descendants explicitly if they should share the boundary.
Parent IDs are not automatically rendered as group boxes.

## Styling and accessibility

Padding defaults to 24 world units. A non-empty label reserves another 24 world
units above the members. The color defaults to `0x8b78dc`. The outline uses a
1.5 CSS-pixel stroke and a fixed dash pattern. Titles stay at 12 CSS pixels and
hide when the reserved band or available width is too small.

Boundaries are decorative, do not receive focus, and are hidden from assistive
technology. Supply an accessible member list or inspector beside your graph,
for your users. Use a readable label and member list instead of color
alone. The layer is intended for tens of groups, not one DOM element per node
in a large graph.

## Use the renderer directly

```ts
import { createNodeGroupLayer, nodeGroupBounds } from 'dagr/render';

// Mount after the canvas and before rich-node overlays.
// host is connected, positioned, and has the camera viewport's dimensions.
const boundaries = createNodeGroupLayer({ parent: host, camera: renderer.camera });
boundaries.setGroups(groups);

function draw() {
  // These are SceneNode-style centers and sizes in y-up world coordinates.
  boundaries.setNodes(sceneNodes);
  renderer.render();
  boundaries.sync();
}

// For focus-to-group controls, include padding and the title band.
const bounds = nodeGroupBounds(sceneNodes, groups[0]!);
if (bounds) renderer.camera.fitBounds(bounds);
// Call draw() after changing the camera.

// When unmounting:
boundaries.dispose();
```

`nodeGroupBounds` returns `WorldBounds | null` and does not require the DOM or a
GPU. After changing groups, call `setNodes` again before `sync`: only member geometry
is retained, so an animation does not clone every unrelated node. Update the layer
after node changes and synchronize it from
your existing frame callback. Dispose it before removing the parent.
