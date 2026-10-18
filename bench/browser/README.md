# Browser measurements

What a browser does that the rest of `bench/` cannot reach.
`label-throughput.html` drives `@prnt/dagr-render`'s HTML overlay in a real browser
and `label-throughput.mjs` opens it, runs a plan and prints the numbers.
`card-heights.mjs` renders every campaign card and reports the tallest per kind.
`frame-profile.html` and `frame-profile.mjs` time the shape renderer's frames on
WebGPU by graph size and edge style, still and animating.
`backend-probe.html` and `backend-probe.mjs` are the odd ones out and the
directory name undersells them: they do not measure anything, they CHECK
something, which is which backend `@prnt/dagr-render` comes up on and whether the
shapes reach the canvas once it has. They live here because this is where the
browser is, and because the rule below about a committed harness applies to them
exactly as it does to a measurement.

**Nothing here is part of `pnpm bench:ci`, and it is not a gate.** The gate
compares Node medians against a committed baseline on one machine; a browser
frame time cannot join it, for the reason M4.10's roadmap entry already gives
about GPU frame times: there is no automated way to re-measure it, even on the
baseline machine. What this directory is for is answering a question once, with
numbers, and writing down how the numbers were taken so somebody can disagree
with them later.

**A harness only counts once it is in the repo.** These files are committed,
and that is the point: a measurement script kept in a scratch directory is
outside `pnpm lint`, outside `pnpm typecheck` and outside review, so every
green gate while it lives there is true and says nothing about it.
`card-heights.mjs` went red on its first lint the moment it was committed,
having "passed" for an entire review cycle from a scratchpad.

## Running the overlay harness

```
pnpm --filter @prnt/dagr-render build          # the page imports from dist
python3 -m http.server 8733               # from the REPO ROOT
node bench/browser/label-throughput.mjs '[{"count":6000,"cap":20000,"zoom":0.387}]'
```

The runner needs `playwright-core` and a Chromium; on the dispatch box that is
`~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, and the path is at
the top of the `.mjs`. The overlay harness and the other older runners want that Chromium path; the
explorer runner (`explorer-check.mjs`) instead takes `DAGR_BROWSER_DEPS` and
Playwright's own browser cache. Each plan step takes 90 frames, discards the first 30, and
reports medians; one warm-up run happens before the plan, which is the rule
`bench/README.md` already states for a capture.

Plan fields: `count` nodes registered, `cap` the overlay's element cap, `zoom`
(which decides how many of them are on screen), `pan` a multiplier on the two CSS
pixel per frame camera move (0 for a still camera), and `willChange` to promote
the layer.

## The backend probe

```
pnpm --filter @prnt/dagr-render build          # the page imports from dist
npm --prefix bench/browser install --no-save playwright-core
python3 -m http.server 8733               # from the REPO ROOT
node bench/browser/backend-probe.mjs [screenshot.png] [--headed]
```

The browser is Playwright's default Chromium (`npx playwright-core install
chromium` fetches it) unless `DAGR_CHROMIUM` names another executable.
`DAGR_CHROMIUM_ARGS` adds launch flags, split on spaces, so no flag can contain
one. A box without a GPU still needs the flags the 2026-08-23 run below used:
`DAGR_CHROMIUM_ARGS="--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader"`.
`DAGR_BROWSER_DEPS` points at a directory whose `node_modules` holds
`playwright-core`, if not this one. The output starts with the browser version,
executable, mode and flags, and the adapter's vendor and architecture, because
a backend result without them cannot be reproduced.

It builds a renderer three times, once per `backend` preference, on a fresh
canvas each time (a canvas holds one context for its whole life, so reusing one
gets a `TypeError` out of three rather than an answer about backends). For each
it reports the backend that came up, the drawing buffer size, three pixel counts
read back off the canvas, and what two of those counts SHOULD be.

**The counts are the point, and the expected areas are what make them mean
something.** "It drew", asserted from the absence of a thrown error, is a claim
an empty canvas satisfies, which is the trap D1 already named about the demo's
own check: the DOM tiers are satisfied by a blank canvas, so that check gates on
a floor over the canvas PNG. A count of amber pixels
fixes that much. A count that agrees with the area of a 90 by 50 rounded
rectangle inset by its 2 device pixel outline fixes the next question too, which
is whether the shape on screen is the shape that was asked for. Both expectations
are derived in the page from the same node records the renderer is given, so
there is no copy of the numbers to drift.

Pass a path to also write the frame as a PNG, which is drawn a fourth time and
left undisposed, because a disposed renderer releases its context and the canvas
goes white.

The page's import map is filled in by the runner from its own
`require.resolve`, so nothing here names a pnpm store path: one would carry the
three version in it and 404 silently after the next bump.

**What it found on 2026-08-23**, on this box, headless Chromium through
swiftshader with no GPU and no WebGPU adapter. `'gpu' in navigator` is `true`
and `requestAdapter()` returns `null`, which is why `@prnt/dagr-render` reads the
backend after `init()` rather than probing before it. `'auto'` came up on
`'webgl2'` and drew 10,780 pixels above the clear colour in a 480 by 320 buffer,
3,908 of them the rounded rectangle's amber fill against 3,901 of expected area,
and 2,432 the circle's blue against 2,463. `'webgpu'` was refused with
`BACKEND_UNAVAILABLE`. `'webgl2'` drew the identical counts. The frame is
`assets/screenshots/m4.9a-webgl2-shapes.png`.

Both counts run UNDER their expectation, by 0.2% on the rectangle and 1.3% on
the circle, and the direction and the ordering are both what they should be:
antialiased boundary pixels blend toward the halo and fail the hue test, and a
60 pixel circle is far more boundary per unit area than a 90 by 50 rectangle is.
A count OVER the area would be the interesting result, and it is not what
happened.

**What it found on 2026-10-17**, on an Apple M4 Mac mini (macOS 26.6.2), with
no launch flags. In Google Chrome 155.0.8059.82
(`DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`),
headless and `--headed` alike, the adapter is vendor `apple`, architecture
`metal-3`, not a fallback adapter; `'auto'` and `'webgpu'` both came up on
`'webgpu'`, and `'webgl2'` on `'webgl2'`. All three drew the same 10,780 lit,
3,908 amber and 2,432 blue pixels as the swiftshader run. Chrome for Testing
153.0.8010.12 from Playwright's cache also has the adapter. THE HEADLESS SHELL
`playwright-core` 1.60 LAUNCHES BY DEFAULT DOES NOT: on the same machine its
Chromium 148.0.7778.96 logs "No available adapters", `'auto'` falls back to
`'webgl2'` and `'webgpu'` is refused with `BACKEND_UNAVAILABLE`. So a
WebGPU result needs `DAGR_CHROMIUM` set to a full Chrome, and the `launch` and
`reported` fields are what to check before calling one.

## Backend parity (M4.9b)

```
DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node bench/browser/backend-probe.mjs --parity
```

`--parity` draws the probe scene through `'webgpu'` and through `'webgl2'` and
compares the two frames pixel by pixel. It exits non-zero unless both backends
came up as named, the comparison passes, and a control fails.

**The tolerance comes from the antialiasing ramp.** `fillCoverage` and
`outlineCoverage` in `sdf.ts` are smoothsteps one `aaWidth` wide, centred on
the shape's boundary and on the outline's inner edge, and `aaWidth` comes from
screen-space derivatives, the one input two backends may compute differently;
at zoom 1 and DPR 1 it is one device pixel. A pixel centre more than one device
pixel from both edges has coverage exactly 0 or 1 for any `aaWidth` up to 1.2
(the inner edge sits at `outlinePixels * aaWidth`, so it moves with the width),
and the glow ignores `aaWidth` while `glowWorld` exceeds it. The rest of that
pixel's colour is the same arithmetic on both backends, so it is expected to
differ by 8-bit rounding at most: 1 per channel. Inside the band any difference
is allowed, and it is counted. The page computes each pixel's distance from the
same node records the renderer draws.

**The control is what makes a pass mean something.** It reruns the comparison
with the rectangle moved a third of a device pixel on the WebGL2 side only. If
that passes, the check cannot see a real geometry error, and the run fails. It
fails through the glow: a sub-pixel shift moves the fill and outline edges only
inside the band, so a shape without glow shifted the same way would pass.

**What it found on 2026-10-17**, on the Apple M4 Mac mini in Google Chrome
155.0.8059.82, headless, no flags: the two frames are byte-identical. Of
153,600 pixels, 1,760 are in the edge band (the perimeters of the rectangle,
its outline's inner edge, the circle and its inner edge come to 877.5 pixels,
times a band two pixels wide is 1,755, which checks the page's distance
arithmetic but not that it lines up with the shader's) and 151,840 are not, and none of either
differ. The control failed as it should: 308 band pixels differ, by up to 137,
and 1,036 glow pixels away from any edge, by up to 13.

**Not a gate.** `bench/README.md`'s argument against a browser measurement in
`bench:ci` is about timings, and a parity check is not a timing, so that
argument does not carry. What does is the runner: the check needs a full Chrome
with a WebGPU adapter, and CI runs on a GitHub `ubuntu-latest` runner with no
GPU and no browser step. It is run by hand like the probe, and its scope is what it compared:
one machine, the two-shape probe scene, zoom 1, DPR 1, no edge ribbons.

## Frame profile on WebGPU (M4.10a)

```
pnpm --filter @prnt/dagr-render --filter @prnt/dagr-react build   # the page imports from dist
npm --prefix bench/browser install --no-save playwright-core
python3 -m http.server 8733               # from the REPO ROOT
DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node bench/browser/frame-profile.mjs
  # [--sizes=1000,2500] [--edges=straight,dashed,smooth] [--nodes=shapes,rich]
  # [--zoom=fit|1] [--dpr=2] [--frames=300] [--warmup=60] [--hit] [--headless]
```

`frame-profile.mjs` draws a grid of alternating rounded rectangles and circles
with about 1.3 straight edges per node, through a renderer that asks for
`backend: 'webgpu'`, so a browser without an adapter fails with
`BACKEND_UNAVAILABLE` instead of measuring the fallback. Each size, edge style
and node mode runs two modes for 300 frames after 60 of warm-up. `still` calls `render()` every frame.
`animated` also replaces every node centre and every edge route each frame
through `setNodes` and `setEdges`, which is what a consumer driving
`createSceneMotion` hands the renderer while every spring is in flight. The
arrays are built before the clock starts on those two calls and timed as
`input`. The report gives the interval between animation frames and the CPU
time of each step (and, in `rich` rows, how many overlay elements were attached
at the end of each mode), and the runner prints the machine, browser, launch
mode and adapter with them. It runs headed by default, for the pacing reason the
explorer ceiling below gives. The control, measured last, is a page moving one
8 pixel square a frame, and its median interval is the tick: "past one tick"
is the share of intervals that rounded to two ticks or more. The runner exits
non-zero if that tick is not within 10% of 60 or 120 Hz, since a throttled
control would make every row look clean.

`--edges` runs every size once per edge style, `straight` by default.
`dashed` gives the group an 8 pixel dash at half duty, and its animated mode
also flows the dash 40 pixels a second through `advanceDashFlow` and
`setEdgeStyle`, timed as `setEdgeStyle`. `smooth` sets the group's `curve` to
`'smooth'`, and because a two-point route has nothing to curve through, each
smooth edge gets a bend point 25 world units to the right of its chord's middle.

`--nodes` runs every size and edge style once per node mode, `shapes` by
default. `rich` adds M4.12's semantic zoom over the same scene:
`createRichNodes` binds a one-line title label from 24 to 160 CSS pixels and a
three-line card from 160 up, through `createHtmlOverlay` on the renderer's
camera with its default cap of 200 elements, and every frame calls
`overlay.sync()` before `render()`, timed as `sync`. Its animated mode also
moves every node's box with `setNode`, which is the `setNode` half of
`DagrCanvas`'s tier feed step when every node is in flight (the feed's own
change check is not included), timed as `richNodes`. The tier a node reaches
depends on the zoom, so the harness is run once per `--zoom`.

`--hit` adds node hit testing to every row, through `createNodeHitIndex`, the
CPU index `DagrCanvas` builds over the nodes as drawn (the page imports its
module file, since the package index imports React). Every frame queries a
pointer sweeping the viewport, with `DagrCanvas`'s 4 CSS pixel mouse tolerance,
timed as `hit`. A still frame queries one index built before the clock starts,
as `DagrCanvas`'s cache by the drawn array's identity does. An animated frame
first rebuilds the index over that frame's nodes, timed as `hitIndex`: a click
pays that on the frame it lands, and hover, which reuses an index up to 100 ms
old, on about one frame in six. The report's `hit` gives the untimed build and
how many queries, warm-up included, landed on a node.

`render()` returns once the frame is submitted, so its time is CPU time, not
GPU time. A GPU that fell behind would show in the interval, not in `render`.

**What it found on 2026-10-17**, Apple M4 Mac mini (10 cores, 16 GB, macOS
26.6.2), Google Chrome 155.0.8059.82 headed with no flags, adapter `apple`
`metal-3`, not a fallback, `renderer.backend` `webgpu` on every row, tick 16.7
ms. Viewport 1280 by 720 CSS pixels at DPR 1, camera fitted to the graph, so at
10,000 nodes a rectangle is 6.4 pixels wide. Load average 4.2 to 5.1 from other
work on the machine. Times are median / 95th percentile in milliseconds.

| Nodes | Edges | Still frame | Animated frame | Animated past one tick | `input` | `setNodes` | `setEdges` | `render` (animated) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | | 16.7 / 18.5 | | 0% | | | | |
| 1,000 | 1,281 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.1 / 0.2 | 0.3 / 0.6 | 0.3 / 0.6 | 0.2 / 0.3 |
| 2,500 | 3,238 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.2 / 0.4 | 0.6 / 1.6 | 0.8 / 1.9 | 0.2 / 0.4 |
| 5,000 | 6,551 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.4 / 0.8 | 1.3 / 2.9 | 1.3 / 1.8 | 0.2 / 0.3 |
| 10,000 | 13,169 | 16.7 / 18.6 | 16.7 / 18.4 | 0% | 0.6 / 1.0 | 2.4 / 2.7 | 2.6 / 3.3 | 0.4 / 0.5 |

A second run of the same plan matched every row to within one interval past
one tick, except 10,000 nodes animated: the load rose to 14.6 during that row,
2.7% of its intervals ran past one tick, and `setNodes` and `setEdges` reached
10.3 and 12.0 ms at the 95th percentile. At 10,000 nodes and DPR 2 the animated
frame was 16.7 / 18.5, 0% past one tick, `setNodes` 2.4 / 2.9 and `setEdges`
3.1 / 3.7. At DPR 2 and zoom 1, where a rectangle is 180 device pixels wide and
the shapes cover about 28% of the screen (40% with their glow), it was 16.7 /
18.4 and 0%.

Three things follow.

- **On this machine and this scene, 10,000 nodes animate at 60 frames a
  second on WebGPU**, still and with every node and edge moving. That is not
  M4.10: the scene has no rich nodes and no dashed or smooth edges (the
  edge-style and rich-node tables below add them) and no picking pass, and the
  GPU time per pass is not measured.
- **The CPU cost per frame is the update.** At 10,000 nodes `setNodes` and
  `setEdges` take about 5 ms together and `render` 0.4 ms of CPU, so the
  updates are what M3.9b and M4.10 should price first.
- **The tail grows under load, and it is the update that grows.** The still
  rows held one tick in both runs; the animated 10,000-node row did not when
  the machine got busy.

**Edge styles, on 2026-10-18**, same machine, browser, adapter, viewport and
zoom, `renderer.backend` `webgpu` on every row, tick 16.7 ms, load average 3.5
to 4.3. Two runs of `--edges=straight,dashed,smooth` agreed on every row
within 0.5 ms in the update medians and 0.7 points past one tick; the table is
the second. Times are median / 95th percentile in milliseconds, and `render`
is the animated mode's.

| Nodes | Edges | Style | Still frame | Animated frame | Animated past one tick | `setEdges` | `setNodes` | `render` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | | | 16.7 / 18.6 | | 0% | | | |
| 1,000 | 1,281 | straight | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 1.2 / 1.7 | 1.3 / 1.6 | 0.4 / 0.5 |
| 1,000 | 1,281 | dashed | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 1.1 / 1.6 | 1.0 / 1.5 | 0.4 / 0.5 |
| 1,000 | 1,281 | smooth | 16.7 / 18.6 | 16.7 / 18.4 | 0% | 2.5 / 4.6 | 0.3 / 0.7 | 0.2 / 0.2 |
| 2,500 | 3,238 | straight | 16.7 / 18.7 | 16.7 / 18.6 | 0% | 1.8 / 2.1 | 1.5 / 1.7 | 0.3 / 0.4 |
| 2,500 | 3,238 | dashed | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 1.8 / 2.0 | 1.5 / 1.7 | 0.2 / 0.4 |
| 2,500 | 3,238 | smooth | 16.7 / 18.7 | 16.7 / 18.4 | 0% | 5.7 / 6.0 | 0.6 / 0.7 | 0.3 / 0.3 |
| 5,000 | 6,551 | straight | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 1.5 / 2.2 | 1.8 / 3.0 | 0.2 / 0.3 |
| 5,000 | 6,551 | dashed | 16.6 / 18.7 | 16.7 / 18.7 | 0% | 1.5 / 2.1 | 1.2 / 3.0 | 0.2 / 0.3 |
| 5,000 | 6,551 | smooth | 16.7 / 18.6 | 16.7 / 18.2 | 0% | 11.9 / 12.5 | 1.2 / 1.3 | 0.4 / 0.5 |
| 10,000 | 13,169 | straight | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 3.3 / 3.8 | 2.3 / 2.4 | 0.3 / 0.4 |
| 10,000 | 13,169 | dashed | 16.7 / 18.6 | 16.7 / 18.2 | 0% | 3.3 / 3.8 | 2.2 / 2.4 | 0.3 / 0.4 |
| 10,000 | 13,169 | smooth | 16.7 / 18.6 | 33.3 / 50.0 | 81% | 25.9 / 30.7 | 2.5 / 2.7 | 0.8 / 1.0 |

`setEdgeStyle` was 0.0 / 0.1 ms or less on every dashed row. The straight rows
sit above the first slice's table at the small sizes (`setEdges` 1.2 against
0.3 ms at 1,000 nodes), and that is the machine, not the change: the first
slice's harness from `main`, run twice alternating with this one in the same
session, gave 0.7 and 1.3 ms there and 3.0 and 3.6 ms at 10,000 nodes. So
compare rows within one table, not across the two, and read `setNodes` (which
no edge style touches, and which moves by about 1 ms between rows) as noise at
that size.

- **A dash is free.** Dashed rows match straight ones in `setEdges`, `render`
  and the frame columns: the pattern is fragment arithmetic and its flow is one
  uniform a frame.
- **A smooth curve is not, and it is the CPU that pays.** Its `setEdges` grows
  about linearly with the edge count, 1.8 to 2.0 ms per thousand edges, and at
  10,000 nodes and 13,169 edges it alone is longer than a frame, so the
  animated frame drops to 30 frames a second with 81% of intervals past one
  tick. Holding the same graph still costs nothing extra: the still rows hold
  one tick, because a still frame does not tessellate.
- **The cost is the curve, not the extra point.** A one-off run of the same
  10,000-node scene with the bent routes drawn as polylines (the `smooth` edges'
  points under `straight`'s group, not a committed mode) took 4.2 / 4.7 ms in
  `setEdges`, with an animated frame of 16.7 / 18.4; smoothing the same
  points takes 25.9.

So re-tessellating smooth edges every frame is the first thing past the 60 Hz
budget at 10,000 nodes on this machine, and it is what M3.9b's fast paths and
M4.10 should price first; motion that moves only the edges whose ends moved
would pay it for those edges alone.

**Rich-node tiers, on 2026-10-18**, same machine, browser, adapter and viewport,
`renderer.backend` `webgpu` on every row, straight edges, tick 16.7 ms, load
average 3.2 to 4.3. Run once per zoom: at `fit` every node is under 24 CSS
pixels (a rectangle is 6.4 to 20 pixels wide), so no tier is open; at zoom 1
rectangles and circles are 90 and 50 pixels wide and carry labels; at zoom 2
rectangles are 180 pixels and carry cards while circles keep labels. Two runs of
`--nodes=shapes,rich` at each zoom agreed on every row's median within 0.2 ms in
`richNodes` and the animated `sync`, 0.5 ms in the still `sync` (1.0 against 0.5
at 10,000 nodes and zoom 2) and 0.7 points past one tick; the table is the
second run. Times are median / 95th percentile in milliseconds. "Elements" is
what the overlay had attached at the end of the animated mode; at zoom 1 they
are all labels, and at zoom 2 the geometry makes about half of them cards.

| Nodes | Zoom | Elements | Still frame | Animated frame | Animated past one tick | `sync` (still) | `richNodes` | `sync` (animated) | `setNodes` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | fit | 0 | 16.7 / 18.7 | 16.7 / 18.6 | 0% | 0.1 / 0.2 | 0.4 / 0.6 | 0.0 / 0.1 | 0.9 / 1.5 |
| 2,500 | fit | 0 | 16.7 / 18.6 | 16.7 / 18.7 | 0% | 0.3 / 0.4 | 0.4 / 0.9 | 0.1 / 0.2 | 1.5 / 1.6 |
| 5,000 | fit | 0 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.5 / 0.6 | 0.6 / 0.7 | 0.1 / 0.2 | 1.2 / 2.5 |
| 10,000 | fit | 0 | 16.7 / 18.6 | 16.7 / 18.2 | 0% | 1.0 / 1.1 | 1.1 / 1.3 | 0.1 / 0.2 | 2.3 / 2.4 |
| 1,000 | 1 | 86 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.1 / 0.2 | 0.4 / 0.6 | 0.3 / 0.4 | 0.8 / 1.1 |
| 2,500 | 1 | 90 | 16.7 / 18.6 | 16.7 / 18.7 | 0% | 0.2 / 0.3 | 0.3 / 1.0 | 0.1 / 0.2 | 1.4 / 1.7 |
| 5,000 | 1 | 86 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.3 / 0.5 | 0.6 / 0.7 | 0.1 / 0.2 | 1.2 / 2.6 |
| 10,000 | 1 | 88 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.6 / 0.7 | 1.3 / 1.4 | 0.2 / 0.6 | 2.3 / 2.5 |
| 1,000 | 2 | 20 | 16.7 / 18.7 | 16.7 / 18.6 | 0% | 0.1 / 0.2 | 0.4 / 0.6 | 0.1 / 0.2 | 0.8 / 1.4 |
| 2,500 | 2 | 30 | 16.7 / 18.6 | 16.7 / 18.7 | 0% | 0.2 / 0.3 | 0.4 / 0.9 | 0.1 / 0.2 | 1.4 / 1.6 |
| 5,000 | 2 | 20 | 16.7 / 18.6 | 16.7 / 18.4 | 0% | 0.4 / 0.5 | 0.7 / 0.8 | 0.1 / 0.2 | 1.2 / 2.5 |
| 10,000 | 2 | 20 | 16.7 / 18.6 | 16.7 / 18.0 | 0% | 0.5 / 0.8 | 1.2 / 1.3 | 0.1 / 0.2 | 2.3 / 2.5 |

The `shapes` rows of the second run held one tick at the 95th percentile at
every size and zoom as well (one animated row, 5,000 nodes at zoom 2, had 0.7%
of intervals past it), with `setNodes` and `render` matching the rich rows
within 0.4 ms (0.7 in the first run).

- **The tiers fit in the frame at every size measured.** No rich row's
  animated frame ran past one tick, and one still row (1,000 nodes, zoom 2) had
  a single interval past it, 0.3%, with up to 90 elements attached.
- **What they cost scales with the nodes, not with what is on screen.** At
  10,000 nodes `richNodes` is 1.1 to 1.3 ms whether 0, 20 or 88 elements are
  attached, and about 0.1 ms per thousand nodes across sizes. That is
  `setNode` re-placing two overlay entries per node; the cull in `sync`, which
  the M4.12 entry in `specs/roadmap-notes.md` prices as entries scaling with
  tiers times nodes, is 0.1 to 0.2 ms of an animated frame.
- **The still `sync` reads high, and part of that is likely the machine.** It
  is the same full scan of 20,000 entries in both modes, yet costs 0.5 to 1.0
  ms on a still frame and 0.1 to 0.2 ms on an animated one. In one-off runs at
  10,000 nodes and `fit` (not a committed mode), timing a second `sync`
  straight after the first still gave 0.7 ms, so it is not a cold first pass;
  three milliseconds of unrelated arithmetic before it brought it from 0.8 to
  0.3, and calling `setNode` for every node with its unchanged box (which
  walks every entry without re-placing any) brought it to 0.4. So a frame that
  does almost nothing else pays more for the same scan, and the still column is
  an upper bound rather than the scan's cost. The rest of the gap is not
  traced. Every entry is in view at `fit` and reaches the width gate, which is
  why those rows tend to cost the most.

So at 10,000 nodes on this machine, rich-node tiers add 1.2 to 1.5 ms to an
animated frame, on top of the 5 ms of `setNodes` and `setEdges`. Neither the
overlay's cap nor its DOM work is near a limit at a readable zoom. The part
that grows is the per-node `setNode` work, which motion that moves only the
nodes in flight would pay for those nodes alone; a spatial index in `sync`,
the remedy the M4.12 entry names, would only shorten the still frame's scan.

**Node hit testing, on 2026-10-18**, same machine, browser, adapter and
viewport, `renderer.backend` `webgpu` on every row, straight edges, shape nodes,
tick 16.7 ms, load average 3.3 to 4.3. Run once at `fit` and once at zoom 1, twice
each; the two runs agreed on every median within 0.1 ms, and the table is the
second, at `fit`. Times are median / 95th percentile in milliseconds, and the
untimed build is the one before the still mode.

| Nodes | Still frame | Animated frame | Animated past one tick | `hit` (still) | `hitIndex` | `hit` (animated) | Untimed build | `setNodes` | `setEdges` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 16.7 / 18.7 | 16.7 / 18.6 | 0% | 0.0 / 0.1 | 0.5 / 0.6 | 0.0 / 0.0 | 0.8 | 1.1 / 1.5 | 1.1 / 1.6 |
| 2,500 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.0 / 0.1 | 0.4 / 0.8 | 0.0 / 0.0 | 0.4 | 1.5 / 1.7 | 1.7 / 2.0 |
| 5,000 | 16.7 / 18.6 | 16.7 / 18.6 | 0% | 0.0 / 0.1 | 0.7 / 1.2 | 0.0 / 0.0 | 0.9 | 1.2 / 2.6 | 1.4 / 1.7 |
| 10,000 | 16.7 / 18.6 | 16.7 / 18.4 | 0% | 0.0 / 0.1 | 1.5 / 1.6 | 0.0 / 0.0 | 1.6 | 2.3 / 2.4 | 3.1 / 3.6 |

At zoom 1 every row matched these within 0.1 ms in `hitIndex` and the update
medians, also with no interval past one tick. Between 10% and 38% of queries
landed on a node, depending on size and zoom, so both the exact test and the
tolerance search ran.

- **A query is free.** It reads 0.0 ms at the median on every row because it
  is under the 0.1 ms the page's clock resolves, which agrees with the Node
  bench's 0.000083 ms in `bench/README.md`: the grid makes it independent of
  the node count.
- **Rebuilding the index is the cost, and it follows the node count.** About
  0.15 ms per thousand nodes, 1.5 ms at 10,000, close to the Node bench's
  1.86 ms. Its 99th percentile at 10,000 nodes was 1.6 to 1.8 ms, but two of
  the four 10,000-node rows had one rebuild past 7 ms (7.4 and 7.8), so a
  click on an animated frame can now and then cost half a frame.
- **It fits.** With a rebuild every frame, the animated 10,000-node frame's
  CPU steps add to about 8 ms at the median (`input`, `setNodes`, `setEdges`,
  `hitIndex`, `render`) and every row held one tick. Hover pays the rebuild on one frame in
  six, so this is the click's cost, not the hover's.

So CPU node hits are not what stands between this scene and 60 Hz at 10,000
nodes on this machine; the updates are, as the first slice found. What this
does not cover: edges and ports are not hit targets on the CPU path, and GPU
picking (M4.8b) has no pass to measure yet, so its cost is still unpriced.

Not measured yet, and the rest of M4.10a: memory per pass.
The report's `heapMb` is the page's JavaScript heap from
`performance.memory`, which Chrome rounds and which includes whatever the
previous row left for the collector, so it is not a memory figure for a pass.
Every renderer logs `THREE.AttributeNode: Vertex attribute "position" not found
on geometry.` once, which nothing here has traced yet.

## What the overlay harness measures, and what it does not

It reports `syncMedian` (the overlay's own JavaScript, from `performance.now()`
either side of `overlay.sync()`) and `frameMedian` (the interval between
`requestAnimationFrame` callbacks, which is the whole frame: the sync, the style
recalculation, the layout, the paint and the composite).

The labels overlap heavily at the low zooms that put a thousand of them on
screen, which no readable scene would do. That is deliberate: the question is
what a browser costs per element, and the separate question of how many labels
a viewport can hold at readable size is arithmetic, not a measurement (a label
about 100 by 18 CSS pixels tiles a 1200 by 800 viewport 530 times with no gaps
at all, so a real scene shows one or two hundred).

## The overlay numbers this was written for

Taken on 2026-08-14, on the dispatch box (AMD EPYC VM), headless Chromium
through swiftshader with NO GPU, a 1200 by 800 CSS pixel layer at device pixel
ratio 1. Software rasterisation makes the constants pessimistic; the shape of
the curve is what carries.

| Elements attached | `sync` median | Frame, panning | Frame, still | Frame, panning, promoted |
| --- | --- | --- | --- | --- |
| 120 | 0.2 ms | 33.3 ms | | |
| 357 | 0.2 ms | 83.3 ms | | 16.7 ms |
| 432 | 0.3 ms | | 16.7 ms | |
| 616 | 0.3 ms | 133.3 ms | | |
| 744 | 0.6 ms | | 16.7 ms | |
| 1073 | 0.5 ms | 216.7 ms | | 83.3 ms |

Every frame figure is a multiple of 16.7 ms because the browser paints on a
vsync tick, so a row is a frame count rather than a time: 83.3 ms is five ticks.
Run to run, a row moves by one tick.

Three things follow, and they are in `docs/docs/render.md` in full.

- **The overlay's own work is not the cost.** `sync()` is 0.2 to 0.6 ms at up to
  a thousand elements, under 4% of a 16.7 ms budget.
- **Holding elements is not the cost either.** 744 elements with a still camera
  hold 60 frames a second.
- **The cost is repainting text under a moving transform**, about 0.2 ms per
  element per frame here, and promoting the layer removes most of it: 357
  elements go from 83.3 ms to 16.7. The overlay still does not set
  `will-change`, because a promoted layer is rasterised once and scaled, so the
  text softens under a zoom. A consumer who pans far more than they zoom can set
  it themselves on the layer, and now knows what it buys.

## The explorer check and the SVG ceiling

`explorer-check.mjs` is the browser validation of `@prnt/dagr-explorer`
(M5.6f-2), and like `backend-probe.mjs` it CHECKS rather than measures, with
one measuring mode beside it. `explorer-ceiling-page.mjs` is the page that
mode bundles; it runs in the browser, not in node.

```
pnpm build                                   # the docs site and every dist
npm --prefix bench/browser install --no-save playwright-core esbuild
node bench/browser/explorer-check.mjs        # [--out=DIR] [--browsers=chromium,webkit] [--only=NAME]
node bench/browser/explorer-check.mjs ceiling  # [--out=DIR] [--sizes=500,1000] [--headless]
```

Neither package is a workspace dependency. Installed anywhere else, point
`DAGR_BROWSER_DEPS` at the directory whose `node_modules` holds them. The
browsers are Playwright's own, from its cache (`npx playwright-core install
chromium webkit`), not a path at the top of the file, so this one runs on a
Mac as it is. `DAGR_CHROMIUM` overrides the Chromium executable. The runner
serves `docs/build` itself on a free port and stops the server when it ends.

**The check** drives `/docs/explorer` in Chromium and WebKit, at 1440 by 900
and at 390 by 844 with touch and `isMobile`, a fresh page per check. Every
check is an assertion, and every one that could pass vacuously carries a
control that has to fail first: the focusing click is checked to focus, the
tap that only focuses is followed by one that opens, reduced motion is read
against the same zoom without it, the composited-at-rest check first sees
`will-change` while moving, the resize checks the width really changed. A
check a profile cannot run (Playwright refuses a mouse wheel in mobile WebKit,
and the desktop profiles have no touch) reports `n/a` with the reason, never
`pass`. It exits non-zero on any failure and writes `report.json` and 48
screenshots (browser, width, demo, theme, and `rest`, `zoomed` or `drawer`)
to the output directory, a temporary one by default.

The pinch is synthesized two ways: as touch pointer events dispatched in the
page, in both browsers, and in Chromium also as real touch input through the
DevTools protocol. WebKit has no protocol for it.

The overlay bound is the cap plus four, the most pins the explorer holds (the
selected node, the tab stop, the focused node and an arrow's target on its way
to focus). The last is not in the DOM, so the bound is the documented most,
and the report also lists every sample over the cap plus the pins the DOM
does show. On 2026-10-04 there was one, 202 elements with one visible pin,
during a drag that began on a node: the browser focused the node on the press,
and for one commit the set still held the tab stop it had been computed with
while the render had moved the tab stop to the focused node. The next commit
dropped it.

**What it found on 2026-10-04**, on an Apple M4 (macOS 26, Darwin 25.6),
Chromium 153 and WebKit 26.6 from Playwright 1.63: 48 results, 44 passes and
4 `n/a`, after two fixes in the package. Before them, the keyboard check failed
in both browsers at both widths, because `Escape` on a node with the drawer
open also blurred the graph and left focus on the page body; and the wheel
check failed in WebKit, because WebKit does not scroll a page whose root sets
`overscroll-behavior: none` (the docs site does) when the pointer is over a
non-passive wheel listener, even one that returns at once. Both are in the
explorer's changelog, each with its test.

**The ceiling** mode bundles the page with esbuild against the built explorer
and React 19, and for each size lays out a generated graph shaped like the
large demo's but with its layer count growing as the square root of the node
count, so every size fits the 1280 by 600 stage at about the same aspect. It
zooms in to 1.5625 times the fit (two toolbar steps; at the fit itself the
camera cannot pan at all, and at this zoom the overscan still keeps every
node in the base), presses the mouse for real, and then dispatches one
`pointermove` per animation frame from the page, for three runs of four
seconds after a warm-up. A move per frame from the runner instead made each
one a protocol round trip, and the intervals measured those.

It runs HEADED by default. Headless Chromium on this machine paced
`requestAnimationFrame` at 67 to 100 ms on a page with nothing on it but one
moving div, at every graph size alike, so a headless interval measured the
pacing and not the page. The control row is that div, measured first on every
run, and is how a reader tells which of the two a run measured. Smooth means
a 95th percentile of one frame, counted in 60 Hz ticks: the timestamps jitter
by a millisecond or two around each tick, so the control's own 95th
percentile in milliseconds is 18.2, above 16.7, on a page doing nothing.

Taken on 2026-10-04, Apple M4, 10 cores, 16 GB, macOS (Darwin 25.6),
Chromium 153 headed through ANGLE on Metal, device pixel ratio 1, at a load
average of about 4.5 from other work on the machine. Two runs agreed on every
row's tick count; the table is the second.

| Nodes | Edges | Median | 95th percentile | Frames past one tick |
| --- | --- | --- | --- | --- |
| control | | 16.7 ms | 18.2 ms (1 frame) | 0% |
| 500 | 643 | 16.7 ms | 18.3 ms (1 frame) | 0% |
| 1,000 | 1,314 | 16.7 ms | 18.3 ms (1 frame) | 0% |
| 2,000 | 2,661 | 16.7 ms | 18.1 ms (1 frame) | 0% |
| 4,000 | 5,407 | 16.7 ms | 18.4 ms (1 frame) | 1% |
| 8,000 | 10,826 | 16.7 ms | 33.4 ms (2 frames) | 11% |

**The ceiling is 4,000 nodes** with their 5,400 edges: the largest size whose
95th percentile stays within one frame. At 8,000 one frame in nine runs long.
