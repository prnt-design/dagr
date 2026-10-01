# M5.2a shared interaction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export controlled graph selection and click-versus-pan gestures around
a caller-supplied, revision-stamped hit provider.

**Architecture:** A DOM-free state machine owns pointer sequence transitions and
stale-target rejection. `useGraphInteraction` attaches it to a surface and
adapts browser pointer capture, controls, focus, and click suppression. The
provider owns hit geometry and the caller owns camera movement and selection.

**Tech Stack:** TypeScript, React 19, Vitest, jsdom, Docusaurus, pnpm workspace

**Spec:** `docs/superpowers/specs/2026-10-01-m5-2a-shared-interaction-design.md`

## Global constraints

- The default drag threshold is exactly 5 CSS pixels.
- Hit providers are synchronous.
- CSS coordinates are surface-relative and world coordinates use the caller's
  current displayed camera.
- `displayedRevision` changes with displayed geometry, draw order, or target
  membership, including animation frames.
- Selection is controlled. The hook stores no selected target.
- No native `DagrCanvas` hit adapter, hover, edge hit, or connection gesture.
- No em dashes in project prose.

## Review focus

- A graph edit between press and release must reject selection, even when the
  stable ID still exists.
- A stale provider cache must be rejected when its result stamp differs from
  the query revision.
- A touch drag must capture after the threshold and cancel without selection.
- An input nested in an opted-in graph target must keep native behavior.
- A port identity must compare both `nodeId` and `portId`, never only the node.

---

### Task 1: Pointer interaction state machine

**Files:**
- Create: `packages/react/src/interaction.ts`
- Create: `packages/react/test/interaction.test.ts`

**Interfaces:**
- Consumes: `GraphHitProvider<Revision>` supplied by a caller.
- Produces: `GraphHitTarget`, `GraphHitQuery`, `GraphHit`,
  `GraphHitProvider`, `GraphInteractionMachine`, and
  `createGraphInteraction`.

- [ ] **Step 1: Write failing identity and release-selection tests**

Write literal node and port cases that prove `sameGraphHitTarget` compares the
whole discriminated identity. Drive a press and release through the wished-for
machine and assert that selection happens only at release over the same target.

```ts
it('selects only after release over the pressed stable target', () => {
  const selected: Array<GraphHitTarget | null> = [];
  const machine = createGraphInteraction({
    thresholdCssPixels: 5,
    hitTarget: hitProvider,
    onSelectionChange: (target) => selected.push(target),
    onPanBy: () => undefined,
  });
  machine.pointerDown(pointer(1, 10, 20), revision);
  expect(selected).toEqual([]);
  machine.pointerUp(pointer(1, 10, 20), revision);
  expect(selected).toEqual([{ kind: 'node', nodeId: 'checkout' }]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
`pnpm --filter @prnt/dagr-react test -- interaction.test.ts`

Expected: failure because `interaction.ts` and its exports do not exist.

- [ ] **Step 3: Implement identity, query validation, and release selection**

Keep pointer state to one active primary pointer. Query on press and release.
Accept selection only when the press revision, release revision, both provider
stamps, and stable identities agree. Empty-to-empty clears selection.

- [ ] **Step 4: Add failing pan and cancellation tests**

Cover 4.99 pixels as a click, 5 pixels as a pan, the full first delta,
incremental later deltas, pointer ID mismatch, non-primary pointers,
`pointercancel`, and lost capture. Name the production branch each test catches.

- [ ] **Step 5: Run focused tests and verify RED**

Run:
`pnpm --filter @prnt/dagr-react test -- interaction.test.ts`

Expected: failures in threshold, cancellation, and pointer ownership branches.

- [ ] **Step 6: Implement pan and cancellation transitions**

Make crossing the threshold irreversible for that sequence. Return explicit
effects for focus, capture, release, dragging state, and click suppression so
the pure machine never imports DOM types.

- [ ] **Step 7: Run focused and package tests**

Run:
`pnpm --filter @prnt/dagr-react test -- interaction.test.ts && pnpm --filter @prnt/dagr-react test`

Expected: all React package tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/interaction.ts packages/react/test/interaction.test.ts
git commit -m "feat(react): define revision-safe graph gestures" \
  -m "Selection waits for release and is refused when displayed geometry or the provider stamp changes. The same state machine turns threshold movement into caller-owned CSS-pixel panning.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: React surface adapter

**Files:**
- Create: `packages/react/src/use-graph-interaction.ts`
- Create: `packages/react/test/use-graph-interaction.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createGraphInteraction`, a `RefObject<HTMLElement | null>`,
  `screenToWorld`, controlled selection, and browser pointer events.
- Produces: `useGraphInteraction<Revision>(options): void` and public option
  types.

- [ ] **Step 1: Write failing listener and native-control tests**

Mount a real React harness. Dispatch pointer events through the real surface.
Assert behavior, not listener mocks: opted-in graph buttons select, ordinary
buttons and nested inputs activate normally, and unmount stops interaction.

```tsx
useGraphInteraction({
  surfaceRef,
  displayedRevision: revision,
  screenToWorld: ({ x, y }) => ({ x: x / 2, y: -y / 2 }),
  hitTarget,
  selection,
  onSelectionChange,
  onPanBy,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
`pnpm --filter @prnt/dagr-react test -- use-graph-interaction.test.tsx`

Expected: failure because the hook is not exported.

- [ ] **Step 3: Implement browser adaptation**

Attach one effect per surface. Convert `clientX/clientY` with the current
surface rectangle, read current DPR, and call the latest callbacks through
refs. Ignore the closest native control unless it has
`data-dagr-interaction-target`. Apply machine effects with pointer capture,
focus, and `data-dagr-dragging`.

- [ ] **Step 4: Add failing touch, keyboard, and click-suppression tests**

Prove capture begins only after threshold, pointer cancellation never selects,
drag-generated click and double-click are suppressed, and a keyboard
`click` with `detail === 0` reaches the graph button.

- [ ] **Step 5: Run focused tests and verify RED, then implement**

Run the focused test before and after implementation. The first run must fail
on the unimplemented branches; the second must pass.

- [ ] **Step 6: Export the API and run package gates**

Run:
`pnpm --filter @prnt/dagr-react typecheck && pnpm --filter @prnt/dagr-react test && pnpm --filter @prnt/dagr-react build`

Expected: all three pass.

- [ ] **Step 7: Commit**

Commit with subject:
`feat(react): export controlled graph interaction`

### Task 3: Migrate the generic System Atlas

**Files:**
- Modify: `docs/src/components/GraphViewport/useGraphCamera.ts`
- Modify: `docs/src/components/GraphViewport/useGraphCamera.test.ts`
- Modify: `docs/src/components/SystemAtlas/index.tsx`
- Modify: `docs/src/components/SystemAtlas/styles.module.css`

**Interfaces:**
- Consumes: `useGraphInteraction`, the atlas camera transform, and
  `system.boxes`.
- Produces: the same atlas behavior through the public package API.

- [ ] **Step 1: Write a failing atlas-camera integration test**

Replace the camera hook's internal pointer gesture expectation with a harness
using `useGraphInteraction`. Assert that a pointer click selects once, a
threshold drag changes camera transform without selecting, ordinary toolbar
controls remain native, and a keyboard click selects.

- [ ] **Step 2: Run the docs test and verify RED**

Run:
`pnpm --filter docs test -- useGraphCamera.test.ts`

Expected: failure because the camera hook does not expose pan conversion and the
atlas does not use shared interaction.

- [ ] **Step 3: Narrow the camera hook to camera movement**

Expose caller functions for CSS-pixel panning and screen-to-world conversion.
Remove click suppression and pointer sequence ownership from
`useGraphCamera`; preserve wheel, zoom, fit, arrow keys, focus reveal, limits,
and cancellation of camera animation.

- [ ] **Step 4: Wire the atlas provider and controlled selection**

Use reverse node draw order over `system.boxes`, stamp results with a stable
display revision, opt graph buttons in with
`data-dagr-interaction-target`, and process their own `onClick` only for
keyboard activation. Preserve double-click focus through the existing caller
handler.

- [ ] **Step 5: Run docs tests, typecheck, and build**

Run:
`pnpm --filter docs test && pnpm --filter docs typecheck && pnpm --filter docs build`

Expected: all pass.

- [ ] **Step 6: Commit**

Commit with subject:
`refactor(docs): use shared atlas gestures`

### Task 4: External consumer and documentation

**Files:**
- Modify: `packaging/test/pack.test.ts`
- Modify: `packages/react/README.md`
- Modify: `docs/docs/react.md`
- Modify: `packages/react/CHANGELOG.md`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: the packed `@prnt/dagr-react` declaration entry point.
- Produces: consumer-visible examples and a compile fixture for node and port
  providers.

- [ ] **Step 1: Write the failing packed-consumer check**

Build a temporary TypeScript consumer against the extracted tarballs. Import
`useGraphInteraction` plus all public interaction types, define both target
kinds, and compile with no workspace path aliases.

- [ ] **Step 2: Run packaging test and verify RED**

Run:
`pnpm --filter @dagr/packaging test -- pack.test.ts`

Expected: failure until the consumer fixture and public declarations agree.

- [ ] **Step 3: Complete exports and consumer documentation**

Document coordinates, DPR, displayed revisions, stale rejection, controls,
keyboard behavior, `touch-action`, controlled selection, graph edits, and the
absence of native node, port, and edge adapters.

- [ ] **Step 4: Run package, docs, and packaging checks**

Run:
`pnpm --filter @prnt/dagr-react test && pnpm --filter docs test && pnpm --filter @dagr/packaging test`

Expected: all pass.

- [ ] **Step 5: Commit**

Commit with subject:
`docs(react): document shared graph interaction`

### Task 5: CPU pointer-query baseline

**Files:**
- Create: `packages/react/bench/interaction.bench.ts`
- Modify: `packages/react/package.json`
- Modify: `bench/baseline.json`
- Modify: `bench/README.md`

**Interfaces:**
- Consumes: the public query validation path and `registerControl`.
- Produces: named 100, 1,000, and 10,000 synthetic rectangle-scan entries.

- [ ] **Step 1: Write benchmark registration and validation**

Generate deterministic non-overlapping rectangles once, outside measurement.
For each iteration query a miss in reverse draw order, assert the answer is
`null`, and rotate among fixed points so an optimizer cannot replace the work
with a constant.

- [ ] **Step 2: Run the benchmark directly**

Run:
`pnpm --filter @prnt/dagr-react bench`

Expected: three interaction entries plus control and machine probes. Record
machine, backend `CPU synthetic rectangle scan`, one provider call, one
revision check, and `N` rectangle checks per query.

- [ ] **Step 3: Record the same-machine baseline**

Follow `bench/README.md`: warm up, collect repeated runs under baseline-like
load, pick the representative gated run, update only the new entries, and run
`pnpm bench:ci`. Do not change existing values to hide noise.

- [ ] **Step 4: Document measured scope and values**

Add the measured medians and limits to `bench/README.md` and the React docs.
State that this is not browser frame time, WebGPU evidence, or the M5.2b native
adapter.

- [ ] **Step 5: Commit**

Commit with subject:
`perf(react): baseline CPU pointer queries`

### Task 6: Full validation and shipping

**Files:**
- Modify as required by review findings.

**Interfaces:**
- Consumes: the complete branch.
- Produces: one review-recorded PR merged only after green CI.

- [ ] **Step 1: Run the full local gate**

Run:
`pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm bench:ci`

Expected: all five pass.

- [ ] **Step 2: Run required reviews**

Run one review over the branch diff and one over the merged tree. Add an API and
accessibility review because this changes public pointer and keyboard behavior.
Record every actionable finding and its resolution.

- [ ] **Step 3: Apply findings in follow-up commits**

Do not amend reviewed commits. Re-run focused tests and the full gate after any
code change.

- [ ] **Step 4: Rebase and revalidate**

Fetch and rebase onto `origin/main`. If the rebase changes the tree, run
`pnpm install --frozen-lockfile` and the full gate again.

- [ ] **Step 5: Open the PR and wait for concluded CI**

The PR body records design, validation, benchmark scope, diff review, merged
tree review, persona reviews, findings, and resolutions. Merge only after all
checks conclude green.

- [ ] **Step 6: Update durable state**

Release the M5.2a workboard claim, update milestone and `state.next_task` from
the merged result, append a dated event with PR and commit IDs, pin the PR, and
post the final Dispatch summary.
