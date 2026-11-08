# Migrating from Dagr 0.1.4 to 0.2.0

These examples describe current public interfaces and are illustrative source
examples, not newly executed compiler fixtures. Existing strict external type
checks and package suites are the recorded verification. Before snippets show
0.1.4 assumptions that fail against the expanded interface.

### 1. GraphHitTarget gains kind: 'edge'

Before, this two-way branch covered the node/port union:

```ts
import type { GraphHitTarget } from '@prnt/dagr-react';

function targetId(target: GraphHitTarget): string {
  return target.kind === 'node' ? target.nodeId : target.portId;
  // In 0.2.0 the else branch also contains an edge, which has no portId.
}
```

After, narrow each variant and keep an exhaustiveness check:

```ts
import type { GraphHitTarget } from '@prnt/dagr-react';

function targetId(target: GraphHitTarget): string {
  switch (target.kind) {
    case 'node': return target.nodeId;
    case 'port': return target.portId;
    case 'edge': return target.edgeId;
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}
```

Migration: search hit-provider consumers, selection reducers, serializers and
mocks for direct nodeId/portId reads, two-way kind branches and exhaustive
switches. Add an explicit edge policy before accessing fields. Preserve kind
when persisting selection: a node and edge sharing an id remain different
targets. Default DagrCanvas behavior does not enable edge selection merely by
upgrading; onEdgeClick/onEdgeHover opt in to its edge-hit path.

### 2. Renderer gains required asynchronous pickNode

Before, a plain-object test double implementing the old interface could omit
picking:

```ts
import type { Renderer } from '@prnt/dagr-render';

declare const oldPlainObjectMock: Omit<Renderer, 'pickNode'>;
const mock: Renderer = oldPlainObjectMock;
// In 0.2.0 pickNode is missing.
```

After, a test double modeling an empty scene answers no hit:

```ts
import type { Renderer } from '@prnt/dagr-render';

declare const oldPlainObjectMock: Omit<Renderer, 'pickNode'>;
const mock: Renderer = {
  ...oldPlainObjectMock,
  pickNode: async (_pointer) => null,
};
```

Migration: add pickNode to custom Renderer classes, adapters and mocks. A real
implementation must answer Promise<string | null> using a CSS-pixel pointer
relative to the canvas top-left, honor node silhouettes/topmost ordering, and
avoid returning stale/reassigned ids after asynchronous work. Do not copy the
no-hit test stub into a production backend. Existing createRenderer users get
its implementation automatically; ordinary DagrCanvas users retain default CPU
hit testing. GPU node picking is opt-in, and edges still use the CPU path.

### 3. ExplorerLabels gains four required labels

Before, a complete 0.1.4 translation/mocked label object covered the old keys:

```ts
import type { ExplorerLabels } from '@prnt/dagr-explorer';

type NewLabel = 'outline' | 'presentation' | 'mapMode' | 'outlineMode';
declare const translated014: Omit<ExplorerLabels, NewLabel>;
const labels: ExplorerLabels = translated014;
// In 0.2.0 the four labels are missing.
```

After, supply all four in the host's language:

```ts
import type { ExplorerLabels } from '@prnt/dagr-explorer';

type NewLabel = 'outline' | 'presentation' | 'mapMode' | 'outlineMode';
declare const translated014: Omit<ExplorerLabels, NewLabel>;
const labels: ExplorerLabels = {
  ...translated014,
  outline: 'Nodes',
  presentation: 'Presentation',
  mapMode: 'Map',
  outlineMode: 'Outline',
};
```

A partial prop override still inherits defaults and needs no new fields:

```tsx
<DagrExplorer label="Project map" views={views} labels={{ search: 'Find' }} />
```

Migration: update full translations and manually assembled label mocks, then
check role/name queries for the new Map/Outline controls. Avoid brittle control
counts. Selection/query/details and the map camera now persist across mode
switches. Compact details and visual-viewport camera framing intentionally
change layout/navigation behavior; retain the documented device limitations.
React 18 applications still use scoped Explorer; umbrella and React canvas
remain React 19 surfaces.
