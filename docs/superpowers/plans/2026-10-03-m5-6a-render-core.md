# M5.6a `@prnt/dagr-render/core` implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@prnt/dagr-render` a subpath, `./core`, that exports the camera
and edge-path arithmetic and never loads `three`.

**Architecture:** One new module, `src/core.ts`, re-exports three runtime names
and their types from modules that already import nothing from `three`. One new
key in the manifest's `exports` publishes it. Two guards hold the property: a
source-level test that makes every `three` import throw, and a tarball-level
test that loads the built entry where `three` cannot be resolved.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, Node ESM

**Spec:** `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`, section
"`@prnt/dagr-render/core`". This is slice M5.6a of that spec.

## Global constraints

- `core` exports exactly three runtime names: `Camera2D`, `fitZoom`,
  `shapeEdgePath`. Types: `Camera2DInit`, `EdgePathOptions`, `OrthoFrustum`,
  `Size`, `Vec2`, `ViewportSize`, `WorldBounds`.
- Nothing existing moves. `src/index.ts` keeps every export it has.
- The only edit to `packages/render/package.json` is one new key under
  `exports`. Do not touch `version`, `publishConfig`, `peerDependencies`, or
  `files`. The maintainer approved this one addition by approving the spec.
- `three` stays a required peer of `@prnt/dagr-render`.
- The `@prnt/dagr` umbrella is not changed.
- Do not edit `LICENSE`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, or
  anything under `.claude/`.
- No em-dashes in any prose: comments, docs, commit messages, the pull request.
- Commits: conventional subject, author `Dagr Agent <agent@prnt.design>`
  (repo-local git config), trailer
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Work reaches `main` only through a pull request, per `AGENTS.md`.

## Review focus

- A consumer compiling with `moduleResolution: NodeNext` must resolve the types
  of `@prnt/dagr-render/core`, not only a bundler-resolution consumer. Pinned
  in Task 2 by the packed-consumer typecheck, which already uses `NodeNext`.
- A later edit that makes `core` reach `three` must turn the gate red. Pinned in
  Task 1 by a control assertion that the same mocks do fail the full entry, and
  in Task 2 by a control that the built full entry fails where `core` loads.
- `Camera2D` from `core` and from the full entry must be one class, so
  `instanceof` holds across the two entries. Pinned in Task 1 at source level
  and in Task 2 in the installed tarball.
- The tarball guard must not pass because `three` happened to be resolvable
  from the temp directory. Pinned in Task 2 by the same control: the full entry
  must fail with an error naming `three`.

---

### Task 1: The `core` module and its source-level guards

**Files:**
- Create: `packages/render/src/core.ts`
- Create: `packages/render/test/core.test.ts`
- Create: `packages/render/test/core-identity.test.ts`

**Interfaces:**
- Consumes: `Camera2D`, `fitZoom`, `Camera2DInit` from `./camera.js`;
  `shapeEdgePath`, `EdgePathOptions` from `./edge-path.js`; `OrthoFrustum`,
  `Size`, `Vec2`, `ViewportSize`, `WorldBounds` from `./types.js`. All exist.
- Produces: the module `packages/render/src/core.ts` with exactly those
  exports. M5.6b imports it as `@prnt/dagr-render/core`.

- [ ] **Step 1: Write the failing tests**

Create `packages/render/test/core.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// Every way this package reaches three.js, made to throw on load. A factory
// that throws fails the import of whatever asked for the module, so the core
// entry loading under these three mocks is the evidence that nothing in its
// import graph asks.
vi.mock('three', () => {
  throw new Error('loaded three');
});
vi.mock('three/webgpu', () => {
  throw new Error('loaded three/webgpu');
});
vi.mock('three/tsl', () => {
  throw new Error('loaded three/tsl');
});

describe('@prnt/dagr-render/core', () => {
  it('loads and works with three.js unavailable', async () => {
    const core = await import('../src/core.js');
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const camera = new core.Camera2D({
      viewport: { width: 320, height: 200, devicePixelRatio: 1 },
    });
    camera.fitBounds(bounds);
    expect(core.fitZoom(bounds, camera.viewport)).toBe(camera.zoom);
    expect(core.shapeEdgePath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('exports exactly three runtime names', async () => {
    // Types are erased, so only the runtime names can be counted. A fourth
    // name is a decision, and this is where it gets made.
    const core = await import('../src/core.js');
    expect(Object.keys(core).sort()).toEqual(['Camera2D', 'fitZoom', 'shapeEdgePath']);
  });

  it('is guarded by mocks that do fail the full entry', async () => {
    // The control. Without it, mocks that never fired would let the first
    // test pass for the wrong reason.
    await expect(import('../src/index.js')).rejects.toThrow();
  });
});
```

Create `packages/render/test/core-identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../src/core.js';
import * as api from '../src/index.js';

describe('@prnt/dagr-render/core and the full entry', () => {
  it('export the same objects, not copies', () => {
    // One class, so `instanceof Camera2D` holds whichever entry built it.
    expect(core.Camera2D).toBe(api.Camera2D);
    expect(core.fitZoom).toBe(api.fitZoom);
    expect(core.shapeEdgePath).toBe(api.shapeEdgePath);
  });
});
```

This second file has no mocks on purpose: it imports the full entry, which
loads `three` for real.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @prnt/dagr-render exec vitest run test/core.test.ts test/core-identity.test.ts`

Expected: FAIL. Both files report that `../src/core.js` cannot be resolved. The
control test, "is guarded by mocks that do fail the full entry", passes.

- [ ] **Step 3: Write the module**

Create `packages/render/src/core.ts`:

```ts
/**
 * `@prnt/dagr-render/core`: the arithmetic of this package that never touches a
 * GPU, as its own entry.
 *
 * The full entry re-exports `createRenderer`, and `webgpu-renderer.ts` imports
 * `three/webgpu` at module scope. A bundler drops that for a consumer who only
 * wanted the camera, because this package is side-effect free. A server that
 * externalizes its dependencies does not: it evaluates the whole entry, and
 * with it three.js, to draw an SVG.
 *
 * Everything here is ALSO exported from the full entry, and is the same object
 * there. This file adds a way in. It moves nothing.
 *
 * **The rule for adding to this file: the module you export from must not
 * import `three`, directly or through anything it imports at runtime.**
 * `import type` does not count, because it is erased. `test/core.test.ts`
 * holds the rule at source level and the packaging gate holds it on the built
 * tarball, so a mistake here is a red test rather than a production surprise.
 */

export { Camera2D, fitZoom } from './camera.js';
export type { Camera2DInit } from './camera.js';
export { shapeEdgePath } from './edge-path.js';
export type { EdgePathOptions } from './edge-path.js';
export type { OrthoFrustum, Size, Vec2, ViewportSize, WorldBounds } from './types.js';
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @prnt/dagr-render exec vitest run test/core.test.ts test/core-identity.test.ts`

Expected: PASS, 4 tests in 2 files.

Run: `pnpm --filter @prnt/dagr-render typecheck`

Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/core.ts packages/render/test/core.test.ts packages/render/test/core-identity.test.ts
git commit -F - <<'EOF'
feat(render): add a three-free core entry for the camera and edge paths

The full entry re-exports createRenderer, which imports three/webgpu at
module scope. A server that externalizes dependencies evaluates all of
it, and so loads three.js to compute an SVG path.

src/core.ts re-exports Camera2D, fitZoom and shapeEdgePath from modules
that import nothing from three. The objects are the same ones the full
entry exports. A test makes every three import throw and loads core
under it, with a control that the same mocks do fail the full entry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Publish the subpath, and prove it on the tarball

**Files:**
- Modify: `packages/render/package.json` (the `exports` object)
- Modify: `packaging/test/pack.test.ts`
- Modify: `packaging/bin/verify-tools.mjs`

**Interfaces:**
- Consumes: `packages/render/src/core.ts` from Task 1. `roots` and `REPO_ROOT`
  in `packaging/test/pack.test.ts`, which already exist: `roots` maps a package
  name to its extracted tarball directory.
- Produces: the published subpath `@prnt/dagr-render/core`, resolving to
  `dist/core.js` and `dist/core.d.ts`.

- [ ] **Step 1: Write the failing tarball tests**

In `packaging/test/pack.test.ts`, add `pathToFileURL` to the imports. Change:

```ts
import { join } from 'node:path';
```

to:

```ts
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
```

Add this test inside the `describe('the tarball a consumer installs', ...)`
block, directly after the test named
`'ships the source every declaration map resolves to, and no test file'`:

```ts
  it('loads @prnt/dagr-render/core from its tarball where three cannot be resolved', () => {
    // The extracted tarball sits in the OS temp directory with no
    // `node_modules` above it, so `three` is unresolvable from here. That is
    // the condition a server with externalized dependencies and no three
    // installed would be in.
    const root = roots.get('@prnt/dagr-render');
    if (root === undefined) throw new Error('@prnt/dagr-render was not packed');
    const load = (entry: string): string =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `await import(${JSON.stringify(pathToFileURL(join(root, entry)).href)});`,
        ],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' },
      );

    expect(() => load('dist/core.js')).not.toThrow();
    // The control: the full entry must fail here, and on three. If it loaded,
    // three was resolvable after all and the line above proved nothing.
    expect(() => load('dist/index.js')).toThrow(/three/);
  });
```

In the same file, inside the template string written to `consumer.ts` by the
test `'typechecks shared interaction from extracted packages without workspace
aliases'`, add these lines directly after the line
`} from '@prnt/dagr-react';`:

```ts
import {
  Camera2D as CoreCamera,
  shapeEdgePath as coreShapeEdgePath,
  type EdgePathOptions as CoreEdgePathOptions,
  type WorldBounds as CoreWorldBounds,
} from '@prnt/dagr-render/core';

const coreBounds: CoreWorldBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const coreOptions: CoreEdgePathOptions = { style: 'smooth' };
new CoreCamera().fitBounds(coreBounds);
coreShapeEdgePath([{ x: 0, y: 0 }, { x: 1, y: 1 }], coreOptions);
```

- [ ] **Step 2: Run the gate and watch the typecheck fail**

Run: `pnpm --filter @dagr/packaging test`

Expected: FAIL in `'typechecks shared interaction from extracted packages
without workspace aliases'` with `TS2307: Cannot find module
'@prnt/dagr-render/core'`. The manifest does not publish the subpath yet, so
`NodeNext` resolution refuses it.

The new `'loads @prnt/dagr-render/core from its tarball ...'` test PASSES
already. That is expected: `tsc` emits `dist/core.js` from Task 1 and `files`
ships all of `dist`. It guards the built file. The manifest edit is what the
typecheck guards.

- [ ] **Step 3: Add the subpath to the manifest**

In `packages/render/package.json`, change:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
```

to:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/core.d.ts",
      "import": "./dist/core.js",
      "default": "./dist/core.js"
    }
  },
```

Change nothing else in that file.

- [ ] **Step 4: Run the gate and watch it pass**

Run: `pnpm --filter @dagr/packaging test`

Expected: PASS, every test. `'carries every file its own manifest points at'`
now also walks the `./core` branch and finds `dist/core.js` and
`dist/core.d.ts` in the tarball.

- [ ] **Step 5: Extend the network verifier**

In `packaging/bin/verify-tools.mjs`, in the array written to `index.tsx`, add
these two entries directly after the entry that begins
`"import { Camera2D as UmbrellaCamera } from '@prnt/dagr/render';"`:

```js
      "import { Camera2D as CoreCamera, shapeEdgePath as coreShapeEdgePath } from '@prnt/dagr-render/core';",
      "import type { EdgePathOptions as CoreEdgePathOptions } from '@prnt/dagr-render/core';",
```

In the same array, add these entries directly after the entry
`'camera.fitBounds(bounds);'`:

```js
      "const coreOptions: CoreEdgePathOptions = { style: 'orthogonal' };",
      'const _coreCamera: CoreCamera = camera;',
      'void coreShapeEdgePath([{ x: 0, y: 0 }, { x: 1, y: 1 }], coreOptions);',
      'void _coreCamera;',
```

In the array written to `smoke.mjs`, add this entry directly after the entry
that begins `"import { Camera2D as UmbrellaCamera } from '@prnt/dagr/render';"`:

```js
      "import { Camera2D as CoreCamera, fitZoom as coreFitZoom, shapeEdgePath as coreShapeEdgePath } from '@prnt/dagr-render/core';",
```

and add these two entries directly after the entry that begins
`"if (ScopedCamera !== UmbrellaCamera)"`:

```js
      "if (ScopedCamera !== CoreCamera || fitZoom !== coreFitZoom) throw new Error('render core identity failed');",
      "if (coreShapeEdgePath([{ x: 0, y: 0 }, { x: 4, y: 0 }]).length !== 2) throw new Error('render core smoke failed');",
```

- [ ] **Step 6: Run the network verifier**

Run: `pnpm --filter @dagr/packaging verify:tools`

Expected: every line `PASS`, ending `Everything passed.` This needs the npm
registry. If the registry is unreachable, do not retry in a loop: record the
exact failure in the pull request body under the reviews section and continue.
The gate in Step 4 does not depend on it.

- [ ] **Step 7: Commit**

```bash
git add packages/render/package.json packaging/test/pack.test.ts packaging/bin/verify-tools.mjs
git commit -F - <<'EOF'
feat(render): publish the core entry as @prnt/dagr-render/core

Adds one key to exports. Without it a NodeNext consumer cannot resolve
the subpath at all, which the packed-consumer typecheck now covers.

The packaging gate also loads dist/core.js from the extracted tarball,
where three cannot be resolved, and asserts as a control that
dist/index.js fails there on three. A guard that only ever passed would
not have shown it can fail.

The exports addition is the one manifest edit the M5.6 spec reserves
for this slice. version, publishConfig, peers and files are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Document it, and open M5.6 on the roadmap

**Files:**
- Modify: `packages/render/README.md`
- Modify: `packages/render/CHANGELOG.md`
- Modify: `docs/docs/render.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: the published subpath from Task 2.
- Produces: nothing code depends on.

- [ ] **Step 1: Package README**

In `packages/render/README.md`, add this section directly before the line
`## Documentation`:

````markdown
## The three-free entry

`@prnt/dagr-render/core` exports `Camera2D`, `fitZoom` and `shapeEdgePath`, with
their types, from modules that never import `three`.

```ts
import { Camera2D, shapeEdgePath } from '@prnt/dagr-render/core';
```

Use it when you want the camera or the edge-path arithmetic and no renderer: an
SVG or DOM drawing, or a server render. The full entry imports `three/webgpu`
at module scope, so a server that externalizes its dependencies loads three.js
to import it, and the core entry is how you avoid that.

They are the same objects the full entry exports. A camera built from one entry
is an `instanceof` the other's `Camera2D`. `three` is still a peer dependency
of the package, so it is installed either way. The core entry is about what
gets evaluated, not what gets installed.

````

- [ ] **Step 2: Changelog**

In `packages/render/CHANGELOG.md`, add this bullet as the first bullet under
`## Unreleased`:

```markdown
- Add the `@prnt/dagr-render/core` entry: `Camera2D`, `fitZoom` and
  `shapeEdgePath` with their types, from modules that never import `three`. The
  objects are the ones the full entry exports. Nothing moved.
```

- [ ] **Step 3: Renderer page**

In `docs/docs/render.md`, the section `## three.js is a peer dependency` ends
with a paragraph whose last sentence is "...rather than documenting something
the compiler already enforces." Add this subsection directly after that
paragraph and before the next `##` heading:

```markdown
### The entry that does not need it

"Cannot be imported at all without three" is true of the full entry. It is not
true of `@prnt/dagr-render/core`, which exports `Camera2D`, `fitZoom` and
`shapeEdgePath` and nothing else at runtime.

Those three come from `camera.ts` and `edge-path.ts`, and neither imports
`three`, directly or through anything it imports. The core entry re-exports
them without going through `index.ts`, so loading it evaluates no renderer
module.

The case it exists for is a server render. A bundler already drops
`three/webgpu` for a consumer who only imports the camera, because this package
is side-effect free. A server that externalizes its dependencies has no such
step: it evaluates the entry it is given. `@prnt/dagr-explorer` draws SVG from
exactly these three functions and has to render on a server, which is why the
entry was cut.

The objects are the same ones the full entry exports, so a `Camera2D` from
either satisfies `instanceof` against the other. `three` remains a required
peer, so the entry changes what is evaluated and not what is installed.

Two tests hold the property. `test/core.test.ts` replaces `three`,
`three/webgpu` and `three/tsl` with modules that throw on load, imports the
core entry under them, and asserts as a control that the same mocks do fail the
full entry. The packaging gate loads the built `dist/core.js` from the
extracted tarball, in a directory `three` cannot be resolved from, and asserts
that `dist/index.js` fails there. A guard that had only ever passed would not
have shown it can fail.
```

- [ ] **Step 4: Roadmap**

In `ROADMAP.md`, add this block directly after the M5.5 entry (the three lines
beginning `- [x] **M5.5** Containment reserved in the graph model`) and before
the blank line that precedes `## M6`:

```markdown
- [ ] **M5.6** `@prnt/dagr-explorer`: `DagrExplorer`, a generic interactive
  graph explorer (views, search, connection tracing, groups, details drawer)
  composed from named parts, with node content virtualized by on-screen size
  over a swappable base layer. Spec:
  `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`.
- [x] **M5.6a** `@prnt/dagr-render/core`: a three-free entry for `Camera2D`,
  `fitZoom` and `shapeEdgePath`, so a server never evaluates `three` to draw
  SVG.
- [ ] **M5.6b** Package scaffold and pure core: types, validation, layout,
  search.
- [ ] **M5.6c** Camera, viewport, SVG base, visible set, overlay tiers, pins.
- [ ] **M5.6d** Root state, remaining parts, `labels`, `DagrExplorer`,
  `styles.css`.
- [ ] **M5.6e** Roving focus, spatial navigation, reveal, server rendering.
- [ ] **M5.6f** Docs, demos, bench, browser validation, measured SVG ceiling.
```

Do not edit the "Next jobs in priority order" table at the top of
`ROADMAP.md`. Where M5.6 sits in the daily queue is the maintainer's call.

- [ ] **Step 5: Check the prose and the docs build**

Run: `git diff origin/main -- packages/render/README.md packages/render/CHANGELOG.md docs/docs/render.md ROADMAP.md | grep '^+' | grep -c $'\xe2\x80\x94'`

Expected: `0`

Run: `pnpm build`

Expected: exits 0. This builds every package and the docs site, so a broken
Markdown link or an unclosed code fence fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/render/README.md packages/render/CHANGELOG.md docs/docs/render.md ROADMAP.md
git commit -F - <<'EOF'
docs(render): document the core entry and open M5.6 on the roadmap

The renderer page said the package cannot be imported without three.
That is now true of the full entry only, so the page says which entry
it means and how the two tests hold the difference.

M5.6 and its six slices join the roadmap with M5.6a checked. The
priority table is untouched: where M5.6 sits in the daily queue is the
maintainer's call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Ship through the pull request gate

**Files:** none created. This task follows `AGENTS.md`, "How work reaches main".

**Interfaces:**
- Consumes: the three commits above, on the branch
  `agt_f31326c2a5b0/agent-c2a5b0`. That branch also carries the M5.6 spec and
  both plans, which reach `main` with this pull request.
- Produces: `@prnt/dagr-render/core` on `main`. M5.6b starts from there.

- [ ] **Step 1: Claim the work**

Read the brain object `dagr/workboard`. Add a claim to its `claims` array:
`{ "task": "M5.6a", "agent": "<this agent's id>", "branch": "agt_f31326c2a5b0/agent-c2a5b0", "claimedAt": "<ISO timestamp>" }`.
Store it with `expectedRevision` set to the revision you read.

- [ ] **Step 2: Rebase, reinstall if the rebase moved anything, run the gate**

```bash
git fetch origin
git rebase origin/main
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci
```

Expected: all five pass. `bench:ci` compares against a machine-matched
baseline: run it with the machine at a load like the baseline's (see
`bench/README.md`), and if it fails on an entry this change cannot affect, run
it once more before treating it as real.

- [ ] **Step 3: Review the diff**

Run the `code-review` skill over `git diff origin/main...HEAD`. Fix every
finding as a follow-up commit, never an amend, or record why it is accepted.

- [ ] **Step 4: Review the merged tree**

Dispatch a fresh reviewer over the tree as it will be after merge, not the
diff. Ask it to read `packages/render/src/core.ts`,
`packages/render/package.json`, `packaging/test/pack.test.ts`,
`packaging/bin/verify-tools.mjs`, `docs/docs/render.md` and
`packages/render/README.md` in full and answer: does any sentence in the docs
now contradict another; is every count and name in the prose still true; does
anything reachable at runtime from `core.ts` import `three`. Fix or record
every finding the same way, then rerun the gate from Step 2 if anything
changed.

- [ ] **Step 5: Open the pull request**

```bash
git push -u origin agt_f31326c2a5b0/agent-c2a5b0
gh pr create --title "feat(render): add @prnt/dagr-render/core, a three-free entry (M5.6a)" --body-file <path to the body>
```

The body records, per `AGENTS.md`: what changed and why; the one reserved
manifest edit (`exports["./core"]`) and that the M5.6 spec's approval covers
it; that the spec and both plans ride in this pull request; the gate result
with the five commands; the `verify:tools` result; each review that ran, what
it found, and how each finding was resolved or why it was accepted. End the
body with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Wait for CI, then merge or stop**

```bash
gh pr checks --watch
```

Green CI: `gh pr merge --squash --delete-branch`. Red CI: fix on the branch as
a new commit and push. If `main` moved, rebase and push with
`--force-with-lease` to this branch only. If green cannot be reached, leave the
pull request open, write the blocker in it, and stop.

- [ ] **Step 7: Record the outcome**

Remove the claim from `dagr/workboard`. Update the brain object `dagr/explorer`:
set `status` to `m5-6a-merged` and add the pull request URL and merge commit.
Append an event to the `dagr` collection, kind `shipped`, subject `M5.6a`, with
the date, the actor, the pull request URL, and the gate result.
