# Browser measurements

What a browser does that the rest of `bench/` cannot reach.
`label-throughput.html` drives `@prnt/dagr-render`'s HTML overlay in a real browser
and `label-throughput.mjs` opens it, runs a plan and prints the numbers.
`card-heights.mjs` renders every campaign card and reports the tallest per kind.
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
the top of the `.mjs`. Both runners here want the same two. Each plan step takes 90 frames, discards the first 30, and
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
node bench/browser/backend-probe.mjs [screenshot.png]
```

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
