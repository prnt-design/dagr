# External consumer onboarding and release handoff

Evidence checked on 2026-10-31. This is readiness work for the next release,
not publication or full mobile certification. M5.8b (viewport/occlusion) and
M5.8c (device conformance) are outstanding.

**Open release blocker:** [touch-correctness PR #196](https://github.com/prnt-design/dagr/pull/196)
repairs capture-transfer handling and camera adapter behavior. Its owner
reproduced the capture-transfer failure with isolated published 0.1.4 packages
in Chromium 148.0.7778.96: moving capture from a node to the viewport ended the
active pair and subsequent movement left the camera transform unchanged.
The reviewed correction has not merged because its local benchmark gate
failed. This fixture does not reproduce browser pointer capture and cannot
clear that blocker. Verify the merged correction in the owner's browser
reproduction and rerun this packed consumer before claiming corrected touch
behavior. Chromium reproduction is not real-device conformance evidence.

## Choose a consumer surface

For an existing React 18 application, install the scoped Explorer package:

```sh
npm install @prnt/dagr-explorer@0.1.4 react@18.3.1 react-dom@18.3.1
```

React 19 applications can use that same scoped package with matching React
19 peers. The umbrella and `@prnt/dagr-react` require React 19. Explorer's SVG
base and renderer core do not require three.js. The full renderer and
`DagrCanvas` need the documented three peer and a browser rendering backend.

```tsx
import { DagrExplorer } from '@prnt/dagr-explorer';
import type { CSSProperties } from 'react';
import '@prnt/dagr-explorer/styles.css';

const views = [{
  id: 'map', label: 'Map',
  nodes: [{ id: 'start', label: 'Start' }], edges: [],
}];

export function Map() {
  return <DagrExplorer label="Project map" views={views}
    style={{ '--dagr-explorer-height': '480px' } as CSSProperties} />;
}
```

The stylesheet import belongs in the host bundler's CSS entry if its framework
restricts component CSS imports. Keep a stable, explicitly sized graph area.
For SSR, render the same views and labels on both sides, then use the host
framework's hydration. Unmount through React so effects release their resources.
Do not import the full renderer on a server merely to access core arithmetic.
See [Explorer](../docs/docs/explorer.md) and
[mobile input policy](../docs/docs/mobile.md) before changing scroll ownership.

## Reproduce current-source adoption before a release

From a fresh checkout with Node 22 and pnpm 9:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dagr/packaging verify:tools
```

This builds and packs all seven packages, runs publint and arethetypeswrong,
installs tarballs with npm outside the workspace, and compiles/runs the public
surfaces. It also runs the minimal `fixtures/explorer` server/client pair under
React 18.3.1 and 19.2.8 without three. Each also compiles `consumer.tsx` with
matching React types, NodeNext resolution and `skipLibCheck: false`.
The verifier supplies the temporary
package manifest and installed peers; the fixture needs no source aliases.
All scratch directories are removed even when a check fails.

For an application evaluating unreleased APIs, use these locally packed
artifacts and install the matching graph/layout/render/Explorer tarballs
together. Installing only one source tarball can resolve its sibling version
ranges to registry 0.1.4. A source manifest saying 0.1.4 does not mean that
source implementation was published.

## Registry and source inventory

`npm view <package> version` reported **0.1.4** for `@prnt/dagr` and all six
scoped packages (graph, layout, render, react, vdsl, explorer). Registry
renderer, Explorer and React tarballs were downloaded with `npm pack` for the
checks below. Publication remains a maintainer action.

| Surface | Registry 0.1.4 | Current source / next release |
| --- | --- | --- |
| Explorer SVG, public CSS, SSR, inset/contentPadding | Released | Retained |
| Explorer React peers | 18.2 through 19 | Retained; external fixture pins 18.3.1 and 19.2.8 |
| Umbrella and React binding peers | React 19 | Retained |
| Renderer core | Three-free camera/path entry | Adds `createPinchGesture`, `PinchGesture`, `PinchDelta`; published core.js has no pinch export |
| Compact Explorer details | Published details implementation has no compact docking | Bottom docking below 720 CSS pixels, 44px primary controls, 16px search input |
| Touch adapters | Earlier independent input handling; capture-transfer bug reproduced in Chromium | Shared pinch/contact lifecycle; open correction in #196 remains a release blocker |
| Renderer and React fixes | See released changelogs | GPU node picking, edge retarget/empty-edge fixes, edge interaction and GPU hit-testing bindings in package Unreleased sections |

The package changelogs are the complete release-note inputs, including
[renderer](../packages/render/CHANGELOG.md),
[React](../packages/react/CHANGELOG.md), and
[Explorer](../packages/explorer/CHANGELOG.md). This table is a bounded adoption
inventory, not a substitute for reviewing every Unreleased section at release.

## Evidence and remaining validation

| Environment / backend | Evidence | Limit / next action |
| --- | --- | --- |
| Node 22.22.1, npm-installed source tarballs | Public exports and peers; publint/attw; existing type and runtime consumers | No browser/GPU creation |
| React 18.3.1 and 19.2.8, jsdom 30.0.1, Explorer SVG | Separate-process SSR, hydration identity, public search API, synthetic sizing, mount/unmount, CSS availability, three absent, core pinch/reset | DOM simulation only; no CSS layout or hardware input claim |
| Desktop Chromium SVG | Existing Explorer browser benchmark documented in Explorer guide | Prior measured desktop capacity, not this fixture's result or a mobile budget |
| Chromium touch emulation | Existing adapter tests/harnesses, separate runtime work | Does not establish iOS/Android browser behavior; no new emulation measurement here |
| WebGL 2 / WebGPU and experimental native Explorer base | Existing backend documentation and benchmark harnesses | No new external GPU/browser validation in this increment |
| Real iOS Safari and Android Chrome | Unverified here | M5.8c owner must record device/OS/browser, scroll, cancellation, focus and teardown evidence |
| Software keyboard / visual viewport / safe areas | Unverified, contract outstanding | M5.8b must establish occlusion behavior and device evidence |

Before release, integrate the touch-correctness owner's merged fixes (#196) and rerun
the packed-artifact fixture and required gates on that final tree. Record
diff/tree review resolutions, a passing five-command local gate and concluded
green CI for that head. The maintainer must choose the release version, inspect
the final changelogs and publish; no version or publish configuration is changed
by this increment. Keep device and occlusion rows unverified until measured.
