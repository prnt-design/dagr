# M5.6b `@prnt/dagr-explorer` pure core implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `@prnt/dagr-explorer` package with its headless core:
data types, validation, layout into world coordinates, and search.

**Architecture:** Four small pure modules behind one entry. `validate.ts`
rejects malformed views with typed errors. `layout.ts` turns a view into boxes,
edge routes and group rectangles in y-down world pixels, using
`@prnt/dagr-layout` for positions and `@prnt/dagr-render/core` for edge shaping.
`search.ts` filters nodes by tokens. Nothing in this slice renders, touches the
DOM, or imports React at runtime.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@prnt/dagr-graph`,
`@prnt/dagr-layout`, `@prnt/dagr-render/core`

**Spec:** `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`, sections
"Package and entry points", "Data model", "Search" and "Errors". This is slice
M5.6b of that spec.

**Depends on:** M5.6a merged to `main` (`@prnt/dagr-render/core` exists).

## Global constraints

- Package name `@prnt/dagr-explorer`, directory `packages/explorer`.
- `"private": true` in this slice. M5.6f removes it. `publishConfig.access` is
  `public` from the start.
- Initial `version` is the workspace's version on the day this lands: read it
  from `packages/graph/package.json`. It is `0.1.3` since the release on 2026-10-03.
- Peers: `react` and `react-dom`, both `>=18.2.0 <20.0.0`.
- Dependencies: `@prnt/dagr-graph`, `@prnt/dagr-layout`, `@prnt/dagr-render`,
  each `workspace:^`.
- Never import `@prnt/dagr-render` (the full entry), `@prnt/dagr-react`, or
  `three`. From the renderer, import only `@prnt/dagr-render/core`.
- Defaults, exact: direction `'right'`, node size `240` by `120`, `nodeSep`
  `40`, `rankSep` `120`, edge style `'smooth'`.
- World space is y-down CSS pixels at zoom 1, padded `40` off the origin.
- Sizes are declared, never measured. `node.size`, then the view's `nodeSize`,
  then the default.
- Error codes, exact: `DUPLICATE_VIEW_ID`, `DUPLICATE_NODE_ID`,
  `DUPLICATE_EDGE_ID`, `DUPLICATE_GROUP_ID`, `INVALID_NODE_SIZE`,
  `MISSING_EDGE_ENDPOINT`, `MISSING_GROUP_MEMBER`, `EMPTY_GROUP`,
  `GROUP_ENCLOSES_NON_MEMBER`. UPPER_SNAKE, and their type is
  `DagrExplorerErrorCode`, as in every sibling package.
- `ExplorerDataError` carries `code`, the `id` of what it is about (a view,
  node, edge or group) and the `viewId` it was found in (`undefined` when the
  error is about a view itself). A host must not have to parse the message.
- The package's runtime exports after this slice are exactly:
  `DEFAULT_NODE_SEP`, `DEFAULT_NODE_SIZE`, `DEFAULT_RANK_SEP`,
  `ExplorerDataError`, `defaultSearchText`, `layoutView`, `resolveNodeSize`,
  `searchNodes`, `validateView`, `validateViews`. `layoutKey` and the layout's
  fixed spacing constants (`WORLD_PADDING`, `GROUP_PADDING`,
  `GROUP_LABEL_BAND`, `PARALLEL_EDGE_GAP`) are exported from
  `src/layout.ts` for the tests and NOT from the package entry: a public
  constant cannot change value or become an option without a break.
- Clean reimplementation. Work from this plan, the spec, and dagr's own files.
  Do not open or copy from the earlier private implementation described in
  the spec's Provenance section.
- Do not edit `LICENSE`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, or
  anything under `.claude/`. Copying the root `LICENSE` into the new package
  is creating a file, not editing one.
- Do not change `version` or publish config in any existing `package.json`.
- No em-dashes in any prose: comments, docs, commit messages, the pull request.
- Commits: conventional subject, author `Dagr Agent <agent@prnt.design>`
  (repo-local git config), trailer
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Work reaches `main` only through a pull request, per `AGENTS.md`.

## Review focus

- **A self loop** (an edge whose source is its target). The router gives it a
  zero-length line. It must not crash, move any node, or stretch the bounds: it
  has an empty route and stays in the data. Pinned in Task 2.
- **A node size of 0, a negative number, `NaN` or `Infinity`,** from
  `node.size`, the view's `nodeSize` value, or the view's `nodeSize` function.
  The layout engine accepts 0 and reports `NaN` as an internal config error. A
  reader of the error must be told which node. Pinned in Task 1.
- **A cycle with parallel edges in both directions** (`a -> b` twice and
  `b -> a`). All three must separate, and the reversed one must still run from
  its own source to its own target. Pinned in Task 2.
- **Ids containing a comma or a quote.** A key built by joining ids with a
  separator makes `['a,b', 'c']` and `['a', 'b,c']` the same pair or the same
  shape. Pinned in Task 2 for both the sibling key and the shape key.
- **A `searchText` accessor that returns something other than a string, and a
  query containing regex metacharacters.** Neither may throw, and the query is
  literal text. Pinned in Task 3.

---

### Task 1: Package scaffold, types, errors, validation

**Files:**
- Create: `packages/explorer/package.json`
- Create: `packages/explorer/tsconfig.json`
- Create: `packages/explorer/tsconfig.build.json`
- Create: `packages/explorer/vitest.config.ts`
- Create: `packages/explorer/LICENSE` (a copy of the root `LICENSE`)
- Create: `packages/explorer/README.md`
- Create: `packages/explorer/CHANGELOG.md`
- Create: `packages/explorer/src/types.ts`
- Create: `packages/explorer/src/errors.ts`
- Create: `packages/explorer/src/size.ts`
- Create: `packages/explorer/src/validate.ts`
- Create: `packages/explorer/src/index.ts`
- Test: `packages/explorer/test/size.test.ts`
- Test: `packages/explorer/test/validate.test.ts`
- Test: `packages/explorer/test/index.test.ts`
- Modify: `pnpm-lock.yaml` (by running `pnpm install`)

**Interfaces:**
- Consumes: the type `Size` (`{ readonly width: number; readonly height: number }`)
  from `@prnt/dagr-render/core`.
- Produces:
  - Types `ExplorerNode`, `ExplorerEdge`, `ExplorerGroup`,
    `ExplorerLayoutOptions<N>`, `ExplorerView<N, E>`, `Size`.
  - `class ExplorerDataError extends Error` with
    `readonly code: DagrExplorerErrorCode`, `readonly id: string`,
    `readonly viewId: string | undefined`, and
    `constructor(code: DagrExplorerErrorCode, message: string, id: string, viewId?: string)`.
  - `const DEFAULT_NODE_SIZE: Size` (`240` by `120`).
  - `resolveNodeSize<N extends ExplorerNode>(layout: ExplorerLayoutOptions<N> | undefined, node: N): Size`
  - `validateView<N, E>(view: ExplorerView<N, E>): void`
  - `validateViews<N, E>(views: readonly ExplorerView<N, E>[]): void`

- [ ] **Step 1: Branch from `main` and confirm M5.6a is there**

```bash
git fetch origin
git switch -c agt_f31326c2a5b0/m5-6b-explorer-core origin/main
pnpm install --frozen-lockfile
git show origin/main:packages/render/src/core.ts | head -3
node -e "console.log(require('./packages/graph/package.json').version)"
```

Expected: the `git show` prints the top of `core.ts`. If it fails, M5.6a has
not merged: stop, this plan cannot start. The last command prints the version
to use for the new package in Step 2.

- [ ] **Step 2: Create the package scaffold**

Create `packages/explorer/package.json`. Set `version` to the value Step 1
printed:

```json
{
  "name": "@prnt/dagr-explorer",
  "version": "0.1.3",
  "private": true,
  "description": "An interactive graph explorer for Dagr: views, search, connection tracing, groups and a details drawer, with virtualized node content.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "src",
    "CHANGELOG.md",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "sideEffects": [
    "*.css"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/prnt-design/dagr.git",
    "directory": "packages/explorer"
  },
  "dependencies": {
    "@prnt/dagr-graph": "workspace:^",
    "@prnt/dagr-layout": "workspace:^",
    "@prnt/dagr-render": "workspace:^"
  },
  "peerDependencies": {
    "react": ">=18.2.0 <20.0.0",
    "react-dom": ">=18.2.0 <20.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc -p tsconfig.build.json"
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  }
}
```

Create `packages/explorer/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    // The base sets `lib: ["ES2022"]` with no DOM. The core in this package is
    // headless, but the package is a React one and its parts own a viewport,
    // a `ResizeObserver` and focus, so DOM is here from the start.
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    // The Dagr packages publish from dist, which does not exist in a fresh
    // clone or in CI, where typecheck runs before build. Typecheck reads them
    // from source, mirrored by the aliases in vitest.config.ts.
    //
    // `@prnt/dagr-render` itself is deliberately NOT mapped: this package may
    // only import the three-free `core` entry, and `test/imports.test.ts`
    // holds that.
    "paths": {
      "@prnt/dagr-graph": ["../graph/src/index.ts"],
      "@prnt/dagr-layout": ["../layout/src/index.ts"],
      "@prnt/dagr-render/core": ["../render/src/core.ts"]
    }
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

Create `packages/explorer/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    // The build emits from `src` alone, so the source `paths` entries are
    // dropped here, as `@prnt/dagr-react` drops its own: pulling
    // ../render/src into the program puts files outside `rootDir` and tsc
    // refuses to emit (TS6059). The build resolves the Dagr packages through
    // node_modules to their built types instead.
    "paths": {}
  },
  "include": ["src"],
  "exclude": ["test", "dist"]
}
```

Create `packages/explorer/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the Dagr packages to their sources, matching the `paths` entries in
// tsconfig.json. The workspace dependencies point at dist, which does not exist
// in a fresh clone or in CI, where test runs before build.
export default defineConfig({
  resolve: {
    alias: {
      '@prnt/dagr-graph': fileURLToPath(new URL('../graph/src/index.ts', import.meta.url)),
      '@prnt/dagr-layout': fileURLToPath(new URL('../layout/src/index.ts', import.meta.url)),
      '@prnt/dagr-render/core': fileURLToPath(new URL('../render/src/core.ts', import.meta.url)),
    },
  },
});
```

Copy the license and create the two prose files the packaging gate requires.
Task 5 writes their real content:

```bash
cp LICENSE packages/explorer/LICENSE
printf '# @prnt/dagr-explorer\n' > packages/explorer/README.md
printf '# @prnt/dagr-explorer\n\n## Unreleased\n' > packages/explorer/CHANGELOG.md
```

Install, which adds the package to the lockfile:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` gains a `packages/explorer` importer. No registry
download is needed: every dependency is already in the lockfile for a sibling.

- [ ] **Step 3: Write the failing tests**

Create `packages/explorer/test/size.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_SIZE, resolveNodeSize } from '../src/index.js';
import type { ExplorerNode } from '../src/index.js';

const node: ExplorerNode = { id: 'a', label: 'A' };

describe('resolveNodeSize', () => {
  it('falls back to 240 by 120', () => {
    expect(DEFAULT_NODE_SIZE).toEqual({ width: 240, height: 120 });
    expect(resolveNodeSize(undefined, node)).toEqual({ width: 240, height: 120 });
    expect(resolveNodeSize({}, node)).toEqual({ width: 240, height: 120 });
  });

  it('takes a size the view gives for every node', () => {
    expect(resolveNodeSize({ nodeSize: { width: 100, height: 50 } }, node)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('calls a view function with the node', () => {
    const size = resolveNodeSize(
      { nodeSize: (n: ExplorerNode) => ({ width: n.id.length * 10, height: 30 }) },
      { id: 'abcd', label: 'ABCD' },
    );
    expect(size).toEqual({ width: 40, height: 30 });
  });

  it("lets the node's own size win over the view's", () => {
    const sized: ExplorerNode = { id: 'a', label: 'A', size: { width: 7, height: 9 } };
    expect(resolveNodeSize({ nodeSize: { width: 100, height: 50 } }, sized)).toEqual({
      width: 7,
      height: 9,
    });
  });

  it('falls back when a view function returns nothing', () => {
    // A JavaScript caller, or a function with a missing branch.
    const broken = (() => undefined) as unknown as (n: ExplorerNode) => { width: number; height: number };
    expect(resolveNodeSize({ nodeSize: broken }, node)).toEqual({ width: 240, height: 120 });
  });
});
```

Create `packages/explorer/test/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExplorerDataError, validateView, validateViews } from '../src/index.js';
import type { ExplorerView } from '../src/index.js';

const view = (over: Partial<ExplorerView> = {}): ExplorerView => ({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b' }],
  ...over,
});

/** The code of the `ExplorerDataError` a call throws, or `'no error'`. */
function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ExplorerDataError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('validateView', () => {
  it('accepts a well-formed view', () => {
    expect(codeOf(() => validateView(view()))).toBe('no error');
  });

  it('accepts an empty view', () => {
    expect(codeOf(() => validateView(view({ nodes: [], edges: [] })))).toBe('no error');
  });

  it('accepts a self loop and parallel edges', () => {
    const edges = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'ab2', source: 'a', target: 'b' },
      { id: 'aa', source: 'a', target: 'a' },
    ];
    expect(codeOf(() => validateView(view({ edges })))).toBe('no error');
  });

  it('rejects two nodes with one id, and names it', () => {
    const nodes = [
      { id: 'a', label: 'A' },
      { id: 'a', label: 'Again' },
    ];
    expect(codeOf(() => validateView(view({ nodes, edges: [] })))).toBe('DUPLICATE_NODE_ID');
    expect(() => validateView(view({ nodes, edges: [] }))).toThrow(/"a".*view "v"/);
  });

  it('rejects two edges with one id', () => {
    const edges = [
      { id: 'e', source: 'a', target: 'b' },
      { id: 'e', source: 'b', target: 'a' },
    ];
    expect(codeOf(() => validateView(view({ edges })))).toBe('DUPLICATE_EDGE_ID');
  });

  it('rejects an edge whose endpoint is not in the view, and names both', () => {
    const edges = [{ id: 'ax', source: 'a', target: 'x' }];
    expect(codeOf(() => validateView(view({ edges })))).toBe('MISSING_EDGE_ENDPOINT');
    expect(() => validateView(view({ edges }))).toThrow(/"ax".*"x"/);
  });

  it('rejects two groups with one id', () => {
    const groups = [
      { id: 'g', label: 'One', nodeIds: ['a'] },
      { id: 'g', label: 'Two', nodeIds: ['b'] },
    ];
    expect(codeOf(() => validateView(view({ groups })))).toBe('DUPLICATE_GROUP_ID');
  });

  it('rejects a group with no members', () => {
    const groups = [{ id: 'g', label: 'Empty', nodeIds: [] }];
    expect(codeOf(() => validateView(view({ groups })))).toBe('EMPTY_GROUP');
  });

  it('rejects a group naming a node the view lacks, and names both', () => {
    const groups = [{ id: 'g', label: 'G', nodeIds: ['a', 'x'] }];
    expect(codeOf(() => validateView(view({ groups })))).toBe('MISSING_GROUP_MEMBER');
    expect(() => validateView(view({ groups }))).toThrow(/"g".*"x"/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a node whose own width is %s, and names the node',
    (width) => {
      const nodes = [{ id: 'a', label: 'A', size: { width, height: 10 } }];
      expect(codeOf(() => validateView(view({ nodes, edges: [] })))).toBe('INVALID_NODE_SIZE');
      expect(() => validateView(view({ nodes, edges: [] }))).toThrow(/"a"/);
    },
  );

  it('rejects a bad size from the view value and from the view function', () => {
    const value = view({ layout: { nodeSize: { width: 100, height: 0 } } });
    expect(codeOf(() => validateView(value))).toBe('INVALID_NODE_SIZE');
    const fn = view({ layout: { nodeSize: () => ({ width: Number.NaN, height: 10 }) } });
    expect(codeOf(() => validateView(fn))).toBe('INVALID_NODE_SIZE');
  });

  it('carries the offender and its view as fields, not only in the message', () => {
    const caught = (run: () => void): ExplorerDataError => {
      try {
        run();
      } catch (error) {
        if (error instanceof ExplorerDataError) return error;
        throw error;
      }
      throw new Error('did not throw');
    };

    const node = caught(() =>
      validateView(view({ nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }], edges: [] })),
    );
    expect([node.code, node.id, node.viewId]).toEqual(['DUPLICATE_NODE_ID', 'a', 'v']);

    // For an edge error the subject is the EDGE. The missing node is in the message.
    const edge = caught(() => validateView(view({ edges: [{ id: 'ax', source: 'a', target: 'x' }] })));
    expect([edge.code, edge.id, edge.viewId]).toEqual(['MISSING_EDGE_ENDPOINT', 'ax', 'v']);

    const group = caught(() =>
      validateView(view({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'x'] }] })),
    );
    expect([group.code, group.id, group.viewId]).toEqual(['MISSING_GROUP_MEMBER', 'g', 'v']);

    const size = caught(() =>
      validateView(view({ nodes: [{ id: 'a', label: 'A', size: { width: 0, height: 1 } }], edges: [] })),
    );
    expect([size.code, size.id, size.viewId]).toEqual(['INVALID_NODE_SIZE', 'a', 'v']);

    // A view error is about the view itself, so there is no enclosing view.
    const dup = caught(() => validateViews([view(), view()]));
    expect([dup.code, dup.id, dup.viewId]).toEqual(['DUPLICATE_VIEW_ID', 'v', undefined]);
  });

  it('throws a real Error subclass with a name', () => {
    try {
      validateView(view({ groups: [{ id: 'g', label: 'G', nodeIds: [] }] }));
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExplorerDataError);
      expect((error as ExplorerDataError).name).toBe('ExplorerDataError');
    }
  });
});

describe('validateViews', () => {
  it('rejects two views with one id', () => {
    expect(codeOf(() => validateViews([view(), view()]))).toBe('DUPLICATE_VIEW_ID');
  });

  it('lets two views reuse node and edge ids', () => {
    expect(codeOf(() => validateViews([view(), view({ id: 'w' })]))).toBe('no error');
  });

  it('validates every view, not only the first', () => {
    const bad = view({ id: 'w', edges: [{ id: 'ax', source: 'a', target: 'x' }] });
    expect(codeOf(() => validateViews([view(), bad]))).toBe('MISSING_EDGE_ENDPOINT');
  });

  it('accepts no views at all', () => {
    expect(codeOf(() => validateViews([]))).toBe('no error');
  });
});
```

Create `packages/explorer/test/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * What the package exports at runtime, pinned as a list. A surface test: it
 * catches a name added or dropped without anybody deciding to. Types are
 * erased, so the other test files exercise those by importing them.
 */
describe('@prnt/dagr-explorer', () => {
  it('exports exactly this runtime surface', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'DEFAULT_NODE_SIZE',
        'ExplorerDataError',
        'resolveNodeSize',
        'validateView',
        'validateViews',
      ].sort(),
    );
  });
});
```

- [ ] **Step 4: Run the tests and watch them fail**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: FAIL. All three files report that `../src/index.js` cannot be
resolved.

- [ ] **Step 5: Write the modules**

Create `packages/explorer/src/types.ts`:

```ts
import type { ReactNode } from 'react';
import type { Size } from '@prnt/dagr-render/core';

export type { Size };

/**
 * One node. `id` and `label` are all the explorer itself reads: the label is
 * the accessible name, the search result text, and the default content.
 * Everything else about a node is the caller's own fields on a type that
 * extends this one, and every slot receives that type.
 *
 * Optional fields are spelled `T | undefined` so a caller compiling with
 * `exactOptionalPropertyTypes` can pass a value it computed, including
 * `undefined`, without a conditional spread.
 */
export interface ExplorerNode {
  readonly id: string;
  readonly label: string;
  /** World size in CSS pixels at zoom 1. Declared, never measured. */
  readonly size?: Size | undefined;
  /** Any CSS color. */
  readonly color?: string | undefined;
}

export interface ExplorerEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string | undefined;
  /** Any CSS color. */
  readonly color?: string | undefined;
  /** Draw the edge dashed. */
  readonly dash?: boolean | undefined;
}

/** A labeled outline around its members. An annotation: it moves no node. */
export interface ExplorerGroup {
  readonly id: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  /** Any CSS color. */
  readonly color?: string | undefined;
}

export interface ExplorerLayoutOptions<N extends ExplorerNode = ExplorerNode> {
  /** Which way edges flow. Default `'right'`. */
  readonly direction?: 'right' | 'down' | undefined;
  /** Size for nodes with no `size` of their own. Default 240 by 120. */
  readonly nodeSize?: Size | ((node: N) => Size) | undefined;
  /** Gap between neighbors across the flow. Default 40. */
  readonly nodeSep?: number | undefined;
  /** Gap between ranks along the flow. Default 120. */
  readonly rankSep?: number | undefined;
  /** Default `'smooth'`. */
  readonly edgeStyle?: 'smooth' | 'orthogonal' | undefined;
}

export interface ExplorerView<
  N extends ExplorerNode = ExplorerNode,
  E extends ExplorerEdge = ExplorerEdge,
> {
  readonly id: string;
  readonly label: string;
  readonly description?: ReactNode | undefined;
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
  readonly groups?: readonly ExplorerGroup[] | undefined;
  readonly layout?: ExplorerLayoutOptions<N> | undefined;
}
```

Create `packages/explorer/src/errors.ts`:

```ts
/**
 * Errors thrown by `@prnt/dagr-explorer` for data it cannot draw honestly.
 *
 * One class with a `code`, because a caller switches on the code and never on
 * the class: the failures are all "this view is malformed", and they differ
 * only in how. Codes are UPPER_SNAKE and the type is named for the package, as
 * in every sibling.
 *
 * **The offender is a field, not only a phrase in the message.** A host that
 * wants to highlight the bad node, or list the errors of one view, reads `id`
 * and `viewId` and never parses prose. What `id` names depends on the code:
 *
 * - `DUPLICATE_VIEW_ID`: the view. `viewId` is `undefined`.
 * - `DUPLICATE_NODE_ID`, `INVALID_NODE_SIZE`: the node.
 * - `DUPLICATE_EDGE_ID`, `MISSING_EDGE_ENDPOINT`: the edge.
 * - `DUPLICATE_GROUP_ID`, `EMPTY_GROUP`, `MISSING_GROUP_MEMBER`,
 *   `GROUP_ENCLOSES_NON_MEMBER`: the group.
 *
 * The message still names every id involved, including the second one a
 * missing endpoint or an enclosed node adds, so a log line is enough to fix it.
 *
 * The prototype is restored explicitly, as every sibling package does, so
 * `instanceof` stays correct when the output is downlevelled below ES2022.
 */

/** The `code` of every data error this package throws. */
export type DagrExplorerErrorCode =
  | 'DUPLICATE_VIEW_ID'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'DUPLICATE_GROUP_ID'
  | 'INVALID_NODE_SIZE'
  | 'MISSING_EDGE_ENDPOINT'
  | 'MISSING_GROUP_MEMBER'
  | 'EMPTY_GROUP'
  | 'GROUP_ENCLOSES_NON_MEMBER';

export class ExplorerDataError extends Error {
  readonly code: DagrExplorerErrorCode;

  /** The view, node, edge or group the error is about. See the table above. */
  readonly id: string;

  /** The view it was found in. `undefined` when the error is about a view. */
  readonly viewId: string | undefined;

  constructor(code: DagrExplorerErrorCode, message: string, id: string, viewId?: string) {
    super(message);
    this.name = 'ExplorerDataError';
    this.code = code;
    this.id = id;
    this.viewId = viewId;
    Object.setPrototypeOf(this, ExplorerDataError.prototype);
  }
}
```

Create `packages/explorer/src/size.ts`:

```ts
import type { ExplorerLayoutOptions, ExplorerNode, Size } from './types.js';

/** The size of a node that declares none, in world pixels. */
export const DEFAULT_NODE_SIZE: Size = Object.freeze({ width: 240, height: 120 });

/**
 * A node's size: its own `size`, else the view's `nodeSize`, else the default.
 *
 * Sizes are declared and never measured, because a virtualized node has no
 * element to measure. This is the one place that order is written down, so
 * validation, layout and the shape key cannot disagree about it.
 */
export function resolveNodeSize<N extends ExplorerNode>(
  layout: ExplorerLayoutOptions<N> | undefined,
  node: N,
): Size {
  if (node.size !== undefined) return node.size;
  const configured = layout?.nodeSize;
  if (configured === undefined) return DEFAULT_NODE_SIZE;
  // The `??` is for a function that returns nothing: a JavaScript caller, or a
  // branch the type checker was told not to look at.
  return (typeof configured === 'function' ? configured(node) : configured) ?? DEFAULT_NODE_SIZE;
}
```

Create `packages/explorer/src/validate.ts`:

```ts
import { ExplorerDataError } from './errors.js';
import { resolveNodeSize } from './size.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from './types.js';

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Throws {@link ExplorerDataError} for a view that cannot be drawn honestly.
 *
 * Sizes are checked here rather than left to the layout engine, which accepts
 * a zero-size node and reports `NaN` as a fault in its own config. Neither
 * tells the caller which node to fix.
 *
 * A self loop and parallel edges are valid data. What happens to them is
 * `layout.ts`'s business.
 */
export function validateView<N extends ExplorerNode, E extends ExplorerEdge>(
  view: ExplorerView<N, E>,
): void {
  const where = `view "${view.id}"`;

  const nodeIds = new Set<string>();
  for (const node of view.nodes) {
    if (nodeIds.has(node.id)) {
      throw new ExplorerDataError(
        'DUPLICATE_NODE_ID',
        `Duplicate node id "${node.id}" in ${where}`,
        node.id,
        view.id,
      );
    }
    nodeIds.add(node.id);
    const size = resolveNodeSize(view.layout, node);
    if (!positive(size.width) || !positive(size.height)) {
      throw new ExplorerDataError(
        'INVALID_NODE_SIZE',
        `Node "${node.id}" in ${where} has size ${String(size.width)} by ${String(size.height)}. Width and height must be finite and greater than zero`,
        node.id,
        view.id,
      );
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of view.edges) {
    if (edgeIds.has(edge.id)) {
      throw new ExplorerDataError(
        'DUPLICATE_EDGE_ID',
        `Duplicate edge id "${edge.id}" in ${where}`,
        edge.id,
        view.id,
      );
    }
    edgeIds.add(edge.id);
    for (const end of [edge.source, edge.target]) {
      if (!nodeIds.has(end)) {
        throw new ExplorerDataError(
          'MISSING_EDGE_ENDPOINT',
          `Edge "${edge.id}" in ${where} names missing node "${end}"`,
          edge.id,
          view.id,
        );
      }
    }
  }

  const groupIds = new Set<string>();
  for (const group of view.groups ?? []) {
    if (groupIds.has(group.id)) {
      throw new ExplorerDataError(
        'DUPLICATE_GROUP_ID',
        `Duplicate group id "${group.id}" in ${where}`,
        group.id,
        view.id,
      );
    }
    groupIds.add(group.id);
    if (group.nodeIds.length === 0) {
      throw new ExplorerDataError(
        'EMPTY_GROUP',
        `Group "${group.id}" in ${where} has no nodes`,
        group.id,
        view.id,
      );
    }
    for (const id of group.nodeIds) {
      if (!nodeIds.has(id)) {
        throw new ExplorerDataError(
          'MISSING_GROUP_MEMBER',
          `Group "${group.id}" in ${where} names missing node "${id}"`,
          group.id,
          view.id,
        );
      }
    }
  }
}

/** Validates every view, and that no two share an id. Ids may repeat across views. */
export function validateViews<N extends ExplorerNode, E extends ExplorerEdge>(
  views: readonly ExplorerView<N, E>[],
): void {
  const viewIds = new Set<string>();
  for (const view of views) {
    if (viewIds.has(view.id)) {
      throw new ExplorerDataError('DUPLICATE_VIEW_ID', `Duplicate view id "${view.id}"`, view.id);
    }
    viewIds.add(view.id);
    validateView(view);
  }
}
```

Create `packages/explorer/src/index.ts`:

```ts
/**
 * `@prnt/dagr-explorer`: an interactive graph explorer.
 *
 * As of M5.6b this entry is the headless core only: the data model, its
 * validation, layout into world coordinates, and search. The React parts
 * arrive in M5.6c to M5.6e. Nothing exported here touches the DOM or imports
 * React at runtime.
 *
 * From `@prnt/dagr-render` this package imports only the `core` entry, which
 * never loads three.js. `test/imports.test.ts` holds that.
 */

export { ExplorerDataError } from './errors.js';
export type { DagrExplorerErrorCode } from './errors.js';
export { DEFAULT_NODE_SIZE, resolveNodeSize } from './size.js';
export { validateView, validateViews } from './validate.js';
export type {
  ExplorerEdge,
  ExplorerGroup,
  ExplorerLayoutOptions,
  ExplorerNode,
  ExplorerView,
  Size,
} from './types.js';
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: PASS, 3 files.

Run: `pnpm --filter @prnt/dagr-explorer typecheck`

Expected: exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add packages/explorer pnpm-lock.yaml
git commit -F - <<'EOF'
feat(explorer): scaffold the package with its data model and validation

A view that cannot be drawn honestly is rejected with a typed error
that names the offending id: duplicate ids, an edge or group naming a
node the view lacks, an empty group, and a node whose size is not
finite and greater than zero.

Sizes are checked here because the layout engine accepts a zero-size
node and reports NaN as a fault in its own config, and neither tells
the caller which node to fix.

The package is private until M5.6f and has no React code yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Layout into world coordinates

**Files:**
- Create: `packages/explorer/src/layout.ts`
- Modify: `packages/explorer/src/index.ts`
- Modify: `packages/explorer/test/index.test.ts`
- Test: `packages/explorer/test/layout.test.ts`

**Interfaces:**
- Consumes:
  - `validateView`, `resolveNodeSize`, `ExplorerDataError` from Task 1.
  - `new Graph()`, `graph.addNode({ id })`,
    `graph.addEdge({ id, source, target })` from `@prnt/dagr-graph`.
  - `layout({ graph, config })` from `@prnt/dagr-layout`. It lays out top-down
    in y-down coordinates. `result.nodes.get(id)` is `{ id, x, y, width, height }`
    with `x`, `y` the node's center. `result.edges.get(id).points` runs from the
    edge's own source to its own target, even when a cycle reversed it.
    `config.nodeSize` is `(node: { id: string }) => Size | undefined`.
  - `shapeEdgePath(points, { style, direction })` from `@prnt/dagr-render/core`.
    It returns sampled points, keeps both endpoints and every anchor exactly,
    and returns a straight two-point route unchanged.
- Produces:
  - `interface ExplorerBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }`
    (`x`, `y` are the top-left corner).
  - `interface ExplorerGroupBox extends ExplorerBox { readonly id: string }`
  - `interface ExplorerLayout { readonly boxes: ReadonlyMap<string, ExplorerBox>; readonly routes: ReadonlyMap<string, readonly Vec2[]>; readonly groups: readonly ExplorerGroupBox[]; readonly width: number; readonly height: number }`
  - `interface LayoutViewOptions { readonly strictGroups?: boolean | undefined }`
  - `layoutView<N, E>(view: ExplorerView<N, E>, options?: LayoutViewOptions): ExplorerLayout`
  - Public constants `DEFAULT_NODE_SEP` (40) and `DEFAULT_RANK_SEP` (120).
  - Internal to the package, exported from `src/layout.ts` and NOT from the
    entry: `layoutKey<N, E>(view: ExplorerView<N, E>): string`, and the fixed
    spacing constants `WORLD_PADDING` (40), `GROUP_PADDING` (24),
    `GROUP_LABEL_BAND` (24), `PARALLEL_EDGE_GAP` (16). M5.6d's root imports
    `layoutKey` from `./layout.js`.
  - The type `Vec2` re-exported from the entry.

- [ ] **Step 1: Write the failing tests**

Every number below was measured against `@prnt/dagr-layout` on 2026-10-03, not
derived by hand. If one is off by more than rounding, the layout engine
changed: stop and report it, do not edit the number to match.

Create `packages/explorer/test/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExplorerDataError, layoutView } from '../src/index.js';
// `layoutKey` is internal: the package entry does not export it.
import { layoutKey } from '../src/layout.js';
import type {
  ExplorerBox,
  ExplorerEdge,
  ExplorerLayout,
  ExplorerNode,
  ExplorerView,
  Vec2,
} from '../src/index.js';

const n = (id: string, extra: Partial<ExplorerNode> = {}): ExplorerNode => ({
  id,
  label: id.toUpperCase(),
  ...extra,
});
const e = (id: string, source: string, target: string): ExplorerEdge => ({ id, source, target });

/** a -> b -> c, default sizes, default direction. */
const chain = (over: Partial<ExplorerView> = {}): ExplorerView => ({
  id: 'v',
  label: 'View',
  nodes: [n('a'), n('b'), n('c')],
  edges: [e('ab', 'a', 'b'), e('bc', 'b', 'c')],
  ...over,
});

/** a and b only, with whatever edges the test wants between them. */
const pair = (edges: ExplorerEdge[], over: Partial<ExplorerView> = {}): ExplorerView => ({
  id: 'v',
  label: 'View',
  nodes: [n('a'), n('b')],
  edges,
  ...over,
});

function box(layout: ExplorerLayout, id: string): ExplorerBox {
  const found = layout.boxes.get(id);
  if (found === undefined) throw new Error(`no box for ${id}`);
  return found;
}

function route(layout: ExplorerLayout, id: string): readonly Vec2[] {
  const found = layout.routes.get(id);
  if (found === undefined) throw new Error(`no route for ${id}`);
  return found;
}

function ends(points: readonly Vec2[]): [Vec2, Vec2] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) throw new Error('empty route');
  return [first, last];
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ExplorerDataError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('layoutView, flowing right (the default)', () => {
  it('lays a chain out left to right, padded 40 off the origin', () => {
    const layout = layoutView(chain());
    expect(box(layout, 'a')).toEqual({ x: 40, y: 40, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 400, y: 40, width: 240, height: 120 });
    expect(box(layout, 'c')).toEqual({ x: 760, y: 40, width: 240, height: 120 });
    expect(layout.width).toBe(1040);
    expect(layout.height).toBe(200);
  });

  it('routes each edge from the source box edge to the target box edge', () => {
    const layout = layoutView(chain());
    expect(route(layout, 'ab')).toEqual([
      { x: 280, y: 100 },
      { x: 400, y: 100 },
    ]);
    expect(route(layout, 'bc')).toEqual([
      { x: 640, y: 100 },
      { x: 760, y: 100 },
    ]);
  });

  it('keeps boxes and routes in the order the data gave them', () => {
    const layout = layoutView(chain());
    expect([...layout.boxes.keys()]).toEqual(['a', 'b', 'c']);
    expect([...layout.routes.keys()]).toEqual(['ab', 'bc']);
  });

  it("honors a node's own size", () => {
    const layout = layoutView(
      pair([e('ab', 'a', 'b')], { nodes: [n('a', { size: { width: 400, height: 100 } }), n('b')] }),
    );
    expect(box(layout, 'a')).toEqual({ x: 40, y: 50, width: 400, height: 100 });
    expect(box(layout, 'b')).toEqual({ x: 560, y: 40, width: 240, height: 120 });
    expect(layout.width).toBe(840);
    expect(layout.height).toBe(200);
  });

  it("honors the view's nodeSize", () => {
    const layout = layoutView({
      id: 'v',
      label: 'View',
      nodes: [n('only')],
      edges: [],
      layout: { nodeSize: { width: 100, height: 50 } },
    });
    expect(box(layout, 'only')).toEqual({ x: 40, y: 40, width: 100, height: 50 });
    expect(layout.width).toBe(180);
    expect(layout.height).toBe(130);
  });

  it('spreads a fan across the flow', () => {
    const layout = layoutView(chain({ edges: [e('ab', 'a', 'b'), e('ac', 'a', 'c')] }));
    expect(box(layout, 'a')).toEqual({ x: 40, y: 120, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 400, y: 40, width: 240, height: 120 });
    expect(box(layout, 'c')).toEqual({ x: 400, y: 200, width: 240, height: 120 });
    expect(layout.width).toBe(680);
    expect(layout.height).toBe(360);
    const [start, end] = ends(route(layout, 'ab'));
    expect(start.x).toBe(280);
    expect(start.y).toBeCloseTo(153.33, 1);
    expect(end.x).toBe(400);
    expect(end.y).toBeCloseTo(126.67, 1);
  });
});

describe('layoutView, flowing down', () => {
  it('lays a chain out top to bottom', () => {
    const layout = layoutView(chain({ layout: { direction: 'down' } }));
    expect(box(layout, 'a')).toEqual({ x: 40, y: 40, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 40, y: 280, width: 240, height: 120 });
    expect(box(layout, 'c')).toEqual({ x: 40, y: 520, width: 240, height: 120 });
    expect(layout.width).toBe(320);
    expect(layout.height).toBe(680);
    expect(route(layout, 'ab')).toEqual([
      { x: 160, y: 160 },
      { x: 160, y: 280 },
    ]);
  });
});

describe('layoutView, parallel edges', () => {
  it('bows two edges between one pair apart, 16 between them, ends unmoved', () => {
    const layout = layoutView(pair([e('ab', 'a', 'b'), e('ab2', 'a', 'b')]));
    for (const id of ['ab', 'ab2']) {
      const [start, end] = ends(route(layout, id));
      expect(start).toEqual({ x: 280, y: 100 });
      expect(end).toEqual({ x: 400, y: 100 });
    }
    expect(route(layout, 'ab')).toContainEqual({ x: 340, y: 92 });
    expect(route(layout, 'ab2')).toContainEqual({ x: 340, y: 108 });
  });

  it('separates a cycle: two edges one way and one back', () => {
    const layout = layoutView(pair([e('ab', 'a', 'b'), e('ab2', 'a', 'b'), e('ba', 'b', 'a')]));
    expect(route(layout, 'ab')).toContainEqual({ x: 340, y: 84 });
    // The middle of three keeps the routed line.
    expect(route(layout, 'ab2')).toEqual([
      { x: 280, y: 100 },
      { x: 400, y: 100 },
    ]);
    // The reversed edge still runs from its own source, b, to its own target.
    const [start, end] = ends(route(layout, 'ba'));
    expect(start).toEqual({ x: 400, y: 100 });
    expect(end).toEqual({ x: 280, y: 100 });
    expect(route(layout, 'ba')).toContainEqual({ x: 340, y: 116 });
  });

  it('bows across the flow when flowing down', () => {
    const layout = layoutView(
      pair([e('ab', 'a', 'b'), e('ab2', 'a', 'b')], { layout: { direction: 'down' } }),
    );
    expect(route(layout, 'ab')).toContainEqual({ x: 152, y: 220 });
    expect(route(layout, 'ab2')).toContainEqual({ x: 168, y: 220 });
    for (const id of ['ab', 'ab2']) {
      const [start, end] = ends(route(layout, id));
      expect(start).toEqual({ x: 160, y: 160 });
      expect(end).toEqual({ x: 160, y: 280 });
    }
  });

  it('does not mistake ids containing a comma for one pair', () => {
    // Joined with a comma, 'a,b' + 'c' and 'a' + 'b,c' are the same string.
    // These two edges share no node, so neither may be bowed.
    const layout = layoutView({
      id: 'v',
      label: 'View',
      nodes: [n('a,b'), n('c'), n('a'), n('b,c')],
      edges: [e('e1', 'a,b', 'c'), e('e2', 'a', 'b,c')],
    });
    expect(route(layout, 'e1')).toHaveLength(2);
    expect(route(layout, 'e2')).toHaveLength(2);
  });
});

describe('layoutView, self loops', () => {
  it('keeps a self loop in the routes, empty, and lets it move nothing', () => {
    const plain = layoutView(pair([e('ab', 'a', 'b')]));
    const looped = layoutView(pair([e('ab', 'a', 'b'), e('aa', 'a', 'a')]));
    expect(route(looped, 'aa')).toEqual([]);
    expect([...looped.boxes]).toEqual([...plain.boxes]);
    expect(route(looped, 'ab')).toEqual(route(plain, 'ab'));
    expect(looped.width).toBe(plain.width);
    expect(looped.height).toBe(plain.height);
  });
});

describe('layoutView, groups', () => {
  it('outlines its members with 24 of padding and a 24 label band above', () => {
    const layout = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['b'] }] }));
    expect(layout.groups).toEqual([{ id: 'g', x: 376, y: 40, width: 288, height: 192 }]);
    expect(box(layout, 'a')).toEqual({ x: 40, y: 88, width: 240, height: 120 });
    expect(box(layout, 'b')).toEqual({ x: 400, y: 88, width: 240, height: 120 });
    expect(layout.width).toBe(1040);
    expect(layout.height).toBe(272);
  });

  it('draws an outline that encloses a non-member unless strict', () => {
    const layout = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'c'] }] }));
    expect(layout.groups).toEqual([{ id: 'g', x: 40, y: 40, width: 1008, height: 192 }]);
    expect(box(layout, 'a')).toEqual({ x: 64, y: 88, width: 240, height: 120 });
    expect(layout.width).toBe(1088);
    expect(layout.height).toBe(272);
  });

  it('throws under strictGroups when an outline would enclose a non-member', () => {
    const view = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'c'] }] });
    expect(codeOf(() => layoutView(view, { strictGroups: true }))).toBe('GROUP_ENCLOSES_NON_MEMBER');
    expect(() => layoutView(view, { strictGroups: true })).toThrow(/"g".*"b"/);
    try {
      layoutView(view, { strictGroups: true });
    } catch (error) {
      // The subject is the group. The enclosed node is in the message.
      expect(error).toBeInstanceOf(ExplorerDataError);
      expect((error as ExplorerDataError).id).toBe('g');
      expect((error as ExplorerDataError).viewId).toBe('v');
    }
  });

  it('passes strictGroups when the outline is clear', () => {
    const view = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a'] }] });
    expect(codeOf(() => layoutView(view, { strictGroups: true }))).toBe('no error');
  });

  it('treats a member listed twice as listed once', () => {
    const once = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['b'] }] }));
    const twice = layoutView(chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['b', 'b'] }] }));
    expect(twice.groups).toEqual(once.groups);
  });
});

describe('layoutView, edges of the input', () => {
  it('gives an empty view an empty, zero-size layout', () => {
    const layout = layoutView({ id: 'v', label: 'View', nodes: [], edges: [] });
    expect(layout.boxes.size).toBe(0);
    expect(layout.routes.size).toBe(0);
    expect(layout.groups).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it('lays out a single node with no edges', () => {
    const layout = layoutView({ id: 'v', label: 'View', nodes: [n('only')], edges: [] });
    expect(box(layout, 'only')).toEqual({ x: 40, y: 40, width: 240, height: 120 });
    expect(layout.width).toBe(320);
    expect(layout.height).toBe(200);
  });

  it('validates before it lays out', () => {
    const view = chain({ edges: [e('ax', 'a', 'x')] });
    expect(codeOf(() => layoutView(view))).toBe('MISSING_EDGE_ENDPOINT');
  });

  it('draws orthogonal edges as axis-aligned segments', () => {
    const layout = layoutView(
      chain({ edges: [e('ab', 'a', 'b'), e('ac', 'a', 'c')], layout: { edgeStyle: 'orthogonal' } }),
    );
    const points = route(layout, 'ab');
    expect(points.length).toBeGreaterThan(2);
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      if (from === undefined || to === undefined) throw new Error('hole in route');
      expect(from.x === to.x || from.y === to.y).toBe(true);
    }
  });
});

describe('layoutKey', () => {
  it('is equal for data re-created with the same shape', () => {
    expect(layoutKey(chain())).toBe(layoutKey(chain()));
  });

  it('ignores labels, colors and descriptions', () => {
    const relabeled = chain({
      label: 'Renamed',
      description: 'Now with words',
      nodes: [n('a', { label: 'Alpha', color: 'red' }), n('b'), n('c')],
      edges: [{ ...e('ab', 'a', 'b'), label: 'calls', color: 'blue', dash: true }, e('bc', 'b', 'c')],
    });
    expect(layoutKey(relabeled)).toBe(layoutKey(chain()));
  });

  it('changes with anything that moves the layout', () => {
    const base = layoutKey(chain());
    const changed = [
      chain({ nodes: [n('a', { size: { width: 10, height: 10 } }), n('b'), n('c')] }),
      chain({ edges: [e('ab', 'a', 'b'), e('bc', 'c', 'b')] }),
      chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a'] }] }),
      chain({ layout: { direction: 'down' } }),
      chain({ layout: { nodeSep: 41 } }),
      chain({ layout: { rankSep: 121 } }),
      chain({ layout: { edgeStyle: 'orthogonal' } }),
      chain({ layout: { nodeSize: { width: 100, height: 50 } } }),
    ];
    for (const view of changed) expect(layoutKey(view)).not.toBe(base);
  });

  it('changes when only group membership changes', () => {
    const one = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a'] }] });
    const two = chain({ groups: [{ id: 'g', label: 'G', nodeIds: ['a', 'b'] }] });
    expect(layoutKey(one)).not.toBe(layoutKey(two));
  });

  it('does not collide for ids containing a comma', () => {
    const left = chain({ nodes: [n('a,b'), n('c')], edges: [] });
    const right = chain({ nodes: [n('a'), n('b,c')], edges: [] });
    expect(layoutKey(left)).not.toBe(layoutKey(right));
  });
});
```

In `packages/explorer/test/index.test.ts`, replace the array inside
`toEqual(...)` with:

```ts
      [
        'DEFAULT_NODE_SEP',
        'DEFAULT_NODE_SIZE',
        'DEFAULT_RANK_SEP',
        'ExplorerDataError',
        'layoutView',
        'resolveNodeSize',
        'validateView',
        'validateViews',
      ].sort(),
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: FAIL. `layout.test.ts` fails because `../src/layout.js` does not
exist, and `index.test.ts` fails on the missing names.

- [ ] **Step 3: Write the module**

Create `packages/explorer/src/layout.ts`:

```ts
import { Graph } from '@prnt/dagr-graph';
import { layout } from '@prnt/dagr-layout';
import { shapeEdgePath } from '@prnt/dagr-render/core';
import type { Vec2 } from '@prnt/dagr-render/core';

import { ExplorerDataError } from './errors.js';
import { resolveNodeSize } from './size.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView, Size } from './types.js';
import { validateView } from './validate.js';

/** Gap between neighbors across the flow, when the view does not say. */
export const DEFAULT_NODE_SEP = 40;
/** Gap between ranks along the flow, when the view does not say. */
export const DEFAULT_RANK_SEP = 120;
// The four constants below are exported for this package's tests and are NOT
// re-exported from the entry. They are fixed values today. Publishing them
// would make a change to any one a silent behavior break for whoever read it.

/** How far the content sits from the world origin, and from the far edges. */
export const WORLD_PADDING = 40;
/** Space between a group's outline and its members. `NodeGroup`'s default. */
export const GROUP_PADDING = 24;
/** Extra space above a group's members, for its label. */
export const GROUP_LABEL_BAND = 24;
/** Distance between neighboring edges that join the same pair of nodes. */
export const PARALLEL_EDGE_GAP = 16;

/** An axis-aligned rectangle in world space. `x`, `y` is its top-left corner. */
export interface ExplorerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ExplorerGroupBox extends ExplorerBox {
  readonly id: string;
}

/**
 * A view, placed. World space is y-down CSS pixels at zoom 1, and the content
 * is padded {@link WORLD_PADDING} off the origin, so `width` and `height`
 * describe a plane that starts at (0, 0).
 */
export interface ExplorerLayout {
  /** One box per node, in the order the view lists its nodes. */
  readonly boxes: ReadonlyMap<string, ExplorerBox>;
  /**
   * One route per edge, in the order the view lists its edges, running from
   * the edge's source to its target. A self loop has an empty route.
   */
  readonly routes: ReadonlyMap<string, readonly Vec2[]>;
  readonly groups: readonly ExplorerGroupBox[];
  readonly width: number;
  readonly height: number;
}

export interface LayoutViewOptions {
  /** Throw when a group's outline would enclose a node that is not a member. */
  readonly strictGroups?: boolean | undefined;
}

/**
 * The key two edges share when they join the same two nodes, whichever way
 * each one points. JSON rather than a joined string, because ids are the
 * caller's and may contain any separator: joined with a comma, 'a,b' with 'c'
 * and 'a' with 'b,c' are one pair.
 */
const pairKey = (a: string, b: string): string => JSON.stringify(a < b ? [a, b] : [b, a]);

/**
 * Moves a route's interior sideways, across the flow, leaving both ends where
 * they are. A two-point route has no interior, so it is given its midpoint.
 */
function bow(points: readonly Vec2[], offset: number, right: boolean): Vec2[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 2) return [...points];
  const interior =
    points.length > 2
      ? points.slice(1, -1)
      : [{ x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }];
  return [
    first,
    ...interior.map((p) => (right ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y })),
    last,
  ];
}

/**
 * Places a view: a box per node, a route per edge, a rectangle per group.
 *
 * `@prnt/dagr-layout` lays out top-down and has no direction option, so
 * flowing right is a transpose done here, once: sizes go in with width and
 * height swapped, and every coordinate comes out with x and y swapped.
 *
 * Three things the layout engine does not do are done here:
 *
 * - **Parallel edges.** The router draws every edge between one pair of nodes
 *   on the same line. Their interiors are moved apart, symmetrically about
 *   that line, so each can be seen. Both ends stay on their nodes.
 * - **Self loops.** The router gives an edge from a node to itself a
 *   zero-length line. Such an edge is left out of layout and has an empty
 *   route. It stays in the data, and drawing a loop is a later slice.
 * - **Groups.** A group is an annotation over the finished layout: the hull
 *   of its members, padded, with a band above for its label. It moves no node.
 *
 * @throws {ExplorerDataError} for a malformed view, and under `strictGroups`
 * when a group's outline would enclose a node that is not a member.
 */
export function layoutView<N extends ExplorerNode, E extends ExplorerEdge>(
  view: ExplorerView<N, E>,
  options: LayoutViewOptions = {},
): ExplorerLayout {
  validateView(view);
  const right = (view.layout?.direction ?? 'right') === 'right';

  const sizes = new Map<string, Size>();
  const graph = new Graph();
  for (const node of view.nodes) {
    sizes.set(node.id, resolveNodeSize(view.layout, node));
    graph.addNode({ id: node.id });
  }

  const siblings = new Map<string, string[]>();
  for (const edge of view.edges) {
    if (edge.source === edge.target) continue;
    graph.addEdge({ id: edge.id, source: edge.source, target: edge.target });
    const key = pairKey(edge.source, edge.target);
    const list = siblings.get(key);
    if (list === undefined) siblings.set(key, [edge.id]);
    else list.push(edge.id);
  }

  const sizeOf = (id: string): Size => {
    const size = sizes.get(id);
    if (size === undefined) throw new Error(`layoutView lost the size of node "${id}"`);
    return size;
  };

  const result = layout({
    graph,
    config: {
      nodeSep: view.layout?.nodeSep ?? DEFAULT_NODE_SEP,
      rankSep: view.layout?.rankSep ?? DEFAULT_RANK_SEP,
      nodeSize: (node) => {
        const size = sizeOf(node.id);
        return right ? { width: size.height, height: size.width } : size;
      },
    },
  });

  const toWorld = (p: Vec2): Vec2 => (right ? { x: p.y, y: p.x } : { x: p.x, y: p.y });

  const boxes = new Map<string, ExplorerBox>();
  for (const node of view.nodes) {
    const placed = result.nodes.get(node.id);
    if (placed === undefined) throw new Error(`layout returned no position for node "${node.id}"`);
    const size = sizeOf(node.id);
    const center = toWorld(placed);
    boxes.set(node.id, {
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
      width: size.width,
      height: size.height,
    });
  }

  const style = view.layout?.edgeStyle ?? 'smooth';
  const routes = new Map<string, Vec2[]>();
  for (const edge of view.edges) {
    if (edge.source === edge.target) {
      routes.set(edge.id, []);
      continue;
    }
    const routed = result.edges.get(edge.id);
    if (routed === undefined) throw new Error(`layout returned no route for edge "${edge.id}"`);
    let points = routed.points.map(toWorld);
    const group = siblings.get(pairKey(edge.source, edge.target)) ?? [edge.id];
    const offset = (group.indexOf(edge.id) - (group.length - 1) / 2) * PARALLEL_EDGE_GAP;
    if (offset !== 0) points = bow(points, offset, right);
    routes.set(
      edge.id,
      shapeEdgePath(points, { style, direction: right ? 'horizontal' : 'vertical' }),
    );
  }

  const groups: ExplorerGroupBox[] = (view.groups ?? []).map((group) => {
    const members = new Set(group.nodeIds);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of members) {
      const member = boxes.get(id);
      if (member === undefined) continue;
      minX = Math.min(minX, member.x);
      minY = Math.min(minY, member.y);
      maxX = Math.max(maxX, member.x + member.width);
      maxY = Math.max(maxY, member.y + member.height);
    }
    const rect: ExplorerGroupBox = {
      id: group.id,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING - GROUP_LABEL_BAND,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_BAND,
    };
    if (options.strictGroups === true) {
      for (const [id, other] of boxes) {
        if (members.has(id)) continue;
        const overlaps =
          other.x < rect.x + rect.width &&
          other.x + other.width > rect.x &&
          other.y < rect.y + rect.height &&
          other.y + other.height > rect.y;
        if (overlaps) {
          throw new ExplorerDataError(
            'GROUP_ENCLOSES_NON_MEMBER',
            `Group "${group.id}" in view "${view.id}" would enclose non-member node "${id}"`,
            group.id,
            view.id,
          );
        }
      }
    }
    return rect;
  });

  // Everything above is in the layout engine's frame, which is centered on
  // nothing in particular. Move it so the hull of every box, group and route
  // point starts WORLD_PADDING in from the origin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const b of boxes.values()) grow(b.x, b.y, b.x + b.width, b.y + b.height);
  for (const g of groups) grow(g.x, g.y, g.x + g.width, g.y + g.height);
  for (const points of routes.values()) for (const p of points) grow(p.x, p.y, p.x, p.y);

  if (minX === Infinity) {
    return { boxes: new Map(), routes: new Map(), groups: [], width: 0, height: 0 };
  }

  const dx = WORLD_PADDING - minX;
  const dy = WORLD_PADDING - minY;
  return {
    boxes: new Map([...boxes].map(([id, b]) => [id, { ...b, x: b.x + dx, y: b.y + dy }])),
    routes: new Map(
      [...routes].map(([id, points]) => [id, points.map((p) => ({ x: p.x + dx, y: p.y + dy }))]),
    ),
    groups: groups.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    width: maxX - minX + WORLD_PADDING * 2,
    height: maxY - minY + WORLD_PADDING * 2,
  };
}

/**
 * A string that is equal for two views exactly when they lay out the same.
 *
 * It holds what moves the layout and nothing else: direction, edge style and
 * spacing, each node's id and resolved size, each edge's id and endpoints,
 * each group's id and members. Labels, colors and descriptions are absent, so
 * changing one never relayouts, and data re-created on every render with the
 * same shape keeps its layout.
 *
 * JSON, for the reason `pairKey` gives: ids are the caller's.
 *
 * Internal: the root uses it to memoize, and the entry does not export it.
 */
export function layoutKey<N extends ExplorerNode, E extends ExplorerEdge>(
  view: ExplorerView<N, E>,
): string {
  return JSON.stringify([
    view.layout?.direction ?? 'right',
    view.layout?.edgeStyle ?? 'smooth',
    view.layout?.nodeSep ?? DEFAULT_NODE_SEP,
    view.layout?.rankSep ?? DEFAULT_RANK_SEP,
    view.nodes.map((node) => {
      const size = resolveNodeSize(view.layout, node);
      return [node.id, size.width, size.height];
    }),
    view.edges.map((edge) => [edge.id, edge.source, edge.target]),
    (view.groups ?? []).map((group) => [group.id, group.nodeIds]),
  ]);
}
```

In `packages/explorer/src/index.ts`, add these lines directly after the line
`export type { DagrExplorerErrorCode } from './errors.js';`:

```ts
// `layoutKey` and the fixed spacing constants stay internal on purpose. A
// public constant cannot change value, or become an option, without a break.
export { DEFAULT_NODE_SEP, DEFAULT_RANK_SEP, layoutView } from './layout.js';
export type {
  ExplorerBox,
  ExplorerGroupBox,
  ExplorerLayout,
  LayoutViewOptions,
} from './layout.js';
```

and add this line at the end of the file:

```ts
export type { Vec2 } from '@prnt/dagr-render/core';
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: PASS, 4 files.

Run: `pnpm --filter @prnt/dagr-explorer typecheck`

Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add packages/explorer
git commit -F - <<'EOF'
feat(explorer): lay a view out into world coordinates

layoutView places a box per node, a route per edge and a rectangle per
group, in y-down pixels padded 40 off the origin. Flowing right is a
transpose done once here, because the layout engine is top-down only.

Three things the engine does not do are done here. Parallel edges are
routed on one line, so their interiors are moved 16 apart with both
ends left on their nodes. A self loop gets a zero-length line, so it is
left out of layout with an empty route and moves nothing. A group is
the padded hull of its members and moves no node, and under
strictGroups it throws rather than enclose a non-member.

layoutKey is equal for two views exactly when they lay out the same,
so re-created data keeps its layout and a label change never relayouts.
Sibling and shape keys are JSON, because ids may contain any separator.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Search

**Files:**
- Create: `packages/explorer/src/search.ts`
- Modify: `packages/explorer/src/index.ts`
- Modify: `packages/explorer/test/index.test.ts`
- Test: `packages/explorer/test/search.test.ts`

**Interfaces:**
- Consumes: `ExplorerNode` from Task 1.
- Produces:
  - `defaultSearchText(node: ExplorerNode): string` (the id, a space, the label)
  - `searchNodes<N extends ExplorerNode>(nodes: readonly N[], query: string, searchText?: (node: N) => string): N[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/explorer/test/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultSearchText, searchNodes } from '../src/index.js';
import type { ExplorerNode } from '../src/index.js';

interface Service extends ExplorerNode {
  readonly team: string;
}

const nodes: Service[] = [
  { id: 'api', label: 'Public API', team: 'platform' },
  { id: 'auth', label: 'Auth service', team: 'identity' },
  { id: 'db', label: 'Orders (v2.*)', team: 'platform' },
];

const ids = (found: readonly ExplorerNode[]): string[] => found.map((node) => node.id);

describe('searchNodes', () => {
  it('matches the id and the label by default', () => {
    expect(defaultSearchText({ id: 'api', label: 'Public API' })).toBe('api Public API');
    expect(ids(searchNodes(nodes, 'auth'))).toEqual(['auth']);
    expect(ids(searchNodes(nodes, 'public'))).toEqual(['api']);
  });

  it('ignores case in the query and in the text', () => {
    expect(ids(searchNodes(nodes, 'PUBLIC api'))).toEqual(['api']);
  });

  it('requires every token, in any order', () => {
    expect(ids(searchNodes(nodes, 'service auth'))).toEqual(['auth']);
    expect(ids(searchNodes(nodes, 'auth orders'))).toEqual([]);
  });

  it('matches nothing for an empty or blank query', () => {
    expect(searchNodes(nodes, '')).toEqual([]);
    expect(searchNodes(nodes, '   \t\n')).toEqual([]);
  });

  it('tolerates extra whitespace around and between tokens', () => {
    expect(ids(searchNodes(nodes, '  auth    service  '))).toEqual(['auth']);
  });

  it('keeps the order of the data', () => {
    expect(ids(searchNodes(nodes, 'a'))).toEqual(['api', 'auth']);
  });

  it('searches what the accessor returns, with the node typed', () => {
    const byTeam = (node: Service): string => node.team;
    expect(ids(searchNodes(nodes, 'platform', byTeam))).toEqual(['api', 'db']);
    expect(ids(searchNodes(nodes, 'auth', byTeam))).toEqual([]);
  });

  it('treats regex metacharacters in the query as text', () => {
    expect(ids(searchNodes(nodes, '(v2.*)'))).toEqual(['db']);
    expect(ids(searchNodes(nodes, '.*'))).toEqual(['db']);
    expect(searchNodes(nodes, '[')).toEqual([]);
  });

  it('does not throw when the accessor returns something that is not a string', () => {
    const broken = (() => undefined) as unknown as (node: Service) => string;
    expect(searchNodes(nodes, 'api', broken)).toEqual([]);
    const numeric = (() => 42) as unknown as (node: Service) => string;
    expect(ids(searchNodes(nodes, '42', numeric))).toEqual(['api', 'auth', 'db']);
  });

  it('returns a new array and leaves the input alone', () => {
    const found = searchNodes(nodes, 'a');
    expect(found).not.toBe(nodes);
    expect(nodes).toHaveLength(3);
  });
});
```

In `packages/explorer/test/index.test.ts`, replace the array inside
`toEqual(...)` with:

```ts
      [
        'DEFAULT_NODE_SEP',
        'DEFAULT_NODE_SIZE',
        'DEFAULT_RANK_SEP',
        'ExplorerDataError',
        'defaultSearchText',
        'layoutView',
        'resolveNodeSize',
        'searchNodes',
        'validateView',
        'validateViews',
      ].sort(),
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: FAIL. `search.test.ts` fails because `defaultSearchText` and
`searchNodes` are not exported, and `index.test.ts` fails on the missing names.

- [ ] **Step 3: Write the module**

Create `packages/explorer/src/search.ts`:

```ts
import type { ExplorerNode } from './types.js';

/** What search reads when the caller gives no accessor: the id, then the label. */
export function defaultSearchText(node: ExplorerNode): string {
  return `${node.id} ${node.label}`;
}

/**
 * The nodes whose text contains every token of the query, in data order.
 *
 * Tokens are the query split on whitespace and lowercased. They are matched as
 * text with `includes`, never compiled into a pattern, so a query of `(v2.*)`
 * finds exactly those characters and a query of `[` is not an error.
 *
 * An empty or blank query matches nothing, which is what lets the explorer
 * treat "no query" and "no dimming" as the same state.
 *
 * `searchText` is the caller's accessor over the caller's node type. Whatever
 * it returns is coerced to a string, so an accessor with a missing branch
 * costs a miss, not a crash in the middle of typing.
 */
export function searchNodes<N extends ExplorerNode>(
  nodes: readonly N[],
  query: string,
  searchText: (node: N) => string = defaultSearchText,
): N[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return [];
  return nodes.filter((node) => {
    const text = String(searchText(node) ?? '').toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}
```

In `packages/explorer/src/index.ts`, add this line directly before the line
`export { DEFAULT_NODE_SIZE, resolveNodeSize } from './size.js';`:

```ts
export { defaultSearchText, searchNodes } from './search.js';
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: PASS, 5 files.

Run: `pnpm --filter @prnt/dagr-explorer typecheck`

Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add packages/explorer
git commit -F - <<'EOF'
feat(explorer): search nodes by tokens over a caller-supplied accessor

A node matches when every whitespace-separated token of the query
appears in its text, case ignored. The text is the id and label unless
the caller passes an accessor over its own node type.

Tokens are matched with includes and never compiled into a pattern, so
a query containing regex metacharacters is literal text and cannot
throw. The accessor's result is coerced to a string, so one with a
missing branch costs a miss rather than a crash mid-keystroke.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The import boundary, and the packaging gate

**Files:**
- Test: `packages/explorer/test/imports.test.ts`
- Modify: `packaging/src/pack.ts`
- Modify: `packaging/src/checks.ts` (one comment)
- Modify: `packaging/test/pack.test.ts`
- Modify: `packaging/bin/verify-tools.mjs`
- Modify: `packaging/README.md`

**Interfaces:**
- Consumes: the package from Tasks 1 to 3. In `packaging/test/pack.test.ts`:
  `roots` (package name to extracted tarball directory), `each()`,
  `PUBLISHED_PACKAGES`.
- Produces: nothing later code calls. The explorer is the seventh tarball the
  gate packs and inspects.

- [ ] **Step 1: Write the import-boundary test**

Create `packages/explorer/test/imports.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What this package's source is allowed to import.
 *
 * The explorer must render on a server with three.js absent and must install
 * beside React 18. Both are properties of its import graph: the full
 * `@prnt/dagr-render` entry loads `three/webgpu` at module scope, and
 * `@prnt/dagr-react` requires React 19. So neither may be named here, not
 * even for a type. `@prnt/dagr-render/core` is the allowed way in, and the
 * renderer's own tests hold that entry three-free.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every module specifier a source text names: static, type, dynamic, bare. */
function specifiersOf(text: string): string[] {
  const pattern =
    /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function isForbidden(specifier: string): boolean {
  return (
    specifier === '@prnt/dagr-render' ||
    specifier === '@prnt/dagr-react' ||
    specifier.startsWith('@prnt/dagr-react/') ||
    specifier === 'three' ||
    specifier.startsWith('three/')
  );
}

describe('the import boundary', () => {
  it('recognizes what it forbids, and what it allows', () => {
    for (const bad of ['@prnt/dagr-render', '@prnt/dagr-react', 'three', 'three/webgpu']) {
      expect(isForbidden(bad)).toBe(true);
    }
    for (const good of ['@prnt/dagr-render/core', '@prnt/dagr-layout', 'react', './layout.js']) {
      expect(isForbidden(good)).toBe(false);
    }
  });

  it('finds every form of import', () => {
    const text = [
      "import { a } from 'one';",
      "import type { B } from 'two';",
      "export { c } from 'three-ish';",
      "const d = await import('four');",
      "import 'five';",
    ].join('\n');
    expect(specifiersOf(text)).toEqual(['one', 'two', 'three-ish', 'four', 'five']);
  });

  it('holds for every source file', () => {
    const files = sourceFiles(SRC);
    // An empty list would satisfy the assertion below for the wrong reason.
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      specifiersOf(readFileSync(file, 'utf8'))
        .filter(isForbidden)
        .map((specifier) => `${relative(SRC, file)}: ${specifier}`),
    );
    expect(violations).toEqual([]);
  });
});
```

Run: `pnpm --filter @prnt/dagr-explorer test`

Expected: PASS, 6 files. This test passes on first run because Tasks 1 to 3
already obey the rule. Its first test is what shows the guard can fail.

- [ ] **Step 2: Write the failing packaging tests**

In `packaging/test/pack.test.ts`, in the test
`'packs one tarball per published package'`, change the expected list to:

```ts
    expect(each().map((p) => p.name).sort()).toEqual([
      '@prnt/dagr',
      '@prnt/dagr-explorer',
      '@prnt/dagr-graph',
      '@prnt/dagr-layout',
      '@prnt/dagr-react',
      '@prnt/dagr-render',
      '@prnt/dagr-vdsl',
    ]);
```

Add this test at the end of the `describe` block, after the test
`'typechecks shared interaction from extracted packages without workspace aliases'`:

```ts
  it(
    'runs @prnt/dagr-explorer from installed tarballs with three absent',
    () => {
      const consumer = mkdtempSync(join(tmpdir(), 'dagr-explorer-consumer-'));
      try {
        const localPackages = Object.fromEntries(
          ['@prnt/dagr-graph', '@prnt/dagr-layout', '@prnt/dagr-render', '@prnt/dagr-explorer'].map(
            (name) => {
              const root = roots.get(name);
              if (root === undefined) throw new Error(`${name} was not packed`);
              return [name, `file:${root}`];
            },
          ),
        );
        writeFileSync(
          join(consumer, 'package.json'),
          JSON.stringify({
            private: true,
            type: 'module',
            dependencies: localPackages,
            pnpm: { overrides: localPackages },
          }),
        );
        // Peers are left uninstalled on purpose. `three` is a required peer of
        // the renderer, and this test is about the explorer working without it.
        writeFileSync(
          join(consumer, '.npmrc'),
          'auto-install-peers=false\nstrict-peer-dependencies=false\n',
        );
        try {
          execFileSync(
            'pnpm',
            ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile'],
            { cwd: consumer, encoding: 'utf8', stdio: 'pipe' },
          );
        } catch (error) {
          const output = error as { readonly stdout?: string; readonly stderr?: string };
          throw new Error(`${output.stdout ?? ''}${output.stderr ?? ''}`, { cause: error });
        }

        writeFileSync(
          join(consumer, 'smoke.mjs'),
          `import { createRequire } from 'node:module';
import { layoutView, searchNodes } from '@prnt/dagr-explorer';

// The control: if three could be resolved from where the renderer is
// installed, everything below would prove nothing.
const fromRenderer = createRequire(import.meta.resolve('@prnt/dagr-render/core'));
let three = 'absent';
try {
  fromRenderer.resolve('three');
  three = 'present';
} catch {
  // Unresolvable, which is the condition under test.
}
if (three !== 'absent') throw new Error('three is resolvable, so this smoke proves nothing');

const view = {
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b' }],
};
const laid = layoutView(view);
if (laid.boxes.size !== 2) throw new Error('explorer layout smoke failed: boxes');
if (laid.routes.get('ab')?.length !== 2) throw new Error('explorer layout smoke failed: route');
if (searchNodes(view.nodes, 'alp').length !== 1) throw new Error('explorer search smoke failed');
`,
        );
        try {
          execFileSync(process.execPath, ['smoke.mjs'], {
            cwd: consumer,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch (error) {
          const output = error as { readonly stdout?: string; readonly stderr?: string };
          throw new Error(`${output.stdout ?? ''}${output.stderr ?? ''}`, { cause: error });
        }
      } finally {
        rmSync(consumer, { recursive: true, force: true });
      }
    },
    // An external install and a node process, as the typecheck above is.
    30_000,
  );
```

- [ ] **Step 3: Run the gate and watch it fail**

Run: `pnpm --filter @dagr/packaging test`

Expected: FAIL. `'packs one tarball per published package'` reports six names
where seven were expected, and the new test fails with
`@prnt/dagr-explorer was not packed`.

- [ ] **Step 4: Add the explorer to the gate**

In `packaging/src/pack.ts`, change:

```ts
/** The packages this repo publishes, in dependency order. */
export const PUBLISHED_PACKAGES = ['graph', 'layout', 'render', 'react', 'vdsl', 'dagr'] as const;
```

to:

```ts
/**
 * The packages this repo publishes, in dependency order.
 *
 * `explorer` is `"private": true` until M5.6f and is here regardless. `pnpm
 * pack` packs a private package, and a broken `exports` map is cheaper to find
 * on the day it is written than on the day the flag comes off.
 */
export const PUBLISHED_PACKAGES = [
  'graph',
  'layout',
  'render',
  'explorer',
  'react',
  'vdsl',
  'dagr',
] as const;
```

Now fix the counts in prose that name the number of packages. In each of these
places, the word "six" counts the packed packages and becomes "seven":

- `packaging/test/pack.test.ts`: the file header (`The six published
  packages`), the `beforeAll` comment (`A tsc run for six packages, six packs
  and six extractions`, all three), and the LICENSE test comment (`six
  identical copies`).
- `packaging/src/checks.ts`: the header comment (`over the six real tarballs`).
- `packaging/README.md`: `six real tarballs`, `runs tsc for the six packages`,
  `installs all six tarballs`, and `All six packages are "type": "module"`.
- `packaging/bin/verify-tools.mjs`: the header (`installs all six tarballs`
  and `on all six`). The run label is changed in Step 6.

Check that none was missed:

Run: `grep -n -i "six" packaging/README.md packaging/src/*.ts packaging/test/pack.test.ts packaging/bin/verify-tools.mjs`

Expected: one line only, the `npm install of all six tarballs` label in
`verify-tools.mjs`, which Step 6 changes.

In `packaging/README.md`, add this paragraph directly after the paragraph that
ends `...checks the same predicates over the seven real tarballs. A guard whose
only evidence is a green run against a tree already known to be correct has
never demonstrated that it can go red.`:

```markdown
One of the seven, `@prnt/dagr-explorer`, is `"private": true` until M5.6f and
is packed regardless. `pnpm pack` packs a private package, and a broken
`exports` map is cheaper to find on the day it is written than on the day the
flag comes off.
```

- [ ] **Step 5: Run the gate and watch it pass**

Run: `pnpm --filter @dagr/packaging test`

Expected: PASS, every test. The explorer's tarball now passes the same
predicates as the rest: no `workspace:` range, every `exports` path present,
every source map resolved, README, LICENSE and CHANGELOG present, LICENSE
byte-identical to the root, `publishConfig.access` public, `src` shipped, no
test file shipped.

- [ ] **Step 6: Extend the network verifier**

In `packaging/bin/verify-tools.mjs`:

Change:

```js
const PACKAGES = ['graph', 'layout', 'render', 'react', 'vdsl', 'dagr'];
```

to:

```js
const PACKAGES = ['graph', 'layout', 'render', 'explorer', 'react', 'vdsl', 'dagr'];
```

In the array written to `index.tsx`, add these entries directly after the entry
that begins `"import { DagrCanvas, Html } from '@prnt/dagr-react';"`:

```js
      "import { layoutView, searchNodes } from '@prnt/dagr-explorer';",
      "import type { ExplorerView } from '@prnt/dagr-explorer';",
```

and add these entries directly after the entry
`'const umbrellaResult = UmbrellaLayout({ graph });'`:

```js
      "const explorerView: ExplorerView = { id: 'v', label: 'V', nodes: [{ id: 'a', label: 'A' }], edges: [] };",
      'void layoutView(explorerView).width;',
      "void searchNodes(explorerView.nodes, 'a');",
```

In the array written to `smoke.mjs`, add this entry directly after the entry
that begins `"import { layout as UmbrellaLayout } from '@prnt/dagr/layout';"`:

```js
      "import { layoutView as explorerLayoutView } from '@prnt/dagr-explorer';",
```

and add this entry directly after the entry that begins
`"if (ScopedLayout({ graph }).nodes.size !== 2"`:

```js
      "if (explorerLayoutView({ id: 'v', label: 'V', nodes: [{ id: 'a', label: 'A' }], edges: [] }).boxes.size !== 1) throw new Error('explorer smoke failed');",
```

Change:

```js
  const reactTarball = pick('react');
```

to:

```js
  const explorerTarball = pick('explorer');
  const reactTarball = pick('react');
```

In the `npm install` argument list, add `explorerTarball,` directly after
`renderTarball,`. Change the label
`'npm install of all six tarballs and their public peers'` to
`'npm install of all seven tarballs and their public peers'`.

- [ ] **Step 7: Run the network verifier**

Run: `pnpm --filter @dagr/packaging verify:tools`

Expected: every line `PASS`, ending `Everything passed.` This needs the npm
registry. If the registry is unreachable, do not retry in a loop: record the
exact failure in the pull request body and continue.

If `publint` reports the `private` field on the explorer tarball, record its
exact message in the pull request body and leave the flag in place. The spec
keeps the package private until M5.6f.

- [ ] **Step 8: Commit**

```bash
git add packages/explorer/test/imports.test.ts packaging
git commit -F - <<'EOF'
test(explorer): hold the import boundary and pack the seventh tarball

The explorer has to render with three.js absent and install beside
React 18, and both are properties of its import graph. A test scans
src for the full renderer entry, @prnt/dagr-react and three, and shows
first that the scan recognizes each.

The packaging gate now packs the explorer, private or not, so a broken
exports map is found on the day it is written. A consumer installs the
four tarballs it needs with peers left out, asserts three cannot be
resolved from the renderer, then runs layout and search from the built
entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Document it, then ship through the pull request gate

**Files:**
- Modify: `packages/explorer/README.md`
- Modify: `packages/explorer/CHANGELOG.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `@prnt/dagr-explorer`'s pure core on `main`. M5.6c builds the
  camera, viewport and visible set on `layoutView`, `ExplorerLayout`,
  `ExplorerBox` and `searchNodes`.

- [ ] **Step 1: Write the README**

Replace the whole of `packages/explorer/README.md` with:

````markdown
# @prnt/dagr-explorer

An interactive graph explorer for [Dagr](https://dagr.prnt.design): views,
search, connection tracing, groups and a details drawer, with node content
virtualized by on-screen size.

## Read this first: it is not published yet

The package is built in slices, M5.6a to M5.6f in `ROADMAP.md`, and stays
`"private": true` until the last. What exists today is the headless core
below. The React parts arrive in M5.6c to M5.6e.

## The core

```ts
import { layoutView, searchNodes } from '@prnt/dagr-explorer';
import type { ExplorerView } from '@prnt/dagr-explorer';

const view: ExplorerView = {
  id: 'overview',
  label: 'Overview',
  nodes: [
    { id: 'app', label: 'Application' },
    { id: 'store', label: 'Store' },
  ],
  edges: [{ id: 'read', source: 'app', target: 'store' }],
};

const layout = layoutView(view);
layout.boxes.get('app'); // { x: 40, y: 40, width: 240, height: 120 }
layout.routes.get('read'); // [{ x: 280, y: 100 }, { x: 400, y: 100 }]

searchNodes(view.nodes, 'sto'); // [{ id: 'store', label: 'Store' }]
```

None of it touches the DOM or imports React at runtime, so it runs on a server.

## A node is an id and a label

Those two fields are all the explorer reads. Everything else about a node is
your own fields on a type that extends `ExplorerNode`, and that type flows
through to every function and, later, every slot.

## Sizes are declared, never measured

A node's size is its own `size`, else the view's `layout.nodeSize` (a value or
a function of the node), else 240 by 120. The explorer virtualizes node
content, and a node with no element cannot be measured.

A width or height that is not finite and greater than zero throws
`INVALID_NODE_SIZE`, naming the node.

## Layout

`layoutView(view, options)` returns boxes, routes and group rectangles in world
space: y-down CSS pixels at zoom 1, padded 40 off the origin.

| `view.layout` | Default | |
| --- | --- | --- |
| `direction` | `'right'` | or `'down'` |
| `nodeSize` | 240 by 120 | a size, or a function of the node |
| `nodeSep` | 40 | gap between neighbors across the flow |
| `rankSep` | 120 | gap between ranks along the flow |
| `edgeStyle` | `'smooth'` | or `'orthogonal'` |

Three behaviors are the explorer's, not the layout engine's:

- **Parallel edges on one line bow apart.** Edges joining the same two nodes,
  in either direction, are drawn on one line when they span a single rank.
  Those are separated by 16, with both ends left on their nodes. A pair that
  spans more ranks is left as the layout engine routed it, which is already
  apart.
- **A self loop is not drawn.** An edge from a node to itself stays in your
  data and has an empty route. It moves nothing.
- **A group moves no node.** It is the padded hull of its members with a band
  above for its label. Pass `{ strictGroups: true }` to throw
  `GROUP_ENCLOSES_NON_MEMBER` when an outline would take in a node that is not
  a member, for a diagram where that would be a false statement.

## Search

`searchNodes(nodes, query, searchText)` returns the nodes whose text contains
every whitespace-separated token of the query, case ignored, in data order. The
text is the id and label unless you pass `searchText`, an accessor over your
own node type. An empty query matches nothing. The query is literal text, not a
pattern.

## Errors

A malformed view throws `ExplorerDataError`. Switch on its `code`. Its `id` is
the view, node, edge or group the error is about, and its `viewId` is the view
that was found in, so a host can point at the offender without parsing the
message.

| `code` | When |
| --- | --- |
| `DUPLICATE_VIEW_ID` | two views share an id |
| `DUPLICATE_NODE_ID` | two nodes in one view share an id |
| `DUPLICATE_EDGE_ID` | two edges in one view share an id |
| `DUPLICATE_GROUP_ID` | two groups in one view share an id |
| `INVALID_NODE_SIZE` | a node's width or height is not finite and greater than zero |
| `MISSING_EDGE_ENDPOINT` | an edge names a node its view lacks |
| `MISSING_GROUP_MEMBER` | a group names a node its view lacks |
| `EMPTY_GROUP` | a group has no members |
| `GROUP_ENCLOSES_NON_MEMBER` | `strictGroups` only |

Ids may repeat across views.

MIT © prnt.design
````

- [ ] **Step 2: Write the changelog**

Replace the whole of `packages/explorer/CHANGELOG.md` with:

```markdown
# @prnt/dagr-explorer

## Unreleased

Not published. The package is private until M5.6f.

- Add the headless core (M5.6b): the `ExplorerView` data model, `validateView`
  and `validateViews` with `ExplorerDataError`, `layoutView`, and
  `searchNodes`.
- Layout flows `'right'` by default or `'down'`, in y-down world pixels padded
  40 off the origin. Parallel edges that span one rank bow 16 apart. A self
  loop has an empty route. A group is the padded hull of its members and
  moves no node.
```

- [ ] **Step 3: Check M5.6b off on the roadmap**

In `ROADMAP.md`, change:

```markdown
- [ ] **M5.6b** Package scaffold and pure core: types, validation, layout,
  search.
```

to:

```markdown
- [x] **M5.6b** Package scaffold and pure core: types, validation, layout,
  search. Private until M5.6f. Self loops are kept and not drawn.
```

- [ ] **Step 4: Check the prose, and that the README's numbers are true**

Run: `git diff origin/main | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`

The README states two results. Confirm them against the code rather than
trusting this plan:

Run: `pnpm --filter @prnt/dagr-explorer exec vitest run test/layout.test.ts -t "routes each edge"`

Expected: PASS. That test asserts the same `{ x: 280, y: 100 }` to
`{ x: 400, y: 100 }` route for a two-node edge that the README shows, and the
chain test beside it asserts the `{ x: 40, y: 40, width: 240, height: 120 }`
box.

- [ ] **Step 5: Commit**

```bash
git add packages/explorer/README.md packages/explorer/CHANGELOG.md ROADMAP.md
git commit -F - <<'EOF'
docs(explorer): document the headless core and check off M5.6b

The README leads with the fact that would otherwise bite: the package
is not published and has no React parts yet. It then covers the three
behaviors that are the explorer's and not the layout engine's, since
those are the ones a reader cannot infer from the layout docs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Claim the work**

Read the brain object `dagr/workboard`. Add a claim to its `claims` array:
`{ "task": "M5.6b", "agent": "<this agent's id>", "branch": "agt_f31326c2a5b0/m5-6b-explorer-core", "claimedAt": "<ISO timestamp>" }`.
Store it with `expectedRevision` set to the revision you read.

- [ ] **Step 7: Rebase, reinstall, run the gate**

```bash
git fetch origin
git rebase origin/main
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci
```

Expected: all five pass. If the rebase conflicts in `pnpm-lock.yaml`, take
`origin/main`'s version of the file, run `pnpm install` to re-add the explorer
importer, and continue the rebase. `bench:ci` compares against a machine-matched
baseline: run it with the machine at a load like the baseline's (see
`bench/README.md`). This slice adds no bench.

- [ ] **Step 8: Review the diff**

Run the `code-review` skill over `git diff origin/main...HEAD`. Fix every
finding as a follow-up commit, never an amend, or record why it is accepted.

- [ ] **Step 9: Review the merged tree**

Dispatch a fresh reviewer over the tree as it will be after merge, not the
diff. Ask it to read every file under `packages/explorer`, plus
`packaging/src/pack.ts`, `packaging/test/pack.test.ts`,
`packaging/bin/verify-tools.mjs` and `packaging/README.md`, in full, and
answer: does the README state anything the code does not do; does any count of
packages anywhere still say six; does every error code in the README, in
`errors.ts` and in the spec's table agree; does anything in `src` import the
full renderer entry, `@prnt/dagr-react` or `three`. Fix or record every finding
the same way, then rerun the gate from Step 7 if anything changed.

- [ ] **Step 10: Open the pull request**

```bash
git push -u origin agt_f31326c2a5b0/m5-6b-explorer-core
gh pr create --title "feat(explorer): add @prnt/dagr-explorer with its headless core (M5.6b)" --body-file <path to the body>
```

The body records, per `AGENTS.md`: what changed and why; that the package is
private and unpublished; the two behaviors a reader would not guess (self loops
are not drawn, parallel edges bow); the gate result with the five commands; the
`verify:tools` result, including any `publint` note about the private flag;
each review that ran, what it found, and how each finding was resolved or why
it was accepted. End the body with the line
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 11: Wait for CI, then merge or stop**

```bash
gh pr checks --watch
```

Green CI: `gh pr merge --squash --delete-branch`. Red CI: fix on the branch as
a new commit and push. If `main` moved, rebase and push with
`--force-with-lease` to this branch only. If green cannot be reached, leave the
pull request open, write the blocker in it, and stop.

- [ ] **Step 12: Record the outcome**

Remove the claim from `dagr/workboard`. Update the brain object `dagr/explorer`:
set `status` to `m5-6b-merged` and add the pull request URL and merge commit.
Append an event to the `dagr` collection, kind `shipped`, subject `M5.6b`, with
the date, the actor, the pull request URL, and the gate result.

---

## Amendments during execution

Changes made while executing this plan on 2026-10-03. The task text above is
as planned, except Task 5's README and changelog wording, which was corrected
before that task ran.

- **Before execution,** the API design review of the spec changed this plan's
  error codes to UPPER_SNAKE, added `id` and `viewId` to `ExplorerDataError`,
  and took `layoutKey` and four spacing constants out of the public entry.
  Those edits are in the task text.
- **Parallel edges.** Task 2 separated every pair of edges that shared two
  nodes. The algorithms review showed, from the router's own contract, that a
  pair spanning more than one rank is already apart. A follow-up commit
  separates only two-point routes, and replaces a per-edge `indexOf` with a map
  built once.
- **Invariants.** A new `test/layout-invariants.test.ts` lays out twelve seeded
  graphs in both directions and both edge styles and holds four properties: no
  boxes overlap, each route starts on its source and ends on its target, no
  route doubles back along the flow, and everything lies inside the plane.
- **Test gaps** the task reviews found: Task 2's strict-groups test asserted
  the error's fields inside a `catch`, which is vacuous if the throw goes away.
  It now captures the error. Tests were added for four siblings, a bowed pair
  under the orthogonal style, and an outline at exact contact.
- **Task 4's consumer smoke runs with `NODE_PATH` removed.** The test runner
  exports one pointing at the repo's own `node_modules`, where `three` is, and
  the smoke's control followed it. A real consumer has no such variable.
- **After the API design review of the code as built:** a new error code,
  `INVALID_LAYOUT_OPTION`, for a bad `nodeSep`, `rankSep`, `direction` or
  `edgeStyle`, which used to escape as the engine's or the renderer's own
  error. `ExplorerLayout.groups` is a map keyed by group id, and the
  `ExplorerGroupBox` type the task text above names no longer exists.

