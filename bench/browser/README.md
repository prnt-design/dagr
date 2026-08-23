# Browser measurements

What a browser does that the rest of `bench/` cannot reach.
`label-throughput.html` drives `@dagr/render`'s HTML overlay in a real browser
and `label-throughput.mjs` opens it, runs a plan and prints the numbers.
`card-heights.mjs` renders every campaign card and reports the tallest per kind.
`backend-probe.html` and `backend-probe.mjs` are the odd ones out and the
directory name undersells them: they do not measure anything, they CHECK
something, which is which backend `@dagr/render` comes up on and whether the
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
pnpm --filter @dagr/render build          # the page imports from dist
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
pnpm --filter @dagr/render build          # the page imports from dist
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
and `requestAdapter()` returns `null`, which is why `@dagr/render` reads the
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
