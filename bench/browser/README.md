# Browser measurements

What a browser does that the rest of `bench/` cannot reach.
`label-throughput.html` drives `@prnt/dagr-render`'s HTML overlay in a real browser
and `label-throughput.mjs` opens it, runs a plan and prints the numbers.
`card-heights.mjs` renders every campaign card and reports the tallest per kind.
`frame-profile.html` and `frame-profile.mjs` time the shape renderer's frames on
WebGPU by graph size, edge style, node mode and node hit testing, still and
animating, with `--memory` measure what each pass holds in GPU and heap
memory, with `--gpu` the GPU time of each pass, and with `--motion=springs`
animate through `createSceneMotion`, with `--moving` retargeting only a share
of the nodes.
`backend-probe.html` and `backend-probe.mjs` are the odd ones out and the
directory name undersells them: they do not measure anything, they CHECK
something, which is which backend `@prnt/dagr-render` comes up on and whether the
shapes reach the canvas once it has. They live here because this is where the
browser is, and because the rule below about a committed harness applies to them
exactly as it does to a measurement. `gpu-hover.mjs` and `gpu-hover-page.mjs`
check the same way that `DagrCanvas`'s GPU hit testing answers hover and
clicks at 10,000 nodes. `windows-chrome.mjs` lets the probe and
the frame profile reach a Windows GPU from WSL2.

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
`playwright-core`, if not this one. `DAGR_CDP` attaches to a Chrome that is
already running instead; see the WSL2 section below. The output starts with
the browser version, executable, mode and flags (when attached: the endpoint
and the user agent, with the flags in the helper's own output), and the
adapter's vendor and architecture, because a backend result without them
cannot be reproduced.

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

**What it found on 2026-10-26**, on a Windows machine's WSL2 (Linux 6.18,
x86_64), whose GPU is exposed only as `/dev/dxg`. Chrome for Testing
145.0.7632.6 from Playwright's cache (`chromium-1208`), with no flags, has no
adapter: `'auto'` came up on `'webgl2'` and `'webgpu'` was refused. With
`DAGR_CHROMIUM_ARGS="--enable-unsafe-webgpu --enable-features=Vulkan"`,
headless (`--headed` exits with "Missing X server or $DISPLAY"), and with
`--use-angle=vulkan`, `--use-vulkan=native` or `--ignore-gpu-blocklist`
added, the only adapter is vendor `google`, architecture `swiftshader`,
`isFallbackAdapter: true`.
Through it `'auto'` came up on `'webgpu'` and drew no pixels at all, `'webgpu'`
on the next canvas was refused with `BACKEND_UNAVAILABLE`, having come up on
`'webgl2'`, and `'webgl2'` drew
the 10,780, 3,908 and 2,432 above. The frame profile on the same flags prints
its fallback adapter message, then fails on its first measurement with
"Resulting promise was garbage collected". The installed Vulkan drivers
(Ubuntu's `mesa-vulkan-drivers` 26.0.8) have no `dzn` (Vulkan on D3D12)
driver, so Vulkan cannot see the GPU. A WebGPU result
from this WSL2 machine needs a Mesa built with `dzn`, or a Chrome on the Windows side.
The next section does the second.

### From WSL2, through the Windows side's Chrome

```
node bench/browser/windows-chrome.mjs --headless   # leave running; Ctrl-C closes Chrome
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/backend-probe.mjs --parity
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/frame-profile.mjs
```

`windows-chrome.mjs` starts Google Chrome on the Windows side through WSL's
interop, with the timing and colour switches Playwright would have passed it,
and relays its DevTools port into WSL. The relay needs Node on the Windows
side too: Chrome binds its DevTools port to Windows loopback, which WSL2 in its
default NAT networking cannot reach, so a Windows Node process dials into WSL
(which Windows can reach) and joins each dial to Chrome. Running the benches on
the Windows side's Node instead fails, because it cannot follow pnpm's
symlinks over `\\wsl.localhost`. `DAGR_WINDOWS_CHROME` and `DAGR_WINDOWS_NODE`
override the two install paths, and `DAGR_CHROMIUM_ARGS` adds Chrome flags.

`DAGR_CDP` makes either script attach to that Chrome instead of launching one,
and records `attached` and the user agent in place of the executable, mode and
flags, which the helper prints when it starts. `--headed` and `--headless`
are refused while attached, because the helper chose the mode. The page still
comes from the static server in WSL, which the Windows side reaches as
`127.0.0.1:8733`. The `machine` block of a frame profile describes WSL, where
Node runs: the CPU is the host's, the memory is the VM's share of it.

**What it found on 2026-10-26**, on a Windows 11 desktop (build 26100) with
an AMD Ryzen 9 9900X, whose integrated Radeon graphics (driver 32.0.21042.62)
is the only GPU Chrome lists beside Microsoft's Basic Render Driver. In Google
Chrome 156.0.8078.48 on the Windows side, headless, with no flags beyond the
helper's, the adapter is vendor `amd`, architecture `rdna-2`, not a fallback
adapter. `'auto'` and `'webgpu'` came up on `'webgpu'` and `'webgl2'` on
`'webgl2'`, all three drawing the 10,780, 3,908 and 2,432 above. A page opened
on `about:blank` has no `navigator.gpu` at all, since it is not a secure
context, so the adapter question has to be asked from the served page, as the
probe does. A short frame profile (1,000 nodes, 120 frames) came up on
`webgpu` on every row, with a steady headless tick of 17.6 ms, so the headless
pacing that made the frame profile run headed on the Apple M4 did not show
here; a profile meant for publication should still be compared with a headed
run. The 2026-10-26 M4.10 profile at the end of this file was taken headed,
with a tick of 17.8 to 17.9 ms.

## Backend parity (M4.9b)

```
DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node bench/browser/backend-probe.mjs --parity
```

`--parity` draws the probe scene through `'webgpu'` and through `'webgl2'` and
compares the two frames pixel by pixel. It exits non-zero unless both backends
came up as named, the comparison passes, and a control fails. It also exits
non-zero, saying why on stderr before it compares, when the adapter reports
`isFallbackAdapter`, because a software adapter such as SwiftShader comes up on
`'webgpu'` too and its frame is not a GPU's.

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

**What it found on 2026-10-26**, on the same machine in Chrome 155.0.8059.85,
headless. With no flags the frames are byte-identical again and the control
fails the same way. With `DAGR_CHROMIUM_ARGS="--enable-unsafe-webgpu
--use-webgpu-adapter=swiftshader"` the adapter is `google` `swiftshader`,
`isFallbackAdapter: true`, and the `'webgpu'` preference still comes up on
`'webgpu'`. The comparison passes there too (28 band and 56 interior pixels
differ, by 1 at most) and the control fails, so before the fallback check a
CPU-rasterised run exited 0 as if it were backend parity. It now exits 1.

**What it found on 2026-10-26 on an AMD GPU**, the Windows desktop's
integrated RDNA 2 graphics in Chrome 156.0.8078.48, headless, attached from
WSL2 [as above](#from-wsl2-through-the-windows-sides-chrome): the check passes
and exits 0. The frames are not byte-identical as on the Apple M4: 4 of the
1,760 band pixels differ, by 1, and none of the 151,840 interior pixels do. The
control fails, with 310 band pixels differing by up to 137 and 1,042 interior
pixels by up to 12.

**Not a gate.** `bench/README.md`'s argument against a browser measurement in
`bench:ci` is about timings, and a parity check is not a timing, so that
argument does not carry. What does is the runner: the check needs a full Chrome
with a WebGPU adapter, and CI runs on a GitHub `ubuntu-latest` runner with no
GPU and no browser step. It is run by hand like the probe, and its scope is what it compared:
one machine, the two-shape probe scene, zoom 1, DPR 1, no edge ribbons.

## Node picking (M4.8b)

```
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/backend-probe.mjs --pick
```

`--pick` builds a scene of five nodes, asymmetric in both axes and with one
rounded rectangle under a circle, and calls `renderer.pickNode` at every fourth
CSS pixel of the 480 by 320 canvas, a row of picks in flight at once. Each
answer is compared with the node the shapes' own distance functions put there,
the last drawn winning (rounded rects, then circles). A pointer within one
world unit of any boundary is skipped. It runs on `'webgpu'` and `'webgl2'`,
each at device pixel ratio 1 and 2, and exits non-zero on any disagreement, on
a node never hit, or on a fallback adapter, as `--parity` does.

The pass draws the world rectangle of the one device pixel under the pointer
into a one-pixel target, rather than reading one row of a full-size target,
because three 0.185's `readRenderTargetPixelsAsync` counts rows from the top on
its WebGPU backend and from the bottom on its WebGL2 backend.

**What it found on 2026-10-28**, on the Windows desktop's AMD RDNA 2 graphics
in Chrome 156.0.8078.48, headless, attached from WSL2
[as above](#from-wsl2-through-the-windows-sides-chrome), adapter `amd`
`rdna-2`, `isFallbackAdapter: false`: every run passes, 9,532 picks checked
and 68 skipped in each, none disagreeing, on `'webgpu'` and `'webgl2'` at both
ratios, with every node hit. As a control, `pickPixelBounds` was rebuilt with
its row counted from the top (`visible.minY + (bufferSize.height - 1 -
pixel.y) * height`), and every run then failed, with 544 to 546
disagreements.

This checks which node a pick names, not what a pick costs or when the pass
should run, which
["What a pick costs a frame"](#what-a-pick-costs-a-frame-m48b) prices. Hover
at 10,000 nodes is the next section.

### Hover and click at 10,000 nodes (M4.8b)

```
pnpm build
npm --prefix bench/browser install --no-save playwright-core esbuild
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/gpu-hover.mjs   # [--nodes=10000] [--samples=200] [--dpr=1,2] [--control]
```

`gpu-hover.mjs` checks the path a consumer gets rather than the pass alone:
`DagrCanvas` with `hitTesting="gpu"`, bundled with esbuild from
`gpu-hover-page.mjs` against the built packages, over a laid-out graph of
10,000 nodes (every third a circle) filling a 1280 by 720 viewport at the
fit zoom, where a rounded rect is about 8 by 3 CSS pixels. Playwright's mouse
rests on a node's centre, the run waits for `onNodeHover` to name the node,
then presses and releases and waits for `onNodeClick`; a quarter as many
samples rest on empty canvas and wait for `null` and `onBackgroundClick`.
Between samples the mouse goes to a point with the other answer, so each
sample is a change the canvas has to report. The reference is the CPU index
over the same scene nodes. A node centre is skipped when the corners of its
device pixel disagree there (ambiguous) or name no node (empty). It exits
non-zero unless the canvas came up on `webgpu` on an adapter that reports
`isFallbackAdapter: false`, with no page error, `pickNode` ran at least once
per sample, and every sample was answered correctly within 3 seconds. Console
warnings and errors are printed, not gated; a page error fails the run.
The adapter recorded is the one `requestAdapter()` returns with no options,
asked from the page; on this machine Chrome lists one GPU, so it is the
renderer's. `--control` reads the reference 9 CSS pixels right of the pointer,
about one rounded rect's pitch, and exits non-zero unless that run fails.

**What it found on 2026-10-28**, on the machine
[above](#from-wsl2-through-the-windows-sides-chrome) (AMD RDNA 2 integrated
graphics, Chrome 156.0.8078.48 headless on the Windows side, attached from
WSL2, no flags beyond the helper's), `renderer.backend` `webgpu`, adapter
`amd` `rdna-2`, `isFallbackAdapter: false`: at device pixel ratio 1 and 2,
200 node samples and 50 background samples each, every hover and every click
named the expected node or background, with 500 `pickNode` calls per run
(one for the reset move and one for the sample). 59 node centres were skipped
as ambiguous at ratio 1, none at 2, and none as empty. From the `pointermove`
to the `onNodeHover` call took 3.9 ms at the median, 4.1 ms at the 95th
percentile and 38 ms at most at ratio 1 (3.9, 4.1 and 34 ms at ratio 2), with
the canvas otherwise at rest. The page logged three's `Vertex attribute
"position" not found on geometry` warning once per run, which the frame
profile below also logs, and no page error. The control failed every one of
its 25 samples at both ratios.

This is the hover demonstration, not the pricing: the latency is what a user
waits for with nothing else moving, not what a pick costs a frame, and it
says nothing about picks run back to back under a resting mouse while the
drawing glides, or about memory. The next section prices those.

### What a pick costs a frame (M4.8b)

```
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/frame-profile.mjs \
  --sizes=10000 --edges=straight,smooth --motion=springs --pick   # [--dpr=2]
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/frame-profile.mjs \
  --memory --sizes=10000 --hit --pick                             # [--dpr=2]
```

`--pick` (described with `--hit` [below](#frame-profile-on-webgpu-m410a)) keeps
one `pickNode` in flight on every frame, the next started on the first frame
after the last settles. That is what `DagrCanvas`'s `hitTesting="gpu"` runs
while the drawing moves under a resting mouse, and the most a moving mouse can
ask of it, so it prices both ways of scheduling the pass: a pass run every
frame costs this on every frame, and a pass run on pointer moves costs this on
the frames the pointer or the drawing moves and nothing at rest.

**What it found on 2026-10-28**, on the machine
[above](#from-wsl2-through-the-windows-sides-chrome) (AMD Ryzen 9 9900X with
its integrated AMD RDNA 2 graphics), Chrome 156.0.8078.48 headed on the
Windows side, attached from WSL2, no flags beyond the helper's, adapter `amd`
`rdna-2`, `isFallbackAdapter: false`, `renderer.backend` `webgpu` on every
row, tick 17.6 to 17.8 ms, load average 0.1 to 0.5. 10,000 nodes with springs
in flight and every node moving, alternating runs without and with `--pick`:
three pairs at DPR 1 and two at DPR 2. Times are median / 95th percentile in
milliseconds. A pick's frames to settle count the animation frames between the
one that started it and its answer, so 0 means it settled before the next
frame.

| DPR | Edges | Mode | Past one tick, without | Past one tick, with `--pick` | `pick` | Picks per run | Frames to settle (median / max) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | straight | still | 0%, 0%, 0% | 0%, 0%, 0% | 0.1 / 0.2 | 357 | 0 / 3 |
| 1 | straight | animated | 0%, 0%, 0% | 0%, 0%, 0% | 0.1 / 0.2 | 343 to 345 | 0 / 2 |
| 1 | smooth | animated | 5.0%, 2.7%, 5.0% | 5.3%, 4.0%, 4.0% | 0.1 to 0.2 / 0.2 | 123 to 134 | 2 / 2 |
| 2 | straight | animated | 0%, 0% | 0%, 0% | 0.1 / 0.2 | 223 to 224 | 1 / 2 |
| 2 | smooth | animated | 6.7%, 5.3% | 3.7%, 4.0% | 0.2 / 0.2 to 0.3 | 130 to 132 | 2 / 3 |

The still rows at DPR 2 and with smooth edges matched the one shown (0% past
one tick, `pick` 0.1 / 0.2, 353 to 358 picks per run, settling in 0 frames at
the median and up to 4). Every pick settled, with no error. `render` was the
same with and without picks on every row (animated 0.5 ms straight and 1.0 to
1.1 smooth, still 0.1 to 0.2). For comparison, `--hit` on the same plan at
DPR 1, twice, rebuilt the CPU index every animated frame in 1.5 to 1.6 ms
(95th percentile 3.4 to 4.1), and the smooth rows then missed 13.0% and 14.3%
of ticks.

`--memory --pick` adds a step after the hit index that runs `--frames` picks
back to back over the still scene. Two runs at each ratio gave identical GPU
figures. The first pick leaves 196,868 bytes live: each family's pick id
attribute (three floats per instance slot, 98,304 bytes for a family's 8,192
slots), three uniform buffers and the one-pixel target, the same at DPR 1 and
2, since nothing in it is the size of the canvas. Each pick then creates a
4-byte readback buffer and destroys it once read, so 301 picks left nothing
else live. The heap retained after the step grew by 0.28 to 0.33 MB, with the
pick pass's pipelines compiled in it.

- **A pick costs 0.1 to 0.2 ms of CPU on the frame that starts it, and its
  frame-time effect did not separate from run-to-run noise.** Missed ticks
  with a pick always in flight overlapped the runs without it on every row, where rebuilding the CPU index
  every frame raised them on the smooth rows.
- **A pick's answer arrives later as the frame gets busier.** With straight
  edges a pick settled before the next frame at DPR 1 and one frame later at
  DPR 2; with smooth edges and every node moving, two frames later, so about
  one pick every three frames. That bounds how far a hover can trail a gliding
  drawing, not the frame.
- **Memory is small and fixed.** About 0.2 MB at 10,000 nodes, against the
  empty renderer's 55.3 MB of render targets at DPR 1 in the same `--memory`
  runs, with nothing retained per pick.

So the pass stays on pointer moves, as `DagrCanvas` runs it: per frame would
pay the same cost on a moving drawing and pay it at rest for nothing. The
default stays `'cpu'`. Cost does not decide it, since both fit this frame; the
GPU path's gaps do: a click while nodes glide and a press not hovered first
are ignored, and touch and pen use the CPU index anyway. This ran WebGPU only;
the WebGL2 fallback's pick cost is not measured.

**On a second GPU, 2026-10-29:** the Apple M4 Mac mini (10 cores, 16 GB,
macOS 26.6.2), Google Chrome 156.0.8078.48 headed, launched by the script
rather than attached (`DAGR_CHROMIUM` set to the Chrome binary,
`DAGR_CHROMIUM_ARGS` set to `--enable-webgpu-developer-features`, no
`DAGR_CDP`), adapter `apple` `metal-3` (`Apple M4`), `isFallbackAdapter:
false`, `renderer.backend` `webgpu` on every row, tick 16.7 ms, load average
2.9 to 5.2 with a virtual machine holding one core busy. Headless Chrome on
this machine paced the control at 33.3 ms, which the runner refuses, so
every run here is headed. The same plan, alternating runs without and with
`--pick`: three pairs at DPR 1 and two at DPR 2.

| DPR | Edges | Mode | Past one tick, without | Past one tick, with `--pick` | `pick` | Picks per run | Frames to settle (median / max) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | straight | still | 0%, 0%, 0% | 0%, 0%, 0% | 0.2 / 0.4 | 357 to 359 | 0 / 1 to 2 |
| 1 | straight | animated | 0%, 0%, 0% | 0%, 0%, 0% | 0.0 / 0.1 | 345 to 347 | 0 / 2 |
| 1 | smooth | animated | 1.3%, 1.0%, 0% | 0%, 1.0%, 0% | 0.0 to 0.1 / 0.1 to 0.2 | 245 to 295 | 0 / 2 |
| 2 | straight | animated | 0%, 0% | 0%, 0% | 0.0 / 0.1 | 347 | 0 / 2 |
| 2 | smooth | animated | 0.3%, 1.7% | 0.7%, 1.3% | 0.0 / 0.1 | 158 to 262 | 0 to 1 / 2 |

A `pick` of 0.0 is under the browser's 0.1 ms resolution. The other still
rows matched the one shown (0% to 0.7% past one tick either way, `pick`
0.2 / 0.3 to 0.4, 355 to 359 picks per run, settling in 0 frames at the
median and up to 4). Every pick settled, with no error. `render` was the same
with and without picks on every row (animated 0.3 ms straight and 0.7
smooth, still 0.4 to 0.5). The page logged the same `Vertex attribute
"position"` warning as on AMD and no page error.

`--memory --pick`, twice at each ratio, gave the AMD run's GPU figures to the
byte: the first pick leaves 196,868 bytes live at DPR 1 and 2, and each pick
creates a 4-byte readback buffer and destroys it once read, so 300 to 301
picks over 301 frames left nothing else live. The heap retained after the
step grew by 0.27 to 0.35 MB. The empty renderer held 55.3 MB of render
targets at DPR 1 and 221.2 MB at DPR 2.

- **Same conclusion on the M4.** A pick costs at most 0.2 ms of CPU at the
  median, and missed ticks with a pick always in flight overlapped the runs
  without it on every row.
- **Answers came sooner.** At the median a pick settled before the next
  frame on every row but one smooth DPR 2 run, where it took one frame; on
  AMD, smooth edges with every node moving took two. Picks per run on the
  smooth animated rows varied from 158 to 295, so a hover can still trail a
  gliding drawing by a frame or two when it is busy.

## Frame profile on WebGPU (M4.10a)

```
pnpm --filter @prnt/dagr-render --filter @prnt/dagr-react build   # the page imports from dist
npm --prefix bench/browser install --no-save playwright-core
python3 -m http.server 8733               # from the REPO ROOT
DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node bench/browser/frame-profile.mjs
  # [--sizes=1000,2500] [--edges=straight,dashed,smooth] [--nodes=shapes,rich]
  # [--zoom=fit|1] [--dpr=2] [--frames=300] [--warmup=60] [--hit] [--memory] [--headless]
  # [--gpu] [--parts=all,nodes,edges] [--motion=sway,springs] [--moving=1,0.1] [--pick]
```

`frame-profile.mjs` draws a grid of alternating rounded rectangles and circles
with about 1.3 straight edges per node, through a renderer that asks for
`backend: 'webgpu'`, so a browser without an adapter fails with
`BACKEND_UNAVAILABLE` instead of measuring the fallback. A software WebGPU
adapter, such as SwiftShader, gets past that check, because the renderer can
come up on `webgpu` through it. So when the adapter reports
`isFallbackAdapter` the runner says so on stderr before it measures, and exits
non-zero even if every row then comes up on `webgpu`. Each size, edge style, node mode, part and motion runs two modes for 300 frames after 60 of warm-up. `still` calls `render()` every frame.
`animated` also replaces every node centre and every edge route each frame
through `setNodes` and `setEdges`, from a sway computed from the clock: the
renderer's half of a frame with every spring in flight, without the scene
motion's own cost (see "Springs in flight" below for that). The
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
how many queries, warm-up included, landed on a node. With `--nodes=rich` the
still query runs just before `sync`, so do not compare those rows' still `sync`
with the rich-node table below.

`--pick` adds GPU node picks to every row through `renderer.pickNode` at the
same sweeping pointer, started after `render()` and timed as `pick`, which is
the call's synchronous part: the pick pass's draw and the readback's request.
It is timed only on frames that start a pick, and the answer's callback and
the pass's GPU time are not, so the missed ticks are what price those;
`--gpu` is refused with it, since the pick pass would land in the passes that
mode times.
One pick is in flight at a time, so a frame starts one only if the last has
settled. The report's `pick` gives, per mode and warm-up included, how many
picks started and settled, how many named a node, any errors, and how many
frames each took to settle. The runner exits non-zero if a pick failed or none
settled. With `--memory` it adds a `pick` step, which fails the run if a pick
fails; see
["What a pick costs a frame"](#what-a-pick-costs-a-frame-m48b).

`render()` returns once the frame is submitted, so its time is CPU time, not
GPU time. A GPU that fell behind would show in the interval, not in `render`;
`--gpu` (below) times the passes themselves.

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
  edge-style and rich-node tables below add them) and no GPU picking pass,
  and this slice did not measure GPU time per pass (M4.10 below does).
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
viewport, `renderer.backend` `webgpu` on every row, straight edges, shape
nodes, tick 16.7 ms, load average 3.3 to 4.3. Run twice at `fit` and twice at
zoom 1; the two runs agreed on every median within 0.1 ms, and the table is the
second, at `fit`. Times are median / 95th percentile in milliseconds. The
untimed build is the one before the still mode; the 1,000-node row's is the
page's first call of `createNodeHitIndex`, before the JIT has warmed it, which
is likely why it reads higher than 2,500 in this run.

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
- **Rebuilding the index is the cost, and it grows with the node count above
  2,500**, from about 0.5 ms at 1,000 and 2,500 nodes to 1.5 ms at 10,000,
  close to the Node bench's 1.86 ms. Its 99th percentile at 10,000 nodes was
  1.6 to 1.8 ms. The maximum reached 7.4 and 7.8 ms on two of the four
  10,000-node rows, but every other step on those rows spiked too (`setEdges`
  to 9.6 and 13.9 ms), so that looks like a pause the rebuild landed in rather
  than its own cost.
- **It fits.** With a rebuild every frame, the animated 10,000-node frame's
  CPU steps add to about 8 ms at the median (`input`, `setNodes`, `setEdges`,
  `hitIndex`, `render`) and every row held one tick. Hover pays the rebuild
  on one frame in six, so this is the click's cost, not the hover's.

So CPU node hits are not what stands between this scene and 60 Hz at 10,000
nodes on this machine; the updates are, as the first slice found. What this
does not cover: edges and ports are not hit targets on the CPU path. GPU
picking (M4.8b) is priced in
["What a pick costs a frame"](#what-a-pick-costs-a-frame-m48b).

**Memory per pass, on 2026-10-19.** `--memory` replaces the frame timing with
a step-by-step build of the same scene, roughly the order `DagrCanvas` builds
it in (which creates its overlay with the renderer rather than after the edges):
the graph, an empty renderer, its nodes, its edges, then (with
`--nodes=rich`) the rich-node tiers and (with `--hit`) one hit index, (with
`--pick`) `--frames` frames of picks back to back over the still scene, then
`--frames` frames moving only the nodes, `--frames` moving only the edges, and
`dispose`. `--warmup` does not apply. One row runs first and is not
reported, since the page's first renderer, overlay and hit index also pay for
loading and compiling what every later one reuses. After each step the runner reads two things.

- GPU memory: every buffer and texture created through
  `GPUDevice.createBuffer` and `createTexture` and not yet destroyed (by itself
  or its device), sized from its descriptor, with the methods wrapped before
  the first renderer exists. Not counted: the canvas's swap-chain texture,
  which comes from its context (about 3.7 MB a frame image at 1280 by 720 and
  DPR 1), query sets and external textures, which three does not create on this
  path, and whatever the driver adds.
- The heap after a forced collection, through `Runtime.getHeapUsage` over the
  DevTools protocol: the V8 heap plus the stores behind typed arrays, so a
  step's figure is what it retains, not what it churned. The DOM heap is read
  too but not published: it moved by up to 0.5 MB on steps that touch no DOM,
  and the same step differed between runs by up to 0.8 MB, so it is noise at
  this scale.

The runner exits non-zero if a row did not come up on WebGPU, if the adapter
is a fallback adapter, or if a texture format has no byte size in the page's
table.

Same machine, browser and adapter as above, headed, `renderer.backend`
`webgpu` on every row, viewport 1280 by 720 at DPR 1, zoom `fit`, 301 frames
per move step, load average 3.3 to 4.1. Two runs of
`--edges=straight,dashed,smooth --nodes=shapes,rich --hit` gave identical live
GPU bytes on every step except moving smooth edges, which differed by under 1
KB live (under 4 KB allocated over 301 frames), and retained heaps within 0.1
MB; the table is the second. MB is 10^6 bytes.

| Nodes | Node buffers | Edge buffers, straight | dashed | smooth | GPU bytes a frame, moving nodes | moving edges, straight | moving edges, smooth | Retained heap: graph | nodes | edges | rich tiers | hit index |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.05 | 0.22 | 0.24 | 1.20 | 0 | 0.22 | 1.22 | 0.10 | 0.19 | 0.28 | 0.98 | 0.28 |
| 2,500 | 0.19 | 0.54 | 0.60 | 3.03 | 0 | 0.54 | 3.08 | 0.24 | 0.45 | 0.79 | 2.51 | 0.69 |
| 5,000 | 0.38 | 1.10 | 1.21 | 6.13 | 0 | 1.10 | 6.16 | 0.48 | 0.88 | 1.59 | 4.99 | 1.38 |
| 10,000 | 0.75 | 2.21 | 2.42 | 12.33 | 0 | 2.21 | 12.50 | 0.96 | 1.72 | 3.23 | 9.99 | 2.76 |

The empty renderer holds 55.3 MB of textures on every row, whatever the graph:
four render targets the size of the canvas, a 4x multisampled `rgba16float`
colour target (29.5 MB) and its `depth24plus` depth (14.7 MB), and
single-sampled copies of both (7.4 and 3.7 MB). They scale with the canvas's
device pixels: one 10,000-node row at DPR 2 held 221.2 MB of them, four times
as much, with node and edge buffers unchanged. The `rich tiers` column comes
from the `rich` rows, the rest from the `shapes` rows (and the other heap
columns from the straight ones), which the `rich` rows matched within 0.04
MB. At `fit` no tier is open, so the rich tiers' figure is their bookkeeping,
not attached elements. After `dispose` no row left a GPU
byte live.

- **The render targets are most of the GPU memory, and multisampling is most
  of those.** At 10,000 nodes with straight edges the scene's buffers are 3.0
  MB against 55.3 MB of targets, and the two multisampled targets are 44.2 MB
  of them (177 MB at DPR 2). `webgpu-renderer.ts` keeps `antialias` on until a
  measurement prices it, since the SDF shapes antialias their own edges; this
  is the memory half of that measurement. The bandwidth half and the visual
  comparison are still missing, so nothing here turns it off.
- **Moving nodes allocates nothing; moving edges reallocates the whole group
  every frame.** `setNodes` writes into the buffers it has. `setEdges`
  rebuilds the group's geometry whole, as `edge-motion.ts` documents, so every
  frame creates six buffers (seven when dashed) the size of the group and
  destroys the last frame's: 2.2 MB a frame at 10,000 nodes with straight
  edges, 12.5 MB with smooth ones, which is 0.13 and 0.75 GB a second at 60
  Hz. Nothing leaks, since the live total after the step is within 0.2 MB of
  before (smooth curves tessellate to slightly more points as they sway), but
  it is allocation churn on top of the `setEdges` CPU time the edge-style
  table measures.
- **A smooth edge costs 5.6 times a straight one**, 936 bytes against 168,
  from the tessellated points; a dash adds 16 bytes an edge. Nodes are 75
  bytes each.
- **The node and edge passes keep a CPU copy of what they upload.** At
  10,000 nodes their typed arrays are 0.79 MB of the nodes' 1.72 MB of
  retained heap and 2.42 of the straight edges' 3.23 MB, about the size of
  their GPU buffers, and 13.4 of the smooth edges' 14.2 MB.
- **Rich tiers are the largest heap item without open tiers**, 1.0 KB a
  node, about ten times the graph's own arrays and 3.6 times the hit index's
  276 bytes. Every heap column grows about linearly with the node count.

Not traced: the retained heap measured after `dispose` grew from 10.6 to 12.2
MB across the 24 rows of a run, about 68 KB a row, with every renderer
disposed and no GPU byte live. It may be the page, the harness or a cache in
three or dagr; a consumer remounting `DagrCanvas` many times should not read
this as zero.

The frame-time report's `heapMb` is the page's JavaScript heap from
`performance.memory`, which Chrome rounds and which includes whatever the
previous row left for the collector, so it is not a memory figure for a pass;
the `--memory` mode is. Every renderer logs `THREE.AttributeNode: Vertex
attribute "position" not found on geometry.` once, which nothing here has
traced yet.

## GPU time per pass on WebGPU (M4.10)

```
DAGR_CHROMIUM_ARGS=--enable-webgpu-developer-features \
DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node bench/browser/frame-profile.mjs --gpu --parts=all,nodes,edges --edges=straight,smooth
```

`--gpu` adds the GPU time of every pass the renderer encodes to the frame
profile's rows. Before the first renderer exists, the page wraps
`GPUDevice.createCommandEncoder`, `GPUCommandEncoder.beginRenderPass`,
`beginComputePass` and `finish`, and `GPUQueue.submit`: every pass gets
`timestampWrites` into a query set the page owns, `finish` resolves them, and
after `submit` the page maps the result and files each pass's end minus its
beginning under the frame that submitted it. Nothing in the library changes,
and three requests every feature the adapter has, `timestamp-query` included.
Each mode reports its passes in submission order, with the encoder's label,
whether the pass resolves a multisampled target, and the median and
percentiles of its time, and `sum` adds a frame's passes together.

`--parts` draws the nodes, the edges or both (`all`, the default) over the
same graph, so a pass can be split between them by subtraction: the nodes'
share is `all` minus the edges alone, the edges' is `all` minus the nodes
alone, and what is left is the pass's own cost (its clear, its multisample
resolve and its fixed overhead). A pass is not exactly additive, so the split is
good to a few hundredths of a millisecond, not more. `--parts` other than
`all` is refused with `--hit` or `--nodes=rich`, whose node work would
otherwise run over nodes that are not drawn.

Three things about the timestamps, all seen in Chrome 155 on the Apple M4, decide
what the page uses and when the runner fails.

- **Chrome rounds them** to 65,536 ns unless WebGPU developer features are on,
  too coarse for passes that take a tenth of a millisecond. The page reports
  the largest power of two dividing every tick as `grainNs`, and the runner
  exits non-zero at 1,000 ns or more. With `--enable-webgpu-developer-features` it
  was 1 ns.
- **A pass with no draw call gets an end of 0.** That is why there is no
  `--parts` for an empty scene: its scene pass has no draw. The page files such
  a pass as `noReading`, and the runner exits non-zero if any pass has one.
- **Timestamps from different command buffers are not in submission order**,
  sometimes by hundreds of milliseconds, so the page orders passes by when they
  were submitted and never subtracts one pass's timestamp from another's.

It also exits non-zero if a pass ran without timestamps (`untimed`, with the
reason). Time spent between passes, and the queue's buffer writes from
`setNodes` and `setEdges`, are outside every pass and not counted.

**What it found on 2026-10-19**, Apple M4 Mac mini, Google Chrome
155.0.8059.82 headed with `--enable-webgpu-developer-features`, adapter `apple`
`metal-3` (`Apple M4`), not a fallback, `renderer.backend` `webgpu` on every
row, `grainNs` 1, no untimed pass and no missing reading, tick 16.7 ms, load
average 2.6 to 4.3 (read with `uptime` between runs). Every frame has two render passes: the scene, drawn into the
4x multisampled `rgba16float` target and resolved (the `resolves` flag), and
three's output pass, which draws that onto the canvas. Viewport 1280 by 720 CSS
pixels. Two runs of the DPR 1 plan agreed on every GPU median within 0.01 ms;
the table is the second. Times are the still mode's median in milliseconds. The
animated mode matched them within 0.02 ms on every row except the smooth ones
at DPR 2, which miss a tick on most frames and whose animated medians read 0.08
to 0.10 ms lower.

| Nodes | Edges | DPR, zoom | Scene pass: all | nodes alone | edges alone | Output pass | Frame `sum` | Animated past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 1, fit | 0.18 | 0.17 | 0.16 | 0.10 | 0.27 | 0% |
| 2,500 | straight | 1, fit | 0.21 | 0.18 | 0.17 | 0.10 | 0.32 | 0% |
| 5,000 | straight | 1, fit | 0.27 | 0.20 | 0.20 | 0.10 | 0.37 | 0% |
| 10,000 | straight | 1, fit | 0.40 | 0.24 | 0.27 | 0.10 | 0.50 | 0% |
| 1,000 | smooth | 1, fit | 0.21 | 0.17 | 0.19 | 0.10 | 0.31 | 0% |
| 2,500 | smooth | 1, fit | 0.29 | 0.18 | 0.24 | 0.10 | 0.39 | 0% |
| 5,000 | smooth | 1, fit | 0.42 | 0.20 | 0.34 | 0.10 | 0.52 | 0.3% |
| 10,000 | smooth | 1, fit | 0.75 | 0.23 | 0.61 | 0.10 | 0.86 | 82% |
| 10,000 | straight | 2, fit | 0.81 | 0.67 | 0.65 | 0.40 | 1.21 | 0% |
| 10,000 | smooth | 2, fit | 1.12 | 0.67 | 0.90 | 0.40 | 1.51 | 80% |
| 10,000 | straight | 2, 1 | 0.70 | 0.66 | 0.62 | 0.37 | 1.06 | 0% |
| 10,000 | smooth | 2, 1 | 0.83 | 0.66 | 0.76 | 0.37 | 1.20 | 75% |

Split by subtraction at 10,000 nodes and `fit`, in milliseconds:

| DPR | Edges | Node draw | Edge draw | Scene pass's own cost | Output pass |
| --- | --- | --- | --- | --- | --- |
| 1 | straight | 0.13 | 0.16 | 0.11 | 0.10 |
| 1 | smooth | 0.14 | 0.52 | 0.09 | 0.10 |
| 2 | straight | 0.16 | 0.14 | 0.51 | 0.40 |
| 2 | smooth | 0.22 | 0.45 | 0.45 | 0.40 |

- **The GPU is not what stands between this scene and 60 Hz.** The most any
  frame measured spends in GPU passes is 1.5 ms at the median, 10,000 nodes
  with smooth edges at DPR 2, under a tenth of the 16.7 ms tick. The rows that
  miss a tick are the animated smooth ones, and they miss it on the CPU: their
  `setEdges` is 26 ms, as the edge-style table above found.
- **At DPR 2 most of the GPU time is the canvas, not the graph.** The output
  pass and the scene pass's own cost scale with device pixels, from 0.2 ms
  together at DPR 1 to 0.9 ms at DPR 2, against 0.3 to 0.7 ms for drawing every
  node and edge. That suggests turning off multisampling would save on the
  order of half a millisecond a frame at DPR 2 on this GPU (the output pass
  would stay, and the draws' own share carries some multisample cost too),
  which is the bandwidth half of the question the memory section left open; it
  does not settle it, since the visual comparison is still missing.
- **A smooth edge costs the GPU about three times a straight one** at DPR 1,
  0.52 against 0.16 ms for 13,169 edges, from the tessellated triangles. That is
  small next to the 26 ms it costs the CPU to tessellate them every frame.
- **Drawing follows what is on screen.** At zoom 1 most of the graph is outside
  the viewport: with straight edges the node and edge shares fall to under 0.1
  ms each, and the smooth edges' share falls from 0.45 to 0.17 ms, while the
  per-pixel costs stay.

So on this machine, at 10,000 nodes, M4.10's frame is CPU-bound: about 0.5 ms
of GPU at DPR 1 and 1.2 at DPR 2 with straight edges, against 5 to 7 ms of
`setNodes` and `setEdges` on the CPU in these runs. The next section drives the
same scene through `createSceneMotion`. Still open for M4.10: recording a
local baseline (the ID buffer pass is priced in
["What a pick costs a frame"](#what-a-pick-costs-a-frame-m48b)): the scene
motion's CPU cost has Node bench entries in `bench/README.md`, outside
`baseline.json` until the maintainer records them.

## Springs in flight on WebGPU (M4.10)

```
DAGR_CHROMIUM_ARGS=--enable-webgpu-developer-features \
DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node bench/browser/frame-profile.mjs --motion=sway,springs --edges=straight,smooth --gpu
```

`--motion` picks where the animated mode's centres and routes come from, once
per value, `sway` by default. `sway` is the scripted move the sections above
measured. `springs` builds a `createSceneMotion` over the graph before the
clock starts, and every 500 ms hands it a delta moving every node and
rerouting every edge to a new sway position, timed as `apply` on the frames it
happens. Every frame then calls `advance` with the time since the last frame,
timed as `advance`, and turns its nodes and edges into scene records, timed as
`input`, before `setNodes`, `setEdges` and `render`, which is the order
`DagrCanvas`'s animation frame runs them in. With the default 0.12 s half-life
a 20 world unit move needs about a second to come to rest, so every retargeted
spring is in flight on every frame. The row's `springs` reports how many
frames, warm-up included, `advance` called settled, and how many retargets
ran. Building a retarget's delta from the sway stands in for a layout's output
and is not timed. `--moving` takes a share of the nodes, 1 by default, once
per value: each retarget then moves only the first that many nodes in row
order, a contiguous block as a local edit would move, and reroutes only the
edges touching one of them, so the rest stay at rest on their first routes. The row's `springs` reports
`movingNodes` and `movingEdges`. It takes only `--motion=springs`, and
refuses `--nodes=rich`, whose feed hands every node to the tiers each frame.
`--memory` refuses `--motion` and `--moving`.

**What it found on 2026-10-19**, Apple M4 Mac mini, Google Chrome
155.0.8059.82 headed with `--enable-webgpu-developer-features`, adapter `apple`
`metal-3` (`Apple M4`), not a fallback, `renderer.backend` `webgpu` on every
row, tick 16.7 ms, DPR 1, `fit`, load average 3.4 to 5.7 (read with `uptime`
before, between and after the runs). Two runs; the table is the second. CPU
times are animated-mode medians in milliseconds; `apply` is the median over
the retarget frames, about 10 of the 300 timed at 60 Hz. The first run
differed most at 10,000 straight nodes (interval p95 18.6, 3% past one tick),
5,000 smooth (`advance` 28.3, `setEdges` 29.3) and 2,500 smooth (23.3% past
one tick).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick | Sway past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 3.1 | 2.0 | 0.4 | 0.6 | 0.2 | 18.3 | 0% | 0% |
| 2,500 | straight | 3.1 | 1.7 | 0.5 | 1.3 | 0.2 | 18.2 | 0% | 0% |
| 5,000 | straight | 5.9 | 3.4 | 1.1 | 2.7 | 0.2 | 18.2 | 0% | 0% |
| 10,000 | straight | 13.4 | 8.8 | 1.9 | 4.7 | 0.4 | 33.3 | 7.7% | 0% |
| 1,000 | smooth | 2.5 | 3.0 | 0.2 | 4.1 | 0.2 | 18.3 | 0% | 0% |
| 2,500 | smooth | 6.8 | 8.9 | 0.5 | 9.3 | 0.3 | 34.3 | 28.3% | 0% |
| 5,000 | smooth | 24.7 | 35.2 | 1.0 | 34.5 | 0.9 | 133.3 | 94.3% | 0.3% |
| 10,000 | smooth | 34.3 | 44.0 | 2.0 | 42.5 | 1.2 | 166.7 | 99.7% | 81.7% |

- **At 10,000 nodes with straight edges the spring frame holds the tick at the
  median and misses it on every retarget and on some frames between.** A frame
  between retargets spends about 16 ms on the CPU (`advance` 8.8, `input` 0.6,
  `setNodes` 1.9, `setEdges` 4.7, `render` 0.4), at the edge of the 16.7 ms
  tick, so jitter tips some of them over. A retarget frame adds 13 to 15 ms of
  `apply` and always misses. The first run missed 3% of frames, about the
  share of retargets; the second missed 7.7%. The scripted sway at the same
  size missed none.
- **The springs, not the renderer, are the new cost.** `advance` is the
  largest per-frame step on every straight row, and `apply` is larger still on
  the frames it runs. With straight edges the
  GPU `sum` matched this run's sway rows (0.52 ms at 10,000 nodes), so there the
  motion changes what the CPU does, not what the GPU draws.
- **Smooth edges miss the tick from 2,500 nodes.** Each smooth route has a bend
  point, and the edge springs hand back more points than the route they were
  given (a bent route retargeted while still moving gained a point per
  retarget, bounded on 2026-10-20; see the next section), so
  `setEdges` has more to tessellate: at 10,000 nodes it is 42 ms
  against the sway's 26, and the GPU `sum` rises from this run's sway 0.85 to
  1.15 ms. At
  2,500 nodes `advance` and `setEdges` reach 15.1 and 16.4 ms at the 95th
  percentile.
- **`settled` stayed false** on every frame except 2 or 3 of the 360 (warm-up
  included) in the 10,000 smooth rows. The cause was not traced.

So on 2026-10-19 M4.10's number was not met with springs in flight: 10,000
nodes with straight edges held 60 Hz at the median with no headroom and dropped
a frame on each retarget and on some between, and smooth edges held it only to
1,000 nodes.
The CPU cost to cut was `advance` and `apply` in the scene motion, then
`setEdges`. Both scene motion calls now have Node bench entries at 10,000 nodes,
in `bench/README.md` under "M4.10 scene motion on the CPU".

### With in-flight route point counts bounded (2026-10-20)

A retarget in `createEdgeMotion` now drops any point of the moving polyline
that has come within the rest tolerance of the line between its neighbours and
moves with them, so a smooth route retargeted in flight no longer gains a point
per retarget (see `packages/render/src/edge-motion.ts`). Same command and Apple
M4 Mac mini, Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, one patch release past the 2026-10-19
run's 155.0.8059.82, so the straight rows, whose routes have no interior point,
are the control for the browser change. Adapter `apple` `metal-3` (`Apple
M4`), not a fallback, `renderer.backend` `webgpu` on every row, tick 16.7 ms,
DPR 1, `fit`, load average 3.7 to 4.2.
Springs only, since the sway path is unchanged. Two runs; the table is the
second, in the 2026-10-19 table's units. The first differed most at 10,000
straight nodes (4% past one tick) and 10,000 smooth (`apply` 21.8, 97.7% past
one tick).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 3.8 | 2.0 | 0.5 | 0.8 | 0.3 | 18.2 | 0% |
| 2,500 | straight | 3.4 | 1.9 | 0.4 | 1.0 | 0.2 | 18.1 | 0% |
| 5,000 | straight | 5.9 | 4.2 | 0.9 | 1.8 | 0.2 | 18.1 | 0% |
| 10,000 | straight | 14.0 | 8.3 | 1.9 | 3.3 | 0.4 | 18.5 | 1.7% |
| 1,000 | smooth | 2.2 | 1.3 | 0.2 | 2.1 | 0.2 | 18.0 | 0% |
| 2,500 | smooth | 4.4 | 3.3 | 0.5 | 5.5 | 0.3 | 18.2 | 0% |
| 5,000 | smooth | 9.8 | 7.0 | 0.9 | 10.2 | 0.4 | 33.4 | 24.3% |
| 10,000 | smooth | 18.9 | 14.6 | 1.9 | 23.3 | 0.7 | 66.7 | 94.7% |

- **Smooth edges now hold the tick to 2,500 nodes**, where 28.3% of frames
  missed it before. At 10,000 nodes `advance` fell from 44.0 to 14.6 ms and
  `setEdges` from 42.5 to 23.3, and the GPU `sum` from timestamp queries fell
  from 1.15 to 0.98 ms, but the frame still misses almost every tick.
- **Straight rows moved little**: a two-point route has no interior point to
  gain or drop. At 10,000 nodes `setEdges` read 3.3 to 3.4 against 4.7 and
  past one tick 1.7% and 4% against 3% and 7.7%, so a small part of the smooth
  rows' gain may be the browser or the machine's load rather than this change.
- **`settled` stayed false** on every frame of every row.

M4.10's number is still not met with springs in flight. At 10,000 nodes the
CPU cost is now `setEdges` and `advance` with smooth edges, and `apply` and
`advance` with straight ones.

### With typed-array tessellation (2026-10-20)

`tessellateRibbons` now writes into typed arrays that double when full, where
it pushed onto `number[]` and converted at the end, and checks a point is finite
before building the message that would reject it. The output is byte-identical.
In Node on the same machine, the 10,000-node smooth graph above with its
static bend points (13,169 routes, 263,382 vertices) tessellates in 18.7 ms
where it took 32.2, and `SceneEdges.setEdges` takes 21.3 where it took 33.8
(means of 20 calls after 5 warm-up calls, timed with `performance.now()` in a
scratch Vitest file; there is no committed bench entry for it).

Same command, machine, browser and adapter as the section above, `renderer.backend`
`webgpu` on every row, load average 3.1 to 4.6. Springs only. Two runs; the
table is the second. The first differed most at 10,000 straight nodes (2.3%
past one tick) and 5,000 smooth (14.3%).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 2.4 | 1.8 | 0.3 | 0.5 | 0.2 | 18.1 | 0% |
| 2,500 | straight | 3.3 | 1.7 | 0.5 | 1.1 | 0.2 | 18.1 | 0% |
| 5,000 | straight | 6.1 | 3.6 | 1.0 | 2.1 | 0.3 | 18.3 | 0% |
| 10,000 | straight | 13.3 | 9.5 | 1.9 | 3.1 | 0.4 | 33.3 | 6.7% |
| 1,000 | smooth | 2.2 | 1.3 | 0.2 | 2.1 | 0.2 | 18.0 | 0% |
| 2,500 | smooth | 4.4 | 3.7 | 0.5 | 5.3 | 0.3 | 18.3 | 0% |
| 5,000 | smooth | 9.9 | 7.7 | 1.0 | 9.3 | 0.4 | 34.0 | 24.3% |
| 10,000 | smooth | 18.8 | 16.1 | 2.0 | 19.9 | 0.7 | 66.9 | 91% |

- **At 10,000 smooth nodes `setEdges` fell from 23.3 to 19.9 ms** (19.4 in
  the first run), a 3.4 ms drop against 12.5 in Node. The springs' routes are
  not the static ones the Node figure used, and why the browser gains less was
  not traced. The frame still misses almost every tick: `advance` and
  `setEdges` together are about twice it.
- **Straight rows are within the previous section's run-to-run spread**, as
  they should be: a two-point route spends little time in the tessellator.

`setEdges` is still the largest per-frame step at 10,000 smooth nodes. Where
the rest of it goes has not been profiled; the candidates are the curve
flattening, the walk's per-segment records, and building a new geometry on
every call.

### With centrelines in reused coordinate arrays (2026-10-20)

A CPU profile in Node of `SceneEdges.setEdges` and `tessellateRibbons` on the
same 10,000-node smooth graph (static bend points, 13,169 routes) put the
garbage collector first, at 17% of samples, then the centreline cleaning, the
flattening's chord test and the walk's per-segment records. Every point of a
smooth route was an object, made by the flattening, again by the second clean
and once more inside a segment record. `tessellateRibbons` now carries each
route through those steps in two `Float64Array`s reused from route to route,
and makes no `Vec2` per point. The output is byte-identical: sha256 of every
array and the ranges matched over these routes and 4,000 random ones
(including duplicate and near-duplicate points) under six option sets, and
`shapeEdgePath`, `smoothCentreline` and the non-finite error message matched
too. In Node, alternating the old and new build three times at load 3.0 to
3.3, medians of 60 calls after 10 warm-up calls in a scratch script (there is
still no committed bench entry): tessellation took 17.3 to 21.0 ms before and
13.8 to 13.9 after, `SceneEdges.setEdges` 21.9 to 25.3 before and 15.9 to
16.1 after. The garbage collector fell to 7% of samples; what is left is
arithmetic, the flattening (21%) and the walk (17%) first.

Same command, machine, browser and adapter as the sections above,
`renderer.backend` `webgpu` on every row, load average 3.0 to 4.2. Springs
only. Two runs; the table is the second. The first differed most at 5,000
smooth nodes (10% past one tick), 10,000 straight (5.7%) and 10,000 smooth
(`setEdges` 15.7).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 3.1 | 2.0 | 0.5 | 0.6 | 0.3 | 18.2 | 0% |
| 2,500 | straight | 3.2 | 1.9 | 0.4 | 0.7 | 0.2 | 18.3 | 0% |
| 5,000 | straight | 7.7 | 3.6 | 0.9 | 1.4 | 0.3 | 17.9 | 0% |
| 10,000 | straight | 12.8 | 8.5 | 1.9 | 2.3 | 0.4 | 18.5 | 2.3% |
| 1,000 | smooth | 2.5 | 1.3 | 0.2 | 1.6 | 0.2 | 18.2 | 0% |
| 2,500 | smooth | 4.6 | 3.2 | 0.4 | 3.9 | 0.3 | 17.9 | 0% |
| 5,000 | smooth | 9.2 | 7.1 | 0.9 | 7.2 | 0.4 | 20.6 | 4.3% |
| 10,000 | smooth | 18.5 | 14.5 | 1.9 | 16.4 | 0.7 | 66.5 | 90.3% |

- **At 10,000 smooth nodes `setEdges` fell from 19.9 to 16.4 ms** (15.7 in
  the first run), and at 5,000 from 9.3 to 7.2. The 5,000 smooth row missed
  4.3% of ticks where the previous section's missed 24.3%, though the first run
  here missed 10%, so part of that is run-to-run spread.
- **10,000 smooth nodes still miss 90% of ticks**: `advance` (14.5 ms) and
  `setEdges` (16.4) are each about one tick on their own.
- **Straight rows are within the earlier sections' run-to-run spread**, and
  the GPU `sum` matched the previous section's on every row (0.98 ms at
  10,000 smooth nodes).

At 10,000 smooth nodes `setEdges` and the scene motion's `advance` now cost
about the same. What is left of `setEdges` is the flattening and walk
arithmetic and building a new geometry on every call; the browser profile of
it has not been taken.

### With the spring step built once per frame (2026-10-20)

A CPU profile in Node of the scene motion's `advance` at 10,000 smooth nodes
put the spring step first: every spring axis recomputed eight logarithms and
exponentials that depend only on the half-life and the frame's `dt`, and built
small arrays for each linear combination, so the garbage collector took 17%
of samples. `advance` now builds those coefficients once per frame
(`springStep` in `packages/render/src/spring.ts`) and steps each spring
without allocating per axis. Frames are byte-identical: sha256 of every frame
matched across three half-lives, both edge styles and clocks from 0 to
10^7 s, and of `stepSpring` and `stepSpring2D` over overflow and underflow
inputs. Node bench figures are in `bench/README.md`.

Same command, machine, browser and adapter as the sections above,
`renderer.backend` `webgpu` on every row, load average 3.8 to 8.2 (8.2 at the
start of the first run). Springs only. Two runs; the table is the second. The
first differed most at 10,000 smooth nodes (59.3% past one tick) and 5,000
smooth (0%).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 4.2 | 0.9 | 0.6 | 0.8 | 0.4 | 18.1 | 0% |
| 2,500 | straight | 4.0 | 1.6 | 0.7 | 0.5 | 0.2 | 18.2 | 0% |
| 5,000 | straight | 5.8 | 1.1 | 0.9 | 1.0 | 0.2 | 18.1 | 0% |
| 10,000 | straight | 11.9 | 2.4 | 1.9 | 2.5 | 0.4 | 18.2 | 0% |
| 1,000 | smooth | 2.6 | 0.9 | 0.4 | 1.8 | 0.2 | 18.1 | 0% |
| 2,500 | smooth | 4.5 | 1.0 | 0.4 | 3.9 | 0.3 | 18.2 | 0% |
| 5,000 | smooth | 11.0 | 1.8 | 0.9 | 7.4 | 0.4 | 18.2 | 0.3% |
| 10,000 | smooth | 18.4 | 4.1 | 1.9 | 16.5 | 0.7 | 49.5 | 53% |

- **At 10,000 nodes `advance` fell from 8.5 to 2.4 ms with straight edges and
  from 14.5 to 4.1 with smooth ones.** The straight rows missed no tick in
  either run, where the previous section's missed 2.3% and 5.7%: the frames
  between retargets now have headroom, and the retarget frames' `apply` (11.9
  to 12.3 ms) fits beside them.
- **10,000 smooth nodes miss about half the ticks** (53% and 59.3%, from
  90.3%). `setEdges` (16.5 ms) is about one tick on its own, and `apply` (18.4)
  is more than one on the frames it runs.
- **The GPU `sum` matched the previous section's on every row** (0.98 ms at
  10,000 smooth nodes), as it should: nothing drawn changed.

With straight edges, 10,000 nodes now hold 60 Hz with springs in flight in
these two runs. With smooth edges the CPU cost left is `setEdges` on every
frame and `apply` on retarget frames.

### With the tessellation sized from the previous frame (2026-10-21)

A CPU profile in Node of `SceneEdges.setEdges` on the 10,000-node smooth graph
(static bend points, 13,169 routes, 263,382 vertices) put the garbage
collector at 10.4% of samples and the builder's array growth at 4.1%: every
call started the builder at 4,096 vertices and doubled it seven times. Each
edge group now remembers how many vertices and indices its last call made, and
the next call starts its arrays there plus an eighth. The output is
byte-identical: sha256 of every array and the ranges matched the previous
build over these routes and 4,000 random ones under six option sets, with each
call hinted from the one before. In Node, alternating the old and new build
three times at load 4.7 to 4.9, medians of 60 calls after 20 warm-up calls in
a scratch script (still no committed bench entry): `SceneEdges.setEdges` took
16.7 to 17.4 ms before and 14.2 to 14.3 after. The garbage collector fell to
6% of samples and the growth left the profile; what is left is arithmetic,
the flattening (20%), the walk (17%) and the centreline cleaning (9%) first.

Keeping one builder per group instead, which the first version of this change
did, was as fast but held each group's largest arrays for its whole life: on
`--memory` (same machine and browser) the 10,000-node smooth edges' retained
heap went from 14.2 to 29.8 MB. With the hint it is 14.1, within 0.1 MB of
the 2026-10-19 section's 14.2, and the other rows match that section too.

Same command, machine, browser and adapter as the sections above,
`renderer.backend` `webgpu` on every row, load average 3.3 to 4.4. Springs
only. Two runs; the table is the second. The first differed most at 10,000
smooth nodes (`apply` 21.3, `setEdges` 16.0, 52% past one tick).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 4.1 | 1.0 | 0.6 | 0.8 | 0.4 | 18.2 | 0% |
| 2,500 | straight | 3.2 | 0.8 | 0.5 | 0.7 | 0.2 | 18.2 | 0% |
| 5,000 | straight | 6.4 | 1.6 | 0.9 | 1.4 | 0.2 | 18.2 | 0% |
| 10,000 | straight | 12.3 | 2.7 | 1.9 | 2.7 | 0.4 | 17.9 | 0% |
| 1,000 | smooth | 3.2 | 0.7 | 0.3 | 1.6 | 0.2 | 18.0 | 0% |
| 2,500 | smooth | 4.6 | 1.2 | 0.4 | 3.9 | 0.3 | 18.3 | 0% |
| 5,000 | smooth | 8.2 | 2.2 | 0.9 | 7.1 | 0.4 | 18.3 | 0% |
| 10,000 | smooth | 17.7 | 5.6 | 1.9 | 15.8 | 0.7 | 50.0 | 53.3% |

- **The browser gain is about 1 ms, smaller than Node's 3.** Against the
  previous section's 16.5 ms, `setEdges` at 10,000 smooth nodes read 15.8 and
  16.0, and the share of ticks missed did not move (52% and 53.3%, against
  53% and 59.3%). Run back to back with only that row, alternating three
  times, the old build read 15.6 to 16.1 ms and this one 14.5 to 15.5. The
  springs' route sizes change from frame to frame, which the static Node scene
  does not. `advance` read 5.6 against the previous section's 4.1 with no
  change to it, which is load spread.
- **Straight rows and the GPU `sum` are within the earlier sections'
  run-to-run spread** (0.97 to 0.98 ms at 10,000 smooth nodes), as they should
  be: nothing drawn changed.

10,000 smooth nodes still miss about half the ticks: `setEdges` is about one
tick on its own, and a retarget frame adds 17.7 to 21.3 ms of `apply`.

### With the flatness and cleaning tests decided from squares (2026-10-21)

The flattening's flatness test and the cleaner's minimum-length test each
called `Math.hypot` once per point, about 8 ns a call in Node against 0.65 for
`Math.sqrt(x * x + y * y)`. The two disagree in the last bit for about 38% of
inputs, so swapping one for the other would change the output, but both tests
only compare: the length goes nowhere else. They now answer from the square
whenever it clears the threshold by a relative margin of 1e-9, a million times
either function's rounding error, and call `Math.hypot` only inside that
margin, where squaring would underflow or overflow, or for a segment the
cleaner drops. The output is
byte-identical: sha256 of every array and the ranges matched the previous
build over the 10,000-node smooth routes and 4,000 random ones under six option
sets, and again with the random routes scaled by 1e-12, 1e-3, 1e6 and 1e140.
The new tests compare both decisions against `Math.hypot` at the threshold
itself and at the extremes, and fail with the margin set to zero.

In Node, `tessellateRibbons` alone on the same 13,169 smooth routes, hinted
from the call before, alternating the old and new build three times at load 3
to 4, medians of 60 calls after 20 warm-up calls in a scratch script: 12.8 to
12.9 ms before, 10.4 to 10.6 after. These profile shares are of
`tessellateRibbons` samples, not of `SceneEdges.setEdges` as in the section
above: the flattening fell from 25% to 16% and the cleaning from 10% to 6%,
and the walk, counted here with the vertex and triangle writes it calls
(`tessellateCentreline` alone is 22%), is now the largest cost at about 46%.

Same command, machine, browser (Chrome 155.0.8059.85) and adapter as the
sections above, `renderer.backend` `webgpu` on every row, load average 2.9 to
3.3. Springs only. Two runs; the table is the second. The first differed most
at 10,000 smooth nodes (`apply` 21.0, `setEdges` 13.2, 37.3% past one tick).

| Nodes | Edges | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | straight | 4.8 | 0.9 | 0.7 | 0.8 | 0.4 | 18.4 | 0% |
| 2,500 | straight | 4.9 | 1.5 | 0.6 | 0.6 | 0.2 | 18.3 | 0% |
| 5,000 | straight | 6.2 | 1.1 | 0.9 | 1.2 | 0.2 | 17.9 | 0% |
| 10,000 | straight | 13.2 | 2.3 | 1.9 | 2.4 | 0.3 | 18.2 | 0% |
| 1,000 | smooth | 3.1 | 0.8 | 0.4 | 1.7 | 0.2 | 18.2 | 0% |
| 2,500 | smooth | 4.7 | 1.0 | 0.4 | 3.2 | 0.3 | 18.1 | 0% |
| 5,000 | smooth | 8.7 | 2.0 | 0.9 | 6.3 | 0.4 | 18.0 | 0% |
| 10,000 | smooth | 20.3 | 4.5 | 1.9 | 13.1 | 0.7 | 34.5 | 38.0% |

- **`setEdges` at 10,000 smooth nodes is about 2 ms faster.** Run back to
  back with only that row, alternating three times at load 3.1 to 4.5, the old
  build read 14.7 to 15.3 ms and this one 12.8 to 13.0. The share of ticks
  missed in those runs was 46% to 54% for the old build and 41% to 44% for
  this one; `advance` moved between 3.8 and 6.1 ms across the six runs with no
  change to it, so the tick count is the noisier of the two numbers.
- **The GPU `sum` matches the earlier sections** (0.97 to 0.98 ms at 10,000
  smooth nodes): nothing drawn changed. The straight rows match too, except
  `apply` at 1,000 and 2,500 nodes (4.8 and 4.9 against at most 4.2), a median
  of about ten retarget frames in code this change does not touch.

10,000 smooth nodes still miss more than a third of the ticks: `setEdges` is
most of a tick on its own, and a retarget frame adds about 20 ms of `apply`.

### With the walk writing a rib and a quad at a time (2026-10-21)

The walk wrote each rib as two `vertex` calls and returned a `{ left, right }`
object, and each quad as two `triangle` calls, so every centreline point paid
an allocation and four capacity checks. A rib is now the index of its left
vertex (the right one is always the next), written by one call with one check,
and a quad is six indices behind one check; a fanned corner no longer collects
its facets in an array first. Nothing computed changed, only where it is
written from, and the output is byte-identical: the same sha256 over every
array and the ranges as the previous build, on the 10,000-node smooth routes
and 4,000 random ones under six option sets, and on the random routes scaled
by 1e-12, 1e-3, 1e6 and 1e140. The new test covers the one new case, a rib
that starts with a single free slot before the arrays grow, and fails with a
capacity check that only grows on a full array.

In Node, `tessellateRibbons` alone on the same 13,169 smooth routes, measured
as in the section above, alternating the old and new build three times at load
3.9: 10.7 to 11.0 ms before, 9.8 to 10.6 after. What is left of the
walk's own time is mostly its two `Math.hypot` calls per point, the segment's
length and the bisector's, and both values reach the output, so the squares
trick of the section above does not apply to them.

On WebGPU, same machine, browser (Chrome 155.0.8059.85, headed,
`--enable-webgpu-developer-features`) and adapter (`apple` `metal-3`, not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes only, old and new build alternated three times by swapping
`packages/render/dist/ribbon.js`, load average 3.5 to 5.0 with another
process using about 1.5 cores throughout:

| Build | `setEdges` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 12.9, 13.0, 13.0 | 6.9, 6.2, 6.2 | 23.2, 24.3, 23.4 | 49.0%, 46.3%, 44.0% |
| this one | 11.8, 11.7, 11.9 | 6.1, 6.1, 5.0 | 23.4, 23.3, 22.7 | 39.3%, 39.0%, 34.3% |

- **`setEdges` is about 1.1 ms faster**, more than Node's 0.3 to 1.0 in
  back-to-back pairs. The GPU `sum` read 0.86 ms in all six runs, old build
  and new alike, so nothing drawn changed. It is lower than the 0.97 to 0.98
  of the full runs above, which ran every size in one session; these runs do
  not isolate why.
- **The ticks missed fell by about ten points**, though `advance` (untouched
  here) moved by over a millisecond between runs, so that is the noisier of
  the two numbers.

10,000 smooth nodes still miss more than a third of the ticks. The largest
single cost left is a retarget frame's `apply`, about 23 ms here.

### With the edge motion's error labels built on failure (2026-10-21)

A CPU profile of the edge half of `apply` (about 85% of it at 10,000 smooth
nodes in Node) put a quarter of its time in the garbage collector. The checks
that guard a retarget built their error messages before checking: a label per
coordinate in `requireRoute`, and four per point and axis in
`prepareRetarget`'s spring coefficient checks, about 30 strings per smooth
edge that nobody read. Each check now runs on the numbers first and builds its
label only when it fails, so the messages are unchanged. A finite
`velocity + w * displacement` stands for the three coefficient checks, since
no non-finite term sums to a finite value. Frames are byte-identical: the same
sha256 over 240 frames of the 10,000-node smooth scene, retargeted every 30
frames while in flight, under the old and new build.

On WebGPU, same machine, browser (Chrome 155.0.8059.85, headed,
`--enable-webgpu-developer-features`) and adapter (`apple` `metal-3`, not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes only, old and new build alternated three times by swapping
`packages/render/dist/edge-motion.js`, load average 3.8 to 4.8:

| Build | `apply` | `advance` | `setEdges` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 22.8, 23.3, 23.0 | 6.0, 6.0, 5.9 | 12.0, 12.1, 11.7 | 38.7%, 39.3%, 35.0% |
| this one | 19.9, 19.2, 20.9 | 3.8, 3.8, 4.2 | 12.0, 11.9, 12.4 | 25.7%, 25.3%, 30.3% |

- **`apply` is about 3 ms faster**, in line with Node (see `bench/README.md`).
  The GPU `sum` read 0.97 to 0.98 ms in all six runs.
- **`advance` fell by about 2 ms too**, though nothing it runs changed, and the
  Node bench's `advance` did not move. Less garbage from each retarget leaving
  less collection for the frames between is the likely reading; it was not
  traced.

10,000 smooth nodes still miss a quarter of the ticks, and a retarget frame's
`apply`, about 20 ms, is still the largest single cost.

### With an edge retarget's sampled points shared (2026-10-22)

A CPU profile of `apply` at 10,000 smooth nodes in Node still put a fifth of
its time in the garbage collector, and about as much in the edge half's map
bookkeeping. A retarget resampled the current polyline, its velocities and
the new route, and copied every point it sampled, though nothing in the module
ever changes a `Vec2` after making it. The samples are now the same objects
they were sampled from, so the springs, targets and drawn points share them;
`alignRoutes`, which hands its result to a caller, copies it there. A removal
or a reroute now carries its entry and its prepared transition from the plan
to the commit, instead of the commit looking every id up again and a second
map holding the transitions. Frames are byte-identical: the same sha256 over
240 frames of 10,000 nodes, straight and smooth, with three and four point
routes mixed and retargeted every 30 frames while in flight, under the old and
new build.

On WebGPU, same machine, browser (Chrome 155.0.8059.85, headed,
`--enable-webgpu-developer-features`) and adapter (`apple` `metal-3`, not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes only, old and new build alternated three times by swapping
`packages/render/dist/edge-motion.js`, load average 3.4 to 5.0:

| Build | `apply` | `advance` | `setEdges` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 18.8, 18.4, 19.2 | 5.6, 3.8, 4.0 | 11.9, 12.3, 11.9 | 35.3%, 27.0%, 24.7% |
| this one | 17.1, 17.1, 17.2 | 3.3, 4.5, 3.4 | 12.4, 11.6, 12.3 | 26.0%, 26.3%, 24.7% |

- **`apply` is about 1.7 ms faster**, in line with Node's gain of about 2 ms
  with smooth edges (see `bench/README.md`). The GPU `sum` read 0.97 to 0.98 ms in
  all six runs.
- **The ticks missed did not clearly move.** Retargets were 16 or 17 of each
  run's 360 frames, so most of the missed ticks are frames between
  retargets, which spend about 4 ms in `advance`, 12 in `setEdges` and 2 in
  `setNodes` at the median.

So the next cost to cut for the 60 Hz number is the per-frame `setEdges`, not
the retarget frame.

### With `setEdges` copying less per frame (2026-10-22)

A CPU profile of `setEdges` on the 13,169 smooth routes in Node put its time
in the flattening (about 30%) and the walk (about 23%), both tightened by the
sections above, and found two copies that nothing needed. `setEdges` mapped
every edge to a new `{ id, points }` object, though a `SceneEdge` is already
a route, and `tessellateRibbons` trimmed its five builder arrays with `slice`,
which copies about 9 MB per frame at this size. The edges now go in as they
are, and each array comes back as a `subarray` view of exactly its counts
when the builder buffer behind it is at most a quarter longer, and as a
trimmed copy otherwise. Both backends upload a view by its own range. A call
starting from the last frame's counts, as every frame of an animation does,
sizes its buffers an eighth above them and gets views, unless the scene shrank
by more than about a tenth or outgrew the hint. A group's first build starts
from nothing, doubles its way up and can end nearly twice as long, and keeping
that alive for as long as the geometry is drawn is the retained heap the
section above rejected, so it is copied. Output is byte-identical: the same
sha256 over every array and the ranges as the previous build, on the
10,000-node routes, polyline and smooth, at two offsets.

In Node, one `setEdges` on those routes, alternating the old and new build
four times at load 3 to 4: 10.01 to 10.28 ms before and 9.08 to 9.30 after
with every route swaying by a different amount each frame, all 40 frames
returning views. With static bends, an earlier version that always returned
views read 10.32 to 10.52 before and 9.90 to 10.10 after over five pairs.
What is left is the tessellation itself.

On `--memory` (same machine and browser), the 10,000-node smooth edges'
first build retains 14.4 MB against 14.2 before, since a first build copies.
The rebuild that follows (`moveEdges`) retains 1.1 MB against 0.2, the
eighth of headroom over about 9 MB of arrays, held until the next
`setEdges`. GPU buffers are sized from the view and did not change.

On WebGPU, same machine, browser (Chrome 155.0.8059.85, headed,
`--enable-webgpu-developer-features`) and adapter (`apple` `metal-3`, not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes only, old and new build alternated three times by swapping
`packages/render/dist/ribbon.js` and `scene-edges.js`, load average 2.9 to
4.2:

| Build | `setEdges` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 11.9, 11.5, 11.7 | 3.4, 4.7, 5.4 | 17.9, 17.4, 17.5 | 21.3%, 27.0%, 32.7% |
| this one | 11.3, 11.4, 11.2 | 3.5, 5.6, 4.6 | 17.7, 17.2, 17.8 | 19.3%, 32.3%, 26.0% |

- **`setEdges` is about 0.4 ms faster**, less than Node's 0.9. The earlier
  always-a-view version read 11.0 to 11.6 against 11.8 to 12.0 in its own
  three pairs. The GPU `sum` read 0.97 to 0.98 ms in all twelve runs.
- **The ticks missed did not clearly move.** Both builds spread by more than
  ten points between their own runs, following `advance`, which this change
  does not touch.

10,000 smooth nodes still miss about a quarter of the ticks, and `setEdges`,
about 11 ms, is still the largest per-frame cost. What is left of it is the
flattening and the walk's arithmetic on every edge, every frame.

### With the flattening as a loop (2026-10-22)

A CPU profile of `tessellateRibbons` on the 13,169 smooth routes in Node put
about 9% of its samples on the two recursive calls in `flattenInto`, each
passing eleven arguments, beside the arithmetic they carry. The subdivision is
a loop over one fixed `Float64Array` stack of pending cubics, sized from
`MAX_FLATTEN_DEPTH`, with the right half pushed before the left so the points
come out in the same order. Output is byte-identical: the same sha256 as the
previous build over every array and the ranges, on the 10,000-node routes,
polyline and smooth, at two offsets, and over 3,000 random routes with
tolerances down to 1e-8, deep enough to reach the depth cap.

In Node, one `tessellateRibbons` on those routes with every route swaying by
a different amount each frame, old and new build alternated three times at
load about 3: 8.98 to 9.08 ms before and 8.31 to 8.49 after.

On WebGPU, same machine, browser (Chrome 155.0.8059.85, headed,
`--enable-webgpu-developer-features`) and adapter (`apple` `metal-3`, not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes only, old and new build alternated three times by swapping
`packages/render/dist/ribbon.js` and `edge-path.js`, load average 3.1 to 3.8:

| Build | `setEdges` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 11.1, 11.3, 11.1 | 4.6, 3.7, 3.5 | 17.6, 18.0, 15.8 | 24.0%, 21.3%, 18.3% |
| this one | 10.5, 10.6, 10.8 | 4.0, 4.9, 4.9 | 17.3, 16.8, 17.7 | 14.0%, 21.3%, 22.7% |

- **`setEdges` is about 0.5 ms faster**, against Node's 0.6. Three earlier
  pairs, taken while a stray test process held about two cores (load 6 to
  7), read 12.2 to 12.8 before and 10.9 to 11.5 after. The GPU `sum` read
  0.98 ms in all six runs above.
- **The ticks missed did not clearly move.** Both builds spread by several
  points between their own runs, following `advance`, which this change does
  not touch.

What is left of `setEdges` is still the walk and the flattening's own
arithmetic, two `Math.hypot` calls per point in the walk the largest single
part, and those are what byte-identical output pins.

### With knot widths measured once per segment (2026-10-23)

Each smooth span's control points need the knot widths of three segments: its
own and its two neighbours'. They were computed per span, so every interior
segment's `Math.hypot` and power ran three times, and the default tolerance's
mean segment length took a fourth `Math.hypot` pass. `smoothInto` now measures
each segment once, into one reused `Float64Array`, and reads the mean from the
same lengths. A CPU profile of the previous build in Node put about 8% of a
smooth tessellation's samples in `catmullRomControls` and `meanSegmentLength`.

Output is byte-identical: the same sha256 as the previous build over every
array and the ranges on the 10,000-node routes, polyline and smooth, at two
offsets; over the 3,000 random short routes of the last section; and over 60
batches of eight random routes of up to 401 points, longer than the width
buffer's first size, with and without an explicit tolerance.

In Node, one `tessellateRibbons` on the 13,169 swaying smooth routes, old and
new build alternated three times at load about 4: 8.24 to 8.29 ms before and
7.31 to 7.50 after.

On WebGPU, same machine (Apple M4), Chrome 156.0.8078.4 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes only, old and new build alternated three times by swapping
`packages/render/dist/ribbon.js`, load average 3.2 to 4.5:

| Build | `setEdges` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 10.6, 10.8, 10.7 | 3.4, 4.6, 4.8 | 17.2, 17.6, 17.3 | 13.7%, 21.3%, 22.7% |
| this one | 9.1, 9.2, 9.1 | 3.3, 5.7, 3.3 | 18.0, 17.6, 17.1 | 6.7%, 17.7%, 6.7% |

- **`setEdges` is about 1.5 ms faster**, against Node's 0.85. The GPU `sum`
  read 0.97 to 0.98 ms in all six runs.
- **The ticks missed are lower in all three pairs**, but the two builds'
  ranges overlap, and they follow `advance`, which this change does not touch.

The previous section ran Chrome 155; its "this one" row and this section's
"previous" row are the same build and read alike. What is left of `setEdges`
is the walk's two `Math.hypot` per point and the flattening's arithmetic,
which byte-identical output pins.

### With edge velocities in one flat array (2026-10-23)

`createEdgeMotion`'s `advance` built a new spring record per point every frame,
a position, a velocity and the pair holding them, and a new list of them per
edge. A CPU profile of the previous build in Node, stepping the 10,000-node
smooth scene, put more of its samples in the garbage collector than in any
function. Each edge now keeps its points' velocities in one flat array, a
new one per frame; the points it hands out are still fresh every frame, so a
caller holding an earlier frame sees it unchanged.

Frames are byte-identical: the same sha256 as the previous build over every
point of every frame of 300 random scenes of up to eight edges, 36,000 frames
with reroutes in flight, departures, resyncs, overflowing routes and elapsed
times from zero to half a second, including the same 318 refusals with the same
messages.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
nodes, old and new build alternated three times by swapping
`packages/render/dist/edge-motion.js` and `spring.js`, load average 3.5 to
7.7:

| Build | Edges | `advance` | `apply` | `setEdges` | Past one tick |
| --- | --- | --- | --- | --- | --- |
| previous | straight | 2.7, 2.6, 2.7 | 12.5, 12.8, 12.2 | 2.3, 2.3, 2.3 | 0%, 0%, 0% |
| this one | straight | 2.1, 2.2, 2.2 | 12.6, 12.6, 13.5 | 1.9, 2.0, 1.9 | 0%, 0%, 0% |
| previous | smooth | 6.0, 6.2, 5.9 | 18.4, 18.6, 21.6 | 10.0, 10.2, 10.1 | 25.0%, 31.7%, 25.7% |
| this one | smooth | 2.9, 3.6, 3.9 | 17.4, 17.8, 16.6 | 9.9, 10.0, 9.0 | 6.0%, 13.7%, 5.0% |

- **`advance` is lower in every pair**, by 0.4 to 0.6 ms straight and 2.0 to
  3.1 ms smooth, and the smooth ticks missed fell from 25.0% to 31.7% to 5.0%
  to 13.7%, with no overlap.
- **Straight `apply` overlaps.** Node puts a straight retarget 0.4 to 1.1 ms
  slower, which this run's spread cannot resolve. Smooth `apply` read lower
  in every pair here, which Node does not reproduce (14.6 to 15.4 against 14.6
  to 15.7).

The previous section ran Chrome 156.0.8078.4; this machine's Chrome reported
155.0.8059.85 on 2026-10-23 (the cause was not traced), so this section's
previous build (`setEdges` 10.0 to 10.2) is the comparison rather than that
section's figures. That previous build also read high on smooth `advance`
(5.9 to 6.2) and ticks missed (25.0% to 31.7%) against the section above
(3.3 to 5.7, 13.7% to 22.7%), at loads up to 7.7, so the gain is the
difference within each pair rather than against earlier sections. The new
build does not touch `setEdges`; its straight `setEdges` read lower in all
three pairs (1.9 to 2.0 against 2.3), perhaps from less garbage to collect,
which this run cannot separate from noise.

### With node motion error labels built only on failure (2026-10-23)

`createNodeMotion`'s retarget built about eleven strings per moved node before
checking anything: the field name, two for the target's coordinates and four
per axis for the spring coefficients. The edge half stopped doing this on
2026-10-21. Each check now runs on the numbers first and builds its message
only when it fails, with the same message.

Frames are byte-identical: the same sha256 as the previous build over every
node of every frame of 300 random scenes of up to eight nodes, 35,638 frames
with retargets in flight, departures, revivals, resyncs, overflowing targets
and elapsed times from zero to a billion seconds, including the same 7,179
refusals with the same messages.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
nodes, old and new build alternated three times by swapping
`packages/render/dist/motion.js`, load average 3.6 to 4.2:

| Build | Edges | `apply` | `advance` | `setEdges` | Past one tick |
| --- | --- | --- | --- | --- | --- |
| previous | straight | 13.1, 13.0, 13.4 | 2.0, 2.1, 2.2 | 1.9, 1.9, 1.9 | 0%, 0%, 0% |
| this one | straight | 12.2, 11.3, 12.4 | 2.0, 2.1, 2.0 | 1.9, 1.9, 1.9 | 0%, 0%, 0% |
| previous | smooth | 18.0, 17.0, 18.2 | 3.4, 3.4, 3.6 | 10.1, 10.2, 10.0 | 9.7%, 9.0%, 8.7% |
| this one | smooth | 17.2, 17.4, 17.7 | 3.6, 3.8, 3.4 | 10.0, 9.1, 10.2 | 9.0%, 5.7%, 11.3% |

- **Straight `apply` is lower in every pair**, by 0.9 to 1.7 ms, about what
  Node puts on the node half alone (1.1 to 1.2 ms in each pair).
- **Smooth `apply` overlaps** (17.2 to 17.7 against 17.0 to 18.2), and so do
  the ticks missed. A retarget is about one frame in 22, so a millisecond
  saved on it moves the missed ticks less than this run's spread.

### With edge velocities resampled flat (2026-10-23)

Since the edge velocities moved into one flat array (above), a retarget built a
velocity record per point from it, resampled those, and flattened them again.
The velocities are now read from the flat array at the same places as the
points, by the same arithmetic. In Node the scene's `apply` at 10,000 nodes
goes from 11.8 to 12.0 ms to 9.9 to 10.2 straight and from 13.2 to 14.1 to
11.5 to 11.9 smooth (see `bench/README.md`). With the edges stepped 30 frames
between retargets, as this page does, the edge half's `apply` alone, in three
pairs: smooth read lower in every pair (17.0 to 19.3 ms against 12.2 to 15.3),
and straight in two (13.6 to 13.9 against 8.5 to 8.6; the third, 8.2 against
8.5, overlaps).

Frames are byte-identical: the same sha256 as the previous build over every
point of every frame of 300 random scenes of up to eight edges, 36,000 frames
with reroutes in flight, departures, resyncs, overflowing routes and elapsed
times from zero to half a second, including the same 748 refusals with the same
messages (a harness written for this run, so its refusal count is not the one
above). Breaking the velocity half of `keptIndices`' rest-tolerance drop, or
the interpolated y velocity, changes the hash.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
nodes, `--frames=1200` (42 to 49 retargets a run), old and new build
alternated three times by swapping `packages/render/dist/edge-motion.js`, load
average 3.6 to 5.2:

| Build | Edges | `apply` | `advance` | `setEdges` | Past one tick |
| --- | --- | --- | --- | --- | --- |
| previous | straight | 9.7, 8.4, 12.7 | 1.8, 1.6, 2.4 | 1.3, 1.3, 2.2 | 0%, 0%, 0.1% |
| this one | straight | 11.8, 12.0, 7.5 | 2.2, 2.2, 2.3 | 1.9, 1.9, 1.9 | 0.1%, 0%, 0% |
| previous | smooth | 14.4, 13.9, 17.4 | 4.3, 4.2, 5.1 | 9.1, 9.0, 9.8 | 8.1%, 6.4%, 17.3% |
| this one | smooth | 17.4, 17.7, 14.5 | 3.5, 4.4, 5.1 | 9.1, 9.7, 9.8 | 6.3%, 11.7%, 16.8% |

**The browser does not resolve the change.** `apply` falls in two bands from
run to run in both builds, about 7.5 to 9.7 ms or 11.8 to 12.7 straight and
13.9 to 14.5 or 17.4 to 17.7 smooth, and three pairs landed in the bands
unevenly. An earlier three pairs on a draft of the same change, byte-identical
to it, showed the same bands the other way round (straight `apply` 7.4, 11.9,
11.5 against 11.9, 8.3, 11.9). The cause of the bands was not traced; it is
not the build, since both builds show both bands.

### With unchanged routes copied from the previous build (2026-10-24)

`setEdges` tessellated every edge of a group on every call, so a frame in
which a few edges moved paid for all of them. A route's vertices depend only
on its own points and the group's options, so a group now keeps its last
build with a copy of the points each route was given, and a route given
exactly the same points under the same id (the sign of a zero included) is
copied from it, its indices moved to where it now starts. The copy is held
as plain arrays: as two fresh `Float64Array`s per build it raised Node's full
collections over 400 smooth builds from 8 to 51, which cost more than the
copies saved.

Output is byte-identical: the same sha256 as a fresh build over every array
and the ranges, for 7,200 builds of `createSceneMotion` frames, polyline and
smooth, over 80 random scenes of 60 to 260 nodes with 8% of nodes retargeted
every 20 frames.

In Node, one `tessellateRibbons` on the 10,000-node grid's 13,169 routes, ids
kept from frame to frame as `createSceneMotion` hands them out, the median of
40 builds, old and new build alternated six times at load 3.4 to 3.8:

| Routes moving | Smooth, previous | Smooth, this one | Polyline, previous | Polyline, this one |
| --- | --- | --- | --- | --- |
| all | 7.29 to 7.42 ms | 7.65 to 8.18 | 0.77 to 0.85 | 0.97 to 1.22 |
| 10% | 7.27 to 7.52 | 2.66 to 2.95 | 0.76 to 0.84 | 0.68 to 0.76 |
| 1% | 7.27 to 7.52 | 2.06 to 2.58 | 0.76 to 0.84 | 0.65 to 0.84 |
| none | 7.27 to 7.52 | 1.97 to 2.25 | 0.76 to 0.84 | 0.64 to 0.79 |

The previous build does the same work whichever routes move, so its rows
below "all" are its 1% runs. **With every route moving, recording and comparing
the points costs 0.2 to 0.9 ms a build smooth and 0.2 to 0.4 ms polyline in
Node, pair by pair**, a quarter to a half of a polyline build; with a tenth or
less moving, smooth routes take about a third of the time. The copy of the
points a group keeps is about 0.7 MB at 10,000 smooth nodes.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, springs only, 10,000
smooth nodes, `--frames=1200` (44 to 48 retargets a run), old and new build
alternated three times by swapping `packages/render/dist/ribbon.js` and
`scene-edges.js`, load average 2.9 to 4.2:

| Build | `setEdges` | `apply` | `advance` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 9.0, 9.0, 9.3 | 15.6, 16.2, 17.4 | 3.7, 3.8, 5.1 | 4.9%, 5.3%, 13.3% |
| this one | 9.2, 9.0, 9.0 | 16.6, 16.2, 16.6 | 3.8, 3.9, 3.8 | 6.5%, 5.5%, 4.8% |

**This page moves every edge on every frame, so it can only show the cost,
and it does not resolve one**: `setEdges` overlaps in all three pairs. The
page then had no mode in which only some edges move; the next section adds
one.

### Partial motion shows the copy of unchanged routes (2026-10-24)

`--moving` (see "Springs in flight" above) lets the page measure what the
previous section could only measure in Node. With `--moving=0.1` the first
1,000 of 10,000 smooth nodes are retargeted, which reroutes 1,334 of the
13,169 edges; the other 11,835 are handed back on the same points every frame.

Apple M4 Mac mini, Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --edges=smooth --frames=1200`, the build before route
copying and this one alternated three times at a tenth moving (42 retargets a
run) by swapping `packages/render/dist/ribbon.js` and `scene-edges.js`, then
one run of this build with all moving (45 retargets), load average 2.4 to 4.1.
Animated-mode medians in milliseconds:

| Build | Moving | `setEdges` | `setEdges` p95 | `apply` | `advance` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- |
| before route copying | a tenth | 9.6, 9.5, 9.5 | 10.4, 10.2, 10.2 | 1.9, 1.6, 1.5 | 0.6, 0.5, 0.6 | 0.2%, 0.1%, 0% |
| this one | a tenth | 4.5, 4.0, 4.0 | 5.2, 4.5, 4.4 | 2.0, 1.6, 1.6 | 0.6, 0.5, 0.5 | 0%, 0%, 0% |
| this one, one run | all | 9.3 | 11.7 | 16.6 | 3.5 | 6.0% |

- **With a tenth of the nodes moving, `setEdges` takes 4.0 to 4.5 ms against
  9.5 to 9.6**, in all three pairs, with no overlap: the 11,835 routes at rest
  are copied rather than tessellated. Node measured a third of the time at a
  tenth of the routes moving; the browser shows a little under half. The
  saving, about 5 ms, is close to Node's, and the rest of `setEdges` (colours,
  intensity and a new geometry over every edge) was not split out.
- **A local edit is not the frame M4.10 misses.** With a tenth moving both
  builds hold the tick (at most two of 1,200 frames past it), so the gain is
  headroom, not a frame saved. With every node moving, the frame the earlier
  sections measured, this build still misses ticks: 6.0% in this run, 4.8% to
  6.5% in the previous section's three, on `apply` as much as `setEdges`.

### With unchanged routes copied a run at a time (2026-10-24)

The copy in "With unchanged routes copied from the previous build" went route by route, with an element loop per route, because a
typed-array view per array per route cost more than the copy. With a tenth of
the routes moving, that loop over the other 90% was still a quarter of a
`tessellateRibbons` call in a Node CPU profile. Consecutive unchanged routes
that were also consecutive in the previous build are now held as one run and
copied when a route breaks it, with one `set` over a view per array; the
indices are copied the same way and shifted only when the run moved.

Output is byte-identical: the same sha256 as a fresh build over every array
and the ranges, for 4,800 builds, polyline and smooth, over 120 random scenes
of 40 to 240 routes with duplicate ids, about 8% of routes moving per build,
and swaps and removals breaking the runs.

In Node, one `tessellateRibbons` on the 10,000-node grid's 13,169 routes, the
median of 140 builds after 10 of warm-up, previous and this build alternated
three times at load 3.7 to 3.8. "First" moves the first share of the nodes in
row order, as `--moving` does; "every tenth" moves every tenth node, which
breaks the runs about as often as anything here does:

| Routes moving | Smooth, previous | Smooth, this one | Polyline, previous | Polyline, this one |
| --- | --- | --- | --- | --- |
| all | 7.78 to 7.97 ms | 7.77 to 8.02 | 1.82 to 1.90 | 1.87 to 2.02 |
| first 10% | 3.07 to 3.27 | 1.77 to 2.03 | 1.19 to 1.32 | 0.88 to 0.93 |
| every tenth | 3.66 to 3.73 | 3.09 to 3.20 | 1.32 to 1.38 | 1.38 to 1.43 |
| first 1% | 2.56 to 2.57 | 1.07 to 1.13 | 1.09 to 1.18 | 0.78 to 0.81 |
| none | 2.04 to 2.53 | 0.97 to 0.99 | 1.08 to 1.17 | 0.73 |

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --edges=smooth --moving=0.1 --frames=1200` (42
retargets a run), previous and this build alternated three times by swapping
`packages/render/dist/ribbon.js`, load average 3.7 to 4.1. Animated-mode
medians in milliseconds:

| Build | `setEdges` | `setEdges` p95 | `apply` | `advance` | Past one tick |
| --- | --- | --- | --- | --- | --- |
| previous | 4.1, 4.0, 4.1 | 4.7, 4.8, 4.7 | 1.9, 1.9, 1.9 | 0.6, 0.7, 0.5 | 0%, 0.1%, 0% |
| this one | 3.6, 3.5, 3.5 | 4.0, 4.2, 4.0 | 1.8, 1.6, 2.0 | 0.5, 0.6, 0.6 | 0%, 0%, 0% |

- **With a tenth of the nodes moving, `setEdges` takes 3.5 to 3.6 ms against
  4.0 to 4.1**, in all three pairs, with no overlap. Both builds hold the tick,
  so this is headroom on a local edit, as the previous section's gain was.
- **With every route moving there is nothing to copy**, and Node shows no
  change; that frame was not rerun in the browser. What is left of `setEdges`
  at a tenth moving is about 1 ms outside the tessellation in Node (colours,
  intensity and a new geometry over every edge) and, inside it, recording and
  comparing every route's points.
- **Polyline routes gain less, and lose a little when runs break often.**
  With every tenth node moving, polyline builds are 1.38 to 1.43 ms against
  1.32 to 1.38, and with all moving 1.87 to 2.02 against 1.82 to 1.90: a run of
  one route now pays for five views, which the element loop did not, and a
  polyline route is cheap enough to tessellate that this shows. The polyline
  times in this table are higher than the earlier section's throughout, for
  both builds, because the harness differs (scene script, run length and
  warm-up); compare within one table, not across them.

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

### With reroutes kept out of the edge plan's map (2026-10-24)

A retarget's edge plan put every reroute into a `Map` keyed by id, to catch an
id named twice and to answer later lookups, and a Node CPU profile of the
10,000-node retarget put that map's lookups and inserts at about a sixth of the
plan's own time. A reroute of a live edge now goes into a list, and the edge
records which plan claimed it and where, so an id named twice still takes the
later route in the first one's place. The map keeps removals, additions and
replacements.

Frames are byte-identical: the same sha256 as the previous build over every
point of every frame for 200 frames of 2,000 edges with retargets and resyncs,
500 `alignRoutes` calls, and 400 random deltas over 300 edges with removals,
additions, same-id replacements, ids rerouted twice and reroutes of edges the
same delta added, 57 of them refused.

In Node, the edge half's plan alone at 10,000 smooth nodes, 300 retargets with
a frame stepped between each, previous and this build alternated eight times
at load about 2.1: median 4.1 to 5.4 ms against 5.8 to 6.8, minimum 3.5 to
3.7 against 3.9 to 4.2. The previous build's median sat 2 to 3 ms above its
minimum, so allocation and collection rather than arithmetic is what is left
of the plan. The scene's `apply`, one frame between retargets,
three pairs: 10.3 to 10.7 ms against 11.7 to 12.0 smooth and 8.5 to 8.8
against 9.1 to 9.9 straight; thirty frames between, as this page steps, 18.5
to 19.4 against 21.5 to 21.9 smooth and 16.4 to 16.9 against 18.2 to 18.6
straight. The committed entries are in `bench/README.md`. A first attempt
that took a route's arc-length parameters from the walk that validates it,
rather than measuring the segments twice, had the same minimum and a worse
median (6.7 to 7.4 ms against 5.8 to 6.8), because each reroute then held its
parameters until the plan ended; it was not kept.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --sizes=10000 --frames=1200` (42 to 53 retargets a
run), builds swapped through `packages/render/dist/edge-motion.js`, load
average 2.7 to 4.3. Three pairs of both styles with the previous build first,
then three of straight with this build first. Animated-mode medians in
milliseconds:

| Build | Edges | `apply` | `advance` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | straight | 8.5, 12.0, 7.6, 11.0, 12.2, 12.3 | 2.3, 2.4, 1.9, 2.3, 2.5, 2.5 | 0% in all |
| this one | straight | 10.8, 10.5, 10.7, 10.9, 10.4, 10.3 | 2.4, 2.6, 1.9, 2.0, 2.5, 2.5 | 0% in all |
| previous | smooth | 14.4, 17.7, 14.2 | 6.0, 4.7, 4.3 | 25.8%, 13.0%, 8.7% |
| this one | smooth | 16.4, 16.6, 16.6 | 4.7, 4.9, 4.0 | 13.4%, 13.2%, 7.9% |

**The browser does not resolve the change.** The previous build's `apply`
falls in the two bands earlier sections found, 7.6 to 8.5 ms or 11.0 to 12.3
straight and 14.2 to 14.4 or 17.7 smooth, while this build landed between them
in every run, 10.3 to 10.9 straight and 16.4 to 16.6 smooth: each of its six
straight runs is below all four of the previous build's upper-band runs and
above both of its lower-band ones. Node, where the bands do not appear, shows the gain in every pair.

### With an edge colour converted only when it changes (2026-10-25)

With a tenth of the nodes moving, about a third of `setEdges` was not the
tessellation: in Node at 10,000 smooth nodes it took 2.6 ms, of which
`tessellateRibbons` was 1.7, and the per-vertex colour buffer was 0.78 ms of
the 0.9 left. 0.33 ms of that was converting each edge's colour, three `Math.pow`
and a label string per edge, though the profile's edges share one colour. A colour
is now converted only when it differs from the previous edge's, and the
vertices are walked by index.

Colour buffers are byte-identical: the same sha256 over the profile's 13,169 edges
and a self loop, with one colour, runs of six colours, and a different colour per edge. In Node, `setEdges` on 13,169 smooth routes with a tenth moving,
400 frames after 50 of warm-up, six pairs at load about 3.5: median 2.20 to
2.27 ms against 2.62 to 2.68, minimum 1.94 to 1.97 against 2.39 to 2.40. With a
different colour on every edge, the case the cache cannot help, four pairs:
2.51 to 2.54 against 2.69 to 2.73.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --sizes=10000 --edges=smooth --moving=0.1
--frames=1200` (42 retargets a run), builds swapped through
`packages/render/dist/scene-edges.js`, previous build first in each of three
pairs, load average 2.3 to 3.5. The previous build's 3.3 to 3.4 is below
the 3.5 to 3.6 the run-at-a-time section measured for the same build at
loads of 3.7 to 4.1; compare within the table. Animated-mode medians in milliseconds:

| Build | `setEdges` | `setNodes` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 3.3, 3.3, 3.4 | 1.9, 1.8, 1.9 | 1.7, 1.5, 1.8 | 0.1%, 0%, 0% |
| this one | 2.9, 3.0, 3.0 | 1.8, 1.9, 1.9 | 1.7, 1.5, 1.6 | 0.1%, 0%, 0% |

Both hold the tick. What is left of `setEdges` beyond the tessellation is
the colour and intensity buffers built new on every call and the new
`BufferGeometry` around them; `setNodes`, at 1.8 to 1.9, is the next largest
step.

### With edge colours copied from the previous build (2026-10-25)

Of what was left of `setEdges` past the tessellation, about 0.35 ms in Node
at 10,000 smooth nodes, the colour buffer was 0.31: 263,382 vertices, three
floats each, written one by one. The intensity buffer (0.03 to 0.07) and the
`BufferGeometry` (under 0.01) were not worth a change. An edge's colour slice
depends only on its colour and its vertex count, so where both match the
previous build at the same index the slice is now copied from the previous
colour buffer, and a stretch of such edges is one typed-array copy. A copy
per edge measured slower than the loop (0.46 ms against 0.31), so the run is
what pays.

Every attribute is byte-identical: the same sha256 for the previous build,
this one, and a group built fresh from the same edges, after 460 calls with
one colour, runs of six colours, a different colour per edge, and every
colour changed on every call. In Node, `setEdges` on 13,169 smooth routes with
a tenth moving, 400 calls after 60 of warm-up, three pairs per pattern at load
about 2.5, medians in milliseconds:

| Colours | previous | this one |
| --- | --- | --- |
| one | 1.93 to 1.94 | 1.75 to 1.76 |
| runs of six | 2.03 to 2.06 | 1.75 |
| one per edge | 2.30 to 2.32 | 1.75 to 1.82 |
| all changed every call | 1.91 to 1.95 | 1.97 to 2.00 |

The last row is the case nothing can be copied from: it pays a comparison
per edge and a `Float64Array` of colours, about 0.05 ms. These Node numbers
come from a different script and load than the section above; compare within
the table.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --sizes=10000 --edges=smooth --moving=0.1
--frames=1200` (42 retargets a run, one edge colour), builds swapped through
`packages/render/dist/scene-edges.js`, previous build first in each of three
pairs, load average 2.2 to 2.9. Animated-mode medians in milliseconds:

| Build | `setEdges` | `setNodes` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 3.0, 3.0, 3.0 | 1.9, 1.9, 1.9 | 1.6, 1.7, 1.7 | 0%, 0%, 0% |
| this one | 2.9, 2.8, 3.0 | 1.9, 1.9, 1.9 | 1.7, 1.5, 1.8 | 0%, 0%, 0.1% |

The browser reports a median to 0.1 ms, and the 0.2 ms Node saves at one
colour sits at that resolution, so the browser does not clearly resolve it.
Both hold the tick. `setNodes`, at 1.9, is now the largest step after
`setEdges`.

### With `setNodes` stamping its nodes rather than mapping them (2026-10-25)

`SceneNodes.setNodes` diffed the nodes it was given against the ones it holds
by first putting every incoming node in a fresh `Map`, with a record per node,
on every call. At 10,000 nodes a frame that was about a seventh of the call in
Node. A node the scene already holds is now stamped with the call's number
and its place in the list, and only ids new to the scene go in a set to catch a
duplicate. The order of removals and additions, and so every slot and handle,
is unchanged.

Byte-identical: the previous build and this one, given the same 12,000 random
calls over 300 scenes (reorders, shape changes, arrivals, departures, repeated
ids and bad numbers), hold the same instance buffers and placements after
every call, and reject the same 1,848 calls with the same messages. In Node,
`setNodes` on the profile's 10,000 nodes (half rounded rects, half circles,
a tenth moving), 400 calls after one of warm-up, four pairs at load about
2.8: median 1.90 to 2.06 ms against 2.31 to 2.37, minimum 1.77 to 1.89
against 2.12 to 2.17.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --sizes=10000 --edges=smooth --moving=0.1
--frames=1200`, builds swapped through `packages/render/dist/scene-nodes.js`,
previous build first in each of three pairs, load average 2.5 to 4.2.
Animated-mode medians in milliseconds:

| Build | `setNodes` | `setEdges` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 1.9, 1.9, 1.9 | 3.1, 3.0, 3.0 | 1.6, 1.5, 1.6 | 0%, 0%, 0% |
| this one | 1.7, 1.7, 1.7 | 3.0, 2.9, 3.0 | 1.8, 1.7, 1.8 | 0%, 0%, 0% |

`apply` does not run this code, and earlier sections record it moving by
this much between runs of one build. Both hold the tick. What is left of
`setNodes` is mostly per node: the label strings its validation builds for
every node, twice, whether or not a check fails (about 0.15 ms in Node when
built only on failure), and three `Math.pow` per colour, two colours per node.

### With shape instances checked before their field names are built (2026-10-25)

`requireShapeInstance` built every field name it might report (`n0.center.x`,
`n0.size.width` and the rest, six to nine strings) before checking anything,
and `setNodes` calls it at least twice per node per call. It now checks the
numbers first and builds the names only when a check fails, through the same
checks as before, so the message a bad node gets is unchanged.

Byte-identical: the previous build and this one, given the same 50,000 random
instances (bad numbers, wrong types, missing `center` or `size`, the wrong
family), return the same instance or throw the same error with the same
message, and reject the same 30,802. In Node, on a different workload from the
section above so compare within this one, `setNodes` on 10,000 nodes (a
fifth circles, every node moved each call), 600 calls after 200 of warm-up,
three pairs at load about 3.9: median 1.80 to 1.87 ms against 2.09 to 2.11,
minimum 1.70 to 1.74 against 1.94 to 1.97.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --sizes=10000 --edges=smooth --moving=0.1
--frames=1200`, builds swapped through
`packages/render/dist/instance-attributes.js`, previous build first in each of
three pairs, load average 3.5 to 4.5. Animated-mode medians in milliseconds:

| Build | `setNodes` | `setEdges` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 1.7, 1.7, 1.7 | 3.0, 2.9, 3.0 | 1.8, 1.7, 1.7 | 0%, 0%, 0% |
| this one | 1.5, 1.5, 1.5 | 3.1, 3.0, 3.0 | 1.9, 1.6, 1.6 | 0%, 0%, 0% |

`setEdges` and `apply` do not run this code. Both hold the tick. What is left
of `setNodes` that is per node is the colour conversion: three `Math.pow` per
colour, two colours per node, every call.

### With a node colour converted only when it changes (2026-10-26)

`InstanceAttributeData.write` converted both of a node's colours from sRGB to
linear on every write, three `Math.pow` per colour, though a mesh's nodes
usually share a few colours. Each mesh now keeps its last fill and glow
conversion and reuses them when the next write repeats the colour, as edge
colours have done since 2026-10-25.

Byte-identical: the previous build and this one, given the same 8,000 random
`setNodes` calls over 200 scenes (a palette of six colours and random ones,
shape changes, arrivals, departures, repeated ids and bad colours), hold the
same instance buffers after every call, and reject the same 630 calls with the
same messages. In Node, on a different workload from the section above so
compare within this one, `setNodes` on 10,000 nodes (alternating rounded rects
and circles, one colour pair per shape, every node moved each call), 600 calls
after 200 of warm-up, three pairs at load about 4 to 6: median 1.24 to 1.31 ms
against 1.66 to 1.73, minimum 1.21 to 1.23 against 1.63 to 1.66.

On WebGPU, same machine (Apple M4), Google Chrome 155.0.8059.85 headed with
`--enable-webgpu-developer-features`, adapter `apple` `metal-3` (not a
fallback), `renderer.backend` `webgpu` on every run, tick 16.7 ms, DPR 1,
`fit`, `--motion=springs --sizes=10000 --edges=smooth --moving=0.1
--frames=1200`, builds swapped through
`packages/render/dist/instance-attributes.js`, previous build first in each of
three pairs, load average 2.9 to 3.9. Animated-mode medians in milliseconds:

| Build | `setNodes` | `setEdges` | `apply` | Past one tick |
| --- | --- | --- | --- | --- |
| previous | 1.5, 1.5, 1.5 | 3.1, 3.0, 3.2 | 1.8, 1.6, 1.9 | 0%, 0%, 0% |
| this one | 1.2, 1.2, 1.2 | 3.0, 3.0, 3.0 | 1.6, 1.6, 1.6 | 0%, 0%, 0% |

`setEdges` and `apply` do not run this code. Both hold the tick. A scene whose
consecutive nodes alternate colours within one shape gains nothing and pays a
comparison per colour.

### All moving and a tenth moving on an AMD GPU (2026-10-26)

The M4.10 sections above measured on the Apple M4. This one profiles the same frame
on the WSL2 machine's GPU, attached [from WSL2](#from-wsl2-through-the-windows-sides-chrome):
an AMD Ryzen 9 9900X whose integrated Radeon graphics (RDNA 2, driver
32.0.21042.62) drives a 3840 by 2160 display that Windows reports at 59 Hz.
Google Chrome 156.0.8078.48 on the Windows side, headed, no flags beyond
`windows-chrome.mjs`'s, adapter `amd` `rdna-2`, not a fallback,
`renderer.backend` `webgpu` on every row, control tick 17.8 to 17.9 ms (about
56 Hz, longer than the reported rate's 16.9 ms and the 16.7 that M4.10's
60 fps names; the cause was not traced, and ticks missed are counted against
the measured tick), DPR 1,
viewport 1280 by 720, `fit` (zoom 0.0715), load average 0.0 to 1.8 (read with
`uptime` before and after each batch).

```
node bench/browser/windows-chrome.mjs              # headed, left running
DAGR_CDP=http://127.0.0.1:9445 node bench/browser/frame-profile.mjs \
  --motion=springs --sizes=10000 --edges=straight,smooth --moving=1,0.1 --frames=1200
```

Three runs of main (`2a06a4b`). Animated-mode medians in milliseconds, one
value per run; `apply` is the median over the retarget frames (44 or 45
retargets a run, warm-up included, 62 to 65 with smooth edges all moving,
whose frames run late):

| Edges | Moving | `apply` | `advance` | `setNodes` | `setEdges` | `render` | Interval p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| straight | all | 13.9, 13.3, 14.6 | 3.8, 3.7, 2.9 | 1.1, 1.1, 1.1 | 1.8, 1.7, 1.7 | 0.4, 0.4, 0.4 | 18.1 | 0%, 0%, 0% |
| straight | a tenth | 1.4, 1.3, 1.3 | 0.6, 0.6, 0.6 | 1.1, 1.0, 1.0 | 1.0, 1.0, 0.9 | 0.4, 0.4, 0.4 | 18.1 | 0%, 0%, 0% |
| smooth | all | 18.1, 18.7, 18.3 | 8.1, 7.9, 7.2 | 1.4, 1.3, 1.4 | 13.1, 12.3, 13.4 | 1.1, 1.0, 1.1 | 36.1 | 42.8%, 36.4%, 39.3% |
| smooth | a tenth | 2.2, 2.3, 2.2 | 1.0, 1.0, 0.8 | 1.2, 1.2, 1.2 | 3.2, 3.1, 3.2 | 1.1, 1.1, 1.1 | 18.1 | 0%, 0%, 0% |

`input` was 0.4 to 0.7 ms on every row. The interval p99 was 18.1 to 18.2 on
every row but smooth all moving, where it was 54.0 and the maximum 54.1 to
71.9.

- **Straight edges hold the tick with every node moving.** No interval in
  three runs reached one and a half ticks, retarget frames included, though a
  retarget frame's `apply` plus the rest of the frame comes to about 21 ms.
  The interval is read from the frame callback's timestamp, so a single late
  frame that the next one catches up does not count; a frame that is late
  every time does.
- **Smooth edges with every node moving miss 36% to 43% of ticks.** A frame
  between retargets spends 23 to 24 ms of medians on the CPU (`advance` 7 to
  8, `setEdges` 12 to 13, the rest 3), past the tick on most frames, though
  under half the intervals reach one and a half ticks, since a frame the next
  catches up does not count; retarget frames add 18 to 19 ms of `apply`.
  `setEdges` is the largest step that runs every frame and `advance` the
  second. With the same 10,000 nodes, `advance` is two to two and a half
  times the straight rows', since each smooth route carries a
  bend point whose springs `advance` steps too.
- **With a tenth moving both edge styles hold the tick**, as on the Apple M4.

The open pull request #159 (head `5173fc8`), which writes each edge build into the buffers of
the one before last rather than allocating about 15 MB of typed arrays a
frame, was measured against main in the same Chrome by swapping
`packages/render/dist/ribbon.js` and `scene-edges.js`, main first in each of
three pairs, `--edges=smooth --moving=1,0.1` only:

| Build | Moving | `setEdges` | `setEdges` p95 | `advance` | `advance` p95 | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | all | 10.4, 11.0, 10.7 | 13.6, 13.4, 13.1 | 6.6, 6.7, 6.8 | 13.2, 13.8, 13.8 | 20.3, 19.7, 19.5 | 23.8%, 26.0%, 24.9% |
| #159 | all | 10.0, 10.0, 10.4 | 11.8, 12.2, 12.6 | 6.4, 6.3, 6.5 | 9.7, 10.3, 10.4 | 20.1, 19.5, 19.1 | 16.8%, 15.4%, 20.4% |
| main | a tenth | 3.1, 3.2, 3.1 | 4.5, 5.5, 4.3 | 0.9, 0.9, 0.9 | 1.4, 1.2, 1.4 | 2.7, 1.8, 2.6 | 0%, 0%, 0% |
| #159 | a tenth | 2.3, 2.4, 2.4 | 3.5, 3.7, 2.7 | 0.8, 0.8, 0.9 | 1.1, 1.1, 1.2 | 1.9, 1.8, 1.7 | 0%, 0%, 0% |

- **On this GPU #159 misses fewer ticks with every node moving**, 15.4% to
  20.4% against 23.8% to 26.0%, with no overlap in three pairs, where the
  Apple M4 left the direction unresolved (see #159). The tails move most: `setEdges`
  p95 falls by 0.5 to 1.8 ms and `advance` p95 by about 3.5, though `advance`
  runs none of #159's code, which fits fewer collection pauses landing in
  later steps (#159 cut Node's mark-compacts in 800 calls
  with every route moving from 135 to 3); not
  traced. The medians move less (`setEdges` 0.3 to 1.0 ms).
- **With a tenth moving, `setEdges` falls from 3.1 to 3.2 ms to 2.3 to 2.4** in
  every pair, as on the Apple M4 (#159's 1.8 to 2.0 against 3.0 to 3.1), and
  both builds hold the tick.
- **Main missed fewer ticks here than in the three runs above** (24% to 26%
  against 36% to 43%), and its `setEdges` was about 2 ms lower. Those runs
  drew the straight rows first in the same page, these drew smooth rows
  alone, so compare within one table, not across them.

So on 2026-10-26, on this machine, 10,000 nodes with straight edges and every
node moving hold its 17.9 ms tick, though a retarget frame's CPU work (about
21 ms) would not fit a true 60 Hz one, and smooth edges do not hold it, where the CPU
frame between retargets is about 1.3 ticks of medians. The next step is the
smooth frame's per-frame cost: #159's buffer reuse first, then `advance`, the
second largest step, which no change since 2026-10-23 has targeted, ahead
of `setEdges`'s remaining flattening and walk, which byte-identical output
pins, and ahead of `apply`, which runs on about one frame in 20 to 24.

### Edge velocities written into the frame before's array, not kept (2026-10-26)

The step `tsk_a498d1621d79` named after the AMD reprofile above: smooth
`advance` with every node moving. In Node, with each half of the scene timed
on its own (`createNodeMotion` and `createEdgeMotion` driven as
`createSceneMotion` drives them, the graph of
`packages/render/bench/scene-motion.bench.ts`, 1,000 calls after 200 of
warm-up, `dt` 1/10,000 s so every spring stays in flight), the edge half is
most of it: at 10,000 nodes with smooth edges (39,507 route points in flight)
the node half took 0.5 to 0.8 ms median and the edge half 3.3 to 3.8 (p90
5.9 to 6.7), and with straight edges (26,338 points, one run) 0.6 and 3.1.
Each moving edge built a new velocity array every frame, two numbers per
point.

The change tried: each moving edge keeps the array its last frame replaced and
writes the next frame's velocities into it, swapping it in after the loop as
before, and drops it on arrival. Byte-identical: the previous build and this
one, given the same 12,000 random `resync`, `apply` and `advance` calls over
200 scenes (arrivals, departures, reroutes, point counts changing in flight,
zero, tiny and huge `dt`), return the same frames, coordinate by coordinate,
and throw the same 2,865 errors with the same messages, for both variants
below. In Node the edge half fell to 2.5 to 2.7 ms median with the first
variant and 2.9 with the second (p90 4.0 to 4.6 across both) against 3.3 to
3.8 (5.9 to 6.7) back to back.

On WebGPU it did not carry over. Same machine as the section above (AMD Ryzen 9
9900X, integrated RDNA 2), Google Chrome 156.0.8078.48 on the Windows side,
headed, attached through `windows-chrome.mjs` with no other flags, adapter
`amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on every row,
control tick 16.7 ms on every run (17.8 to 17.9 on 2026-10-26; the cause of
either was not traced), DPR 1, viewport 1280 by 720, `fit` (zoom 0.0715),
`--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1 --frames=1200`,
builds swapped through `packages/render/dist/edge-motion.js`, main (`191db5c`)
first in each pair. #159 is still open, so main here is without it. Two rounds of three pairs. The first wrote into an array made with
`new Array(n).fill(0)`, which V8 keeps holey where `push` made it packed;
the second started from `[]` and wrote each index in order, which keeps it
packed. Animated-mode medians in milliseconds, one value per run:

| Build | Moving | `advance` | `advance` p95 | `setEdges` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- |
| main | all | 7.2, 7.1, 6.8 | 14.8, 14.8, 14.5 | 11.2, 11.6, 11.9 | 21.5, 25.2, 21.9 | 44.8%, 50.3%, 43.2% |
| holey | all | 9.0, 8.6, 8.5 | 16.5, 13.7, 14.9 | 11.3, 10.8, 11.2 | 23.5, 22.8, 23.3 | 57.1%, 49.3%, 50.8% |
| main | a tenth | 1.0, 1.0, 1.0 | 1.5, 1.5, 1.6 | 3.3, 3.5, 3.6 | 2.9, 2.8, 4.1 | 0%, 0%, 0% |
| holey | a tenth | 1.1, 1.2, 1.2 | 1.5, 1.6, 1.6 | 3.2, 3.5, 3.6 | 2.6, 3.1, 3.1 | 0%, 0%, 0% |
| main | all | 6.8, 7.0, 6.8 | 14.4, 14.5, 14.1 | 11.2, 11.3, 11.0 | 20.6, 20.6, 19.6 | 40.5%, 41.7%, 37.5% |
| packed | all | 8.9, 8.0, 6.5 | 14.0, 12.9, 10.8 | 10.8, 10.6, 11.6 | 22.9, 23.6, 21.7 | 49.1%, 42.3%, 39.6% |
| main | a tenth | 0.9, 1.1, 1.0 | 1.3, 1.5, 1.4 | 3.8, 3.7, 3.6 | 2.0, 2.7, 2.0 | 0%, 0%, 0% |
| packed | a tenth | 1.2, 1.3, 1.0 | 1.6, 1.6, 1.4 | 3.6, 3.6, 3.6 | 3.3, 3.1, 3.0 | 0%, 0%, 0% |

Load average 0.4 to 6.8 in the first round (6.8 before its first run of the
change) and 0.0 to 0.7 in the second, read before each run. The third pair of
the second round was rerun whole after main's page timed out loading.

- **`advance` was slower in Chrome in five of six pairs with every node
  moving**, by 1.5 to 1.8 ms in the first round and by 2.1 and 1.0 in the
  second, whose third pair went the other way by 0.3. Its p95 fell in every
  pair of the second round and in one of three in the first.
- **Ticks missed rose in five of six pairs**: 49% to 57% against 43% to
  50%, then 40% to 49% against 38% to 42%.
- **`apply` was slower in every pair of the second round**, by 2.1 to 3.0 ms
  with every node moving and 0.4 to 1.3 with a tenth, though the change does
  not touch its code; the first round overlapped. One reading is that
  velocity arrays now live across frames and get promoted out of the young
  generation, so collection costs move into whatever step runs next, but no
  trace was taken.
- **Node is not a reliable proxy for this step.** The same build that saved
  about 1 ms of median and 2 of p90 in Node cost about as much in Chrome.

So the change was not kept, and `edge-motion.ts` is unchanged. In Node, the
edge half is still where smooth `advance` spends its time. A next attempt
should be measured in Chrome before Node is trusted, with a trace taken if
`apply` moves again.

### Edge springs stepped without the checked helpers (2026-10-26)

`tsk_a498d1621d79` again, measured in Chrome first this time. #159 is still
waiting on its memory decision, so `advance` went first. A CPU profile of
the all-moving smooth row on main (same machine, browser and flags as the
table below, 600 frames, samples about every 0.5 ms) put about 2.1 s of the 3.4 s
sampled under scene motion's `advance` in the spring helpers: `combineTwo`,
`nextAxisPosition`, `nextAxisVelocity`, `weightedInterpolation` and
`requireFinite`. The edge loop called those four times per route point, and
each call checked every product and partial sum it formed.

The change: edge motion's `advance` does the same sums inline, once per point,
and checks only the four results. A product or partial sum that is not finite
leaves every sum after it not finite, so four finite results are bit for bit
what the helpers return on their direct path. Anything else is stepped again
through the helpers, which keeps their scaled sums and their errors. Over the
random calls below, no point stepped by a finite, non-zero `dt` fell back to
them, because a retarget already refuses a route whose step could overflow;
only frames with a `dt` of 0 or one that settles every spring use them.

Byte-identical: main and this build, given the same 90,000 random `resync`,
`apply` and `advance` calls over 600 scenes (reroutes that keep some points
where they are, departures, unknown ids, routes near `1e308`, signed zeros and
subnormals, `dt` from -1 to `1e300`), return the same frames, coordinate by
coordinate with `Object.is`, and refuse the same 13,219 calls with the same
messages.
The check catches a build that drops the `position === target` case, which
the test suite did not, so a test now pins it.

AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome 156.0.8078.48 on the
Windows side, headed, attached through `windows-chrome.mjs` with no other
flags, adapter `amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on
every row, control tick 16.7 ms on every run, DPR 1, viewport 1280 by 720,
`fit` (zoom 0.0715), `--motion=springs --sizes=10000 --edges=smooth
--moving=1,0.1 --frames=1200`, builds swapped through
`packages/render/dist/edge-motion.js`, main (`0ed3593`) first in each pair.
#159 is still open, so main here is without it. Load average 0.0 to 0.3 before
each run. Animated-mode medians in milliseconds, one value per pair:

| Build | Moving | `advance` | `advance` p95 | `setEdges` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- |
| main | all | 6.8, 4.8, 6.6 | 13.3, 8.1, 13.2 | 10.9, 10.8, 11.0 | 19.9, 19.7, 19.6 | 35.0%, 24.9%, 33.7% |
| this | all | 3.5, 3.4, 3.4 | 7.0, 7.1, 6.9 | 10.7, 11.1, 11.6 | 19.9, 19.6, 19.4 | 16.0%, 20.3%, 22.9% |
| main | a tenth | 1.0, 0.9, 1.0 | 1.3, 1.2, 1.3 | 3.1, 3.4, 3.1 | 2.6, 2.6, 2.5 | 0%, 0%, 0% |
| this | a tenth | 0.5, 0.5, 0.7 | 0.7, 0.7, 1.1 | 3.2, 3.1, 3.1 | 1.8, 1.8, 2.5 | 0%, 0.2%, 0% |

A first pair, run while the equivalence check was running in WSL, went the
same way (6.6 against 3.2 ms, 29.8% against 15.3% missed) and was rerun; the
third column is the rerun.

- **`advance` with every node moving fell by 1.4 to 3.3 ms in every pair**, its
  p95 by 1.0 to 6.3, and ticks missed fell in every pair (16% to 23% against
  25% to 35%).
- **With a tenth moving it fell by 0.3 to 0.5 ms**, both builds holding the
  tick.
- `setEdges` and `apply`, which the change does not run, stayed within their
  run-to-run spread, unlike the 2026-10-26 attempt above.

What is left of the all-moving frame between retargets is `setEdges` at 11 ms,
which #159 addresses and whose memory trade is the maintainer's call, and the
per-point allocation of the frame's points, which a caller holding an earlier
frame relies on.

### Edge builds written into the GPU buffers already created, not kept (2026-10-27)

`tsk_9883b17df78b`: with every node moving at 10,000 smooth nodes, each
`setEdges` build got new GPU buffers, about 12.5 MB a frame by the
`--memory` run. Measured first, in Chrome: a CPU profile of the all-moving
smooth row on main (`c70e9f2`, same machine, browser and flags as the table
below, 600 frames, samples about every 0.5 ms) put about 510 ms of the
run in three's `createAttribute`, which creates each buffer mapped and copies
the build into it, during `render`. That is about 0.8 ms over each of about
660 builds (60 warm-up frames and 600 measured). Disposing the old buffers took about 0.02 ms a build. `setEdges`
itself was 7.0 s, of which `tessellateRibbons` was 6.5 s.

The change tried: an edge group kept its geometry once its first draw had
created the buffers, and handed a build that fit them (no larger, and at
least half their vertices) to the same attribute objects, so three wrote it over
the front of the existing buffers with `writeBuffer` rather than creating new
ones. The CPU arrays were the build's own, so it held no more CPU memory and
did not depend on #159. Byte-identical: main and this build, given the same
18,000 random `setEdges`, `setEdgeIntensity` and draw calls over 300 scenes
(two groups, one dashed, one smooth; groups growing, shrinking and emptied,
routes kept, bad colours and points), held the same index, attributes, counts
and draw range after every call and rejected the same 3,141 calls with the
same messages. A stand-in for three that sizes each buffer at its first
upload found no build written past a buffer's end in 42,392 reuses.

It did what it was for: by `--memory`, GPU bytes created per frame of moving
edges fell from 12,502,144 to 83,075 (two sets of buffers created in 301 frames). It
made the frame slower. AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome
156.0.8078.48 on the Windows side, headed, attached through
`windows-chrome.mjs` with no other flags, adapter `amd` `rdna-2`, not a
fallback, `renderer.backend` `webgpu` on every row, control tick 17.7 ms in
the first run and 16.7 in the rest, DPR 1, viewport 1280 by 720, `fit` (zoom
0.0715), `--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1
--frames=1200`, builds swapped through `packages/render/dist`, main first in
each pair. #159 is still open, so main here is without it. Load average 0.05
to 0.33, read before and after each run. Animated-mode medians in milliseconds,
one value per pair:

| Build | Moving | `setEdges` | `setEdges` p95 | `render` | `render` p95 | Past one tick |
| --- | --- | --- | --- | --- | --- | --- |
| main | all | 10.9, 10.1, 10.3 | 15.5, 14.4, 15.0 | 1.1, 1.0, 1.0 | 1.4, 1.2, 1.2 | 8.0%, 6.3%, 7.2% |
| this | all | 9.8, 10.0, 9.6 | 16.6, 16.8, 16.6 | 2.3, 2.3, 2.3 | 3.0, 3.0, 2.9 | 22.8%, 15.1%, 21.2% |
| main | a tenth | 3.1, 3.0, 3.1 | 5.2, 4.2, 4.9 | 1.3, 1.0, 1.0 | 1.5, 1.2, 1.1 | 0%, 0%, 0.2% |
| this | a tenth | 3.2, 3.0, 3.0 | 4.4, 5.2, 4.9 | 2.6, 2.6, 2.6 | 2.9, 3.0, 2.9 | 0%, 0%, 0% |

- **`render` rose by 1.2 to 1.6 ms in every pair**, with every node moving
  and with a tenth, and ticks missed with every node moving rose in every
  pair (15% to 23% against 6% to 8%).
- `setEdges` medians fell by 0.1 to 1.1 ms with every node moving, but its
  p95 rose, and with a tenth moving it did not move.
- A CPU profile of this build (600 frames, as above) shows why: three's
  `updateAttribute`, which is the `writeBuffer` of each build, took about
  1,415 ms, about 1,330 of it the edge builds once the 81 ms main also spends
  writing other attributes is taken out, where main's `createAttribute` took
  510. Writing a build into a buffer that already exists costs Chrome about
  2.6 times what a new buffer mapped at creation does, for the same bytes,
  and the difference, about 1.25 ms over each of 660 frames, is the rise in
  `render`.

Main's ticks missed here (6% to 8%) are lower than the 16% to 23% the
2026-10-26 section above recorded for the same build on the same machine and
browser. The cause was not traced, so compare only within one table.

So the change was not kept, and `scene-edges.ts` is unchanged.

What is left of the all-moving frame between retargets is still `setEdges`,
and most of it is `tessellateRibbons` (6.5 s of 7.0 in the profile of main),
which every moving route runs on every frame (`tsk_6f01f8911bde`). The garbage its new arrays
leave is #159's, whose memory trade is the maintainer's call.

### With the walk's lengths taken without the `Math.hypot` builtin (2026-10-27)

`tsk_6f01f8911bde`: the tessellation itself, with every node moving. A CPU
profile of the all-moving smooth row on main (`00e6f6c`, same machine,
browser and flags as the table below, 600 frames, 8 s sampled every 0.5 ms
starting 12 s after the page opened) put 3,739 ms under `tessellateRibbons`, and the walk,
`tessellateCentreline`, was its largest part: 1,620 ms, 1,243 of it its own.
The walk takes two `Math.hypot` per point of every moving route's flattened
centreline (the segment's length and the bisector's), every frame. V8 does not
inline `Math.hypot`: each call is a builtin that allocates per call, and the
profile counts its time as the walk's own.

The change: the walk calls a `hypot` written out in `ribbon.ts`, which is V8's
own algorithm at two arguments (scale by the larger magnitude, sum the
squares, take the root, scale back). Over 20,000,324 pairs (random bit
patterns, random scales, and every pair of zeros, subnormals, `MAX_VALUE`,
infinities and `NaN`) it returned the same double as `Math.hypot`, by
`Object.is`, both in Node 22.22.1 and in the Chrome 156 below. Another engine's
`Math.hypot` may round differently in the last bit, as engines already differ
from one another. A test pins it against `Math.hypot` in Node, and fails on a
`Math.sqrt(x * x + y * y)` in its place.

Byte-identical: main's build and this one, given the same 76,000 random
`tessellateRibbons` calls over 1,400 scenes (smooth and polyline, miter limits
from 1 to 100, absolute tolerances, routes kept, added, dropped and reversed
between calls with the previous build and size hint passed on, duplicate,
near-duplicate and hairpin points, coordinates from subnormal to `MAX_VALUE`,
non-finite and non-number coordinates), returned the same bytes in every
array, the same ranges and the same given points, and refused the same 10,368
calls with the same messages. The same check finds 80 differing calls in 4,000
against a build using `Math.sqrt(x * x + y * y)`. In Node, `tessellateRibbons`
on 13,169 smooth routes, every route moving, took 7.1 to 7.7 ms median against
9.8 to 10.1 back to back.

AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome 156.0.8078.48 on the
Windows side, headed, attached through `windows-chrome.mjs` with no other
flags, adapter `amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on
every row, control tick 17.6 to 17.7 ms, DPR 1, viewport 1280 by 720, `fit`
(zoom 0.0715), `--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1
--frames=1200`, builds swapped through `packages/render/dist/ribbon.js`, main
(`00e6f6c`) first in each pair. #159 is still open, so main here is without
it. Load average 0.0 to 0.4, read before and after each run. Animated-mode
medians in milliseconds, one value per pair:

| Build | Moving | `setEdges` | `setEdges` p95 | `render` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | all | 9.7, 10.0, 10.1 | 13.8, 13.0, 13.8 | 1.0, 1.0, 1.0 | 2.5, 2.5, 3.1 | 18.4, 18.4, 18.5 | 4.0%, 3.9%, 4.7% |
| this | all | 8.1, 8.1, 7.8 | 10.1, 10.4, 10.2 | 1.0, 1.0, 1.0 | 2.7, 2.6, 2.6 | 18.0, 18.2, 18.4 | 1.9%, 2.1%, 1.4% |
| main | a tenth | 3.1, 3.1, 3.0 | 4.9, 5.0, 4.8 | 1.0, 1.0, 1.0 | 0.5, 0.5, 0.5 | 2.5, 2.6, 1.8 | 0%, 0%, 0% |
| this | a tenth | 2.8, 2.9, 2.8 | 4.6, 4.7, 4.6 | 1.0, 1.0, 1.0 | 0.5, 0.5, 0.6 | 2.6, 1.8, 2.5 | 0%, 0%, 0% |

`render` p95 was 1.1 on every row.

- **With every node moving, `setEdges` fell by 1.6 to 2.3 ms in every pair**,
  its p95 by 2.6 to 3.7, and ticks missed fell in every pair (1.4% to 2.1%
  against 3.9% to 4.7%).
- **With a tenth moving it fell by 0.2 to 0.3 ms**, both builds holding the
  tick, since only the moving tenth of the routes is walked.
- `render`, `advance` and `apply`, which the change does not run, stayed
  within their run-to-run spread.
- A profile of this build, taken as above, put 1,157 ms under the walk (354 of
  it in `hypot`) and 3,172 under `tessellateRibbons`.

Main's ticks missed here (3.9% to 4.7%) are lower again than in "Edge builds
written into the GPU buffers already created, not kept" above (6% to 8%) on
the same machine and browser. The
cause of the spread between sessions was not traced, so compare only within
one table.

What is left of the all-moving frame between retargets is still `setEdges`
(8 ms), most of it `tessellateRibbons` (3,172 ms in the profile of this
build), then `advance`. Inside the
tessellation the next largest own times are `givenCentreline` (327 ms in the
profile of this build), `rib` (302) and `measureSegments` (284, one more
`Math.hypot` and a power per segment of the cleaned route).

### With the segment lengths taken without the `Math.hypot` builtin (2026-10-27)

`tsk_1cae6f72082e`: the next cost inside the tessellation, with every node
moving. A CPU profile of the all-moving smooth row on main (`e384c68`, same
machine, browser and flags as the table below, 600 frames, 8 s sampled every
0.5 ms starting 12 s after the page opened) put 3,043 ms under
`tessellateRibbons`. Its largest own times after the walk's `hypot` (388 ms)
were `measureSegments` (293), `rib` (292) and `givenCentreline` (278).
`measureSegments` still called the `Math.hypot` builtin once per segment of
every moving route's cleaned centreline, to measure the knot widths and the
mean segment the default tolerance is taken from. `rib` is already a capacity
check and ten typed-array stores.

The change: `measureSegments` calls the `hypot` the walk already uses, V8's own
two-argument algorithm written out in `ribbon.ts` (see the section above). In
the Chrome 156 below it returned the same double as `Math.hypot`, by
`Object.is`, over another 10,000,100 pairs (random bit patterns, differences
of random coordinates at scales from 1e-20 to 1e19, and every pair of zeros,
subnormals, `MAX_VALUE`, infinities and `NaN`). The power that turns a length
into a knot width is unchanged.

Byte-identical: main's build and this one, given the same 140,000 random
`tessellateRibbons` calls over 2,800 scenes in Node 22.22.1 (smooth and
polyline, miter limits from 1 to 100, absolute and default tolerances, routes
kept, moved, added, dropped and reversed between calls with the previous build
and size hint passed on, duplicate, near-duplicate and doubled-back points,
scales from 1e-200 to 1e200, subnormal, `MAX_VALUE`, non-finite and non-number
coordinates), returned the same bytes in every array, the same ranges and the
same given points, and refused the same 38,516 calls with the same messages.
The same check finds 671 differing calls in 4,000 against a build using
`Math.sqrt(dx ** 2 + dy ** 2)` there. In Node, `tessellateRibbons` on the frame
profile's 13,169 three-point smooth routes, every route moving, took 7.51 to
7.87 ms median against 7.74 to 8.10 back to back (600 calls after 200 of
warm-up, three alternating pairs).

AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome 156.0.8078.48 on the
Windows side, headed, attached through `windows-chrome.mjs` with no other
flags, adapter `amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on
every row, control tick 17.6 to 17.7 ms, DPR 1, viewport 1280 by 720, `fit`
(zoom 0.0715), `--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1
--frames=1200`, builds swapped through `packages/render/dist/ribbon.js`, main
(`e384c68`) first in each pair. #159 is still open, so main here is without
it. Load average 0.0 to 1.1, read before and after each run. Six pairs in two
rounds of three; the third run of this build in the first round was cut off
and run again straight after. Animated-mode medians in milliseconds, one value
per pair:

| Build | Moving | `setEdges` | `setEdges` p95 | `render` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | all | 7.9, 8.0, 8.0, 7.7, 8.1, 8.0 | 10.5, 10.0, 10.0, 9.9, 10.2, 9.9 | 1.0 in every pair | 2.6, 2.6, 2.5, 2.4, 2.7, 2.7 | 18.6, 18.1, 18.5, 18.1, 18.5, 18.7 | 3.0%, 1.6%, 2.0%, 1.3%, 1.8%, 1.9% |
| this | all | 7.4, 8.0, 7.8, 7.4, 7.4, 7.4 | 9.7, 10.5, 10.2, 9.4, 9.5, 9.8 | 1.0 in every pair | 2.5, 2.7, 2.6, 2.7, 2.8, 3.0 | 18.3, 19.0, 18.4, 18.0, 18.5, 16.0 | 1.3%, 3.0%, 2.8%, 1.8%, 1.7%, 1.4% |
| main | a tenth | 2.9, 2.8, 2.9, 2.9, 3.0, 2.9 | 4.6, 4.6, 4.8, 4.7, 4.7, 4.7 | 1.0 in every pair | 0.5 in every pair | 2.5, 2.6, 1.8, 1.8, 1.8, 2.5 | 0% in every pair |
| this | a tenth | 2.9, 3.0, 2.9, 3.0, 2.9, 2.8 | 4.6, 4.9, 4.6, 4.9, 4.6, 4.6 | 1.0 in every pair | 0.5 in every pair | 1.8, 1.8, 2.3, 1.8, 1.8, 2.0 | 0%, 0%, 0.1%, 0%, 0%, 0% |

`render` p95 was 1.1 or 1.2 on every row.

- **With every node moving, `setEdges` was lower in five pairs of six** (by
  0.2 to 0.7 ms) and equal in one, and its p95 lower in four and higher in
  two. Ticks missed did not separate (1.3% to 3.0% against 1.3% to 3.0%).
- With a tenth moving the change is not resolved, as expected: only the moving
  tenth of the routes is tessellated, and both builds hold the tick.
- Two pairs of CPU profiles, taken as above, resolve what the frame medians
  barely do: `measureSegments`' own time 85 and 107 ms against main's 294 and
  303, the shared `hypot` 446 and 441 against 352 and 363, and
  `tessellateRibbons` 2,924 and 3,004 ms against 3,125 and 3,169, about 0.4 ms
  over each of the roughly 450 frames in the 8 s sampled.
- `advance` and `apply`, which the change does not run, read 2.5 to 3.0 and
  16.0 to 19.0 ms against main's 2.4 to 2.7 and 18.1 to 18.7. Not traced.

What is left of the all-moving frame between retargets is still `setEdges`
(7.4 ms), most of it `tessellateRibbons`, then `advance`. Inside the
tessellation the largest own times are now the walk and `hypot`, `rib`
(a typed-array store per vertex attribute) and `givenCentreline`, which
iterates `points.entries()` and records every coordinate in a growing
`number[]`. The next change is `tsk_a8956f877616`, chosen from a fresh
profile.

### With a route's given points cleaned in one pass (2026-10-27)

`tsk_a8956f877616`: the next cost inside the tessellation, with every node
moving. A CPU profile of the all-moving smooth row on main (`6e76b4b`, same
machine, browser and flags as the table below, 600 frames, 8 s sampled every
0.5 ms starting 12 s after the page opened) put 2,898 ms under
`tessellateRibbons`. Before the flattening, each moving route's points went
through two passes: `givenCentreline` (281 ms own) iterated
`points.entries()`, checked each coordinate and copied it into a scratch
polyline and into the build's record of given points, then `cleanCentreline`
(155 ms own, counting its second call on the flattened points) copied that
polyline again without the points closer than `MIN_SEGMENT_WORLD` to the one
before.

The change: `cleanGivenCentreline` does both in one index loop, from the
given points straight into the cleaned polyline, with the same checks and
messages at the same indices. No arithmetic changes, so nothing here rests
on an engine's rounding.

Byte-identical for routes whose points are an array, as `RibbonRoute` types
them: main's build and this one, given the same 140,000 random
`tessellateRibbons` calls over 2,800 scenes in Node 22.22.1 (smooth and
polyline, miter limits from 1 to 100, absolute and default tolerances, routes
kept, moved, added, dropped and reversed between calls with the previous build
and size hint passed on, duplicate, near-duplicate and doubled-back points,
scales from 1e-19 to 1e19, subnormal, `MAX_VALUE`, non-finite and non-number
coordinates, `null` and missing points), returned the same bytes in every
array, the same ranges and the same given points, and refused the same 42,732
calls with the same messages. The same check finds 2,812 differing calls in
5,000 against a build that records only the points it keeps.

AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome 156.0.8078.48 on the
Windows side, headed, attached through `windows-chrome.mjs` with no other
flags, adapter `amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on
every row, DPR 1, viewport 1280 by 720, `fit` (zoom 0.0715),
`--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1 --frames=1200`,
builds swapped through `packages/render/dist/ribbon.js`, main (`6e76b4b`)
first in each pair. #159 is still open, so main here is without it. Load
average 0.0 to 0.6, read before and after each run. Six pairs in two rounds of
three; main's run of the sixth pair first timed out waiting for the page to
load and was run again straight after. The control tick read 17.6 to 17.7 ms
in the first five runs and 16.7 from this build's run of the third pair on,
in both builds, so the third pair straddles the change. Animated-mode medians in milliseconds, one value per pair:

| Build | Moving | `setEdges` | `setEdges` p95 | `render` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | all | 7.4, 7.3, 7.6, 7.6, 7.4, 7.2 | 9.5, 9.9, 9.5, 9.6, 9.5, 9.5 | 1.0 in every pair | 2.5, 2.8, 2.5, 2.8, 2.8, 2.8 | 18.4, 15.7, 18.3, 18.8, 19.2, 16.9 | 1.2%, 0.8%, 1.8%, 3.7%, 3.7%, 3.6% |
| this | all | 6.8, 6.9, 7.0, 6.8, 6.7, 6.9 | 9.4, 9.2, 9.5, 9.2, 9.0, 9.4 | 1.0 in every pair | 3.2, 2.7, 2.8, 3.0, 2.7, 3.2 | 18.8, 18.1, 16.6, 16.2, 15.0, 19.8 | 2.4%, 1.4%, 1.6%, 2.6%, 2.2%, 3.4% |
| main | a tenth | 2.8, 2.9, 2.9, 2.9, 3.0, 3.0 | 4.7, 4.6, 4.6, 4.7, 4.8, 5.0 | 1.0 in every pair | 0.5 in every pair | 1.8, 1.9, 2.5, 1.9, 1.7, 1.7 | 0% in every pair |
| this | a tenth | 2.7, 2.9, 3.1, 2.9, 2.8, 2.9 | 4.5, 4.8, 4.7, 5.1, 5.0, 5.0 | 1.0 in every pair | 0.6, 0.5, 0.5, 0.5, 0.5, 0.5 | 1.8, 1.7, 1.8, 1.7, 1.8, 1.6 | 0.1%, 0%, 0%, 0%, 0%, 0% |

`render` p95 was 1.1 or 1.2 on every row.

- **With every node moving, `setEdges` was lower in every pair**, by 0.3 to
  0.8 ms, and its p95 lower in five pairs and equal in one. Ticks missed did
  not separate (lower in four pairs, higher in two).
- With a tenth moving the change is not resolved: only the moving tenth of
  the routes is cleaned, and both builds hold the tick.
- `advance` and `apply`, which the change does not run, read 2.7 to 3.2 and
  15.0 to 19.8 ms against main's 2.5 to 2.8 and 15.7 to 19.2. Not traced.
- One pair of CPU profiles, taken as above: `tessellateRibbons` 2,940 ms
  against main's 3,146, about 0.45 ms over each of the roughly 450 frames
  sampled. The one-pass cleaner's own time was 294 ms against main's
  `givenCentreline` 356 in this pair plus about 65 of `cleanCentreline` on the given
  points. In this build's profile V8 inlined `hypot` and `rib` into the walk
  and `flatToChord` into the flattening, which it had not in main's, so the
  other functions' own times do not compare between the two.

What is left of the all-moving frame between retargets is still `setEdges`
(about 7 ms), most of it `tessellateRibbons`, then `advance`. In this build's
profile the largest own times were the walk with its inlined `hypot` and `rib`
(998 ms), the edge half of `advance` (713), the flattening (529) and
`smoothInto` (509). The next change is `tsk_396330099dfb`, chosen from a
fresh profile.

### Flattened points cleaned as they are made, not kept (2026-10-27)

`tsk_396330099dfb`: the next cost inside the tessellation, with every node
moving. A CPU profile of the all-moving smooth row on main (`419b58c`, same
machine, browser and flags as the table below, 600 frames, 8 s sampled every
0.5 ms starting 12 s after the page opened) put 2,975 ms under
`tessellateRibbons`, with own times of 1,083 ms for the walk (`hypot` and
part of `rib` inlined into it), 550 for the flattening, 450 for `smoothInto`, 235 for
`cleanGivenCentreline` and 132 for `cleanCentreline`, which copied every
flattened point into a second polyline without the ones closer than
`MIN_SEGMENT_WORLD` to the last kept. Outside the tessellation: garbage
collection 817, the edge half of `advance` 750.

The change tried: a `Polyline` subclass whose `push` checks and drops as the
flattening writes, so the flattened points are cleaned without a second pass,
a second buffer or the `route "id" flattened` label built per route. No
arithmetic changed. A first version using private fields and `super.push`
was 1.5 ms slower in Node; the one measured below used plain fields and
wrote the store inline.

Byte-identical: main's build and this one, given the same 140,000 random
`tessellateRibbons` calls over 2,800 scenes in Node 22.22.1 (a generator like
the section above's, plus scales up to `1.79e308` and, in a fifth of the
scenes, points near `MAX_VALUE` among small steps so that flattening
overflows after a dropped point), returned the same bytes, ranges and given
points, and refused the same 48,920 calls with the same messages, 7,028 of
them on a flattened point. The same check finds 6 differing calls against a
build that numbers a flattened point by the points kept rather than pushed,
and 401 against one that drops only exact repeats. In Node, `tessellateRibbons`
on 13,169 three-point smooth routes, every route moving, took 7.88 to 8.12 ms
median against 8.07 to 8.14 back to back, two pairs, which did not decide
it, since Node has not been a reliable proxy for the browser here.

AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome 156.0.8078.48 on the
Windows side, headed, attached through `windows-chrome.mjs` with no other
flags, adapter `amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on
every row, control tick 17.6 to 17.7 ms, DPR 1, viewport 1280 by 720, `fit`
(zoom 0.0715), `--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1
--frames=1200`, builds swapped through `packages/render/dist/ribbon.js`, main
(`419b58c`) first in each pair. #159 is still open, so main here is without
it. Load average 0.0 to 0.6, read before and after each run. Six pairs in two
rounds of three. Animated-mode medians in milliseconds, one value per pair:

| Build | Moving | `setEdges` | `setEdges` p95 | `render` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | all | 7.3, 6.9, 6.8, 7.0, 6.9, 7.0 | 9.8, 9.3, 9.3, 9.4, 9.6, 9.4 | 1.0 in every pair | 2.5, 2.6, 2.6, 2.6, 2.5, 2.7 | 18.2, 18.0, 18.4, 18.3, 18.1, 17.7 | 0.8%, 0.9%, 1.0%, 0.8%, 0.4%, 0.8% |
| this | all | 7.2, 7.0, 7.1, 7.1, 6.9, 7.2 | 9.7, 9.2, 9.3, 9.2, 9.2, 9.6 | 1.0 in every pair | 2.6, 2.7, 2.6, 2.5, 2.5, 2.7 | 17.6, 18.0, 18.2, 18.0, 18.4, 18.1 | 1.0%, 1.8%, 1.8%, 1.6%, 1.4%, 1.2% |
| main | a tenth | 2.9, 2.8, 2.8, 2.9, 2.8, 2.8 | 4.6, 4.7, 4.6, 4.6, 4.6, 4.6 | 1.0 in every pair | 0.6, 0.6, 0.6, 0.5, 0.6, 0.5 | 2.6, 2.5, 2.6, 1.8, 2.5, 1.8 | 0%, 0%, 0%, 0.1%, 0%, 0% |
| this | a tenth | 2.9, 2.8, 2.8, 2.8, 2.8, 2.9 | 4.6, 4.6, 4.6, 4.6, 4.5, 4.6 | 1.0 in every pair | 0.5, 0.6, 0.6, 0.5, 0.5, 0.5 | 1.7, 2.5, 2.6, 2.6, 2.0, 1.8 | 0.1%, 0.1%, 0%, 0.1%, 0%, 0% |

`render` p95 was 1.1 on every row.

- **With every node moving, `setEdges` was not lower**: higher in four pairs,
  lower in one and equal in one. Ticks missed were higher in every pair.
- With a tenth moving the change is not resolved; both builds hold the tick.
- One pair of CPU profiles, taken as above: `tessellateRibbons` 2,935 ms
  against main's 2,894, and garbage collection 861 against 864. In this
  pair V8 inlined neither `hypot` nor `flatToChord` in either build, so the
  own times below are lower than in the profile above and compare only
  within the pair. The second pass was gone (main's `cleanCentreline` 123
  and `push` 96), but the flattening's own time rose to 252 from 157 and the
  cleaning `push` read 148, so the check cost about as much inside the
  subdivision loop as the copy did after it.

Not kept. What is left of the all-moving frame between retargets is still
`setEdges` (about 7 ms), most of it the walk, the flattening and the knot
widths, whose arithmetic byte-identical output pins, then garbage collection
(817 to 864 ms of the 8 s sampled, in the three profiles above) and `advance`. The next
change is `tsk_903f42a19c0b`: attribute that collection to its allocation sites
in Chrome and reduce one that #159's buffer reuse does not already address.

### Allocation by site, and the given record sized from the last build, not kept (2026-10-27)

`tsk_903f42a19c0b`: what the all-moving frame's garbage collection collects,
and where it was allocated. A heap sampling profile
(`HeapProfiler.startSampling`, one sample per 16 KB, counting objects that
minor and major collections reclaimed) and a CPU profile were taken over the
same 8 s window, from a second DevTools client attached to the page through
the relay, starting 12 s after the page opened, on the all-moving smooth row
on main (`2a653da`; machine, browser and flags as in the table below,
`--moving=1 --frames=600`). The window covered about 450 frames. Sampled bytes
per frame, in MiB, by the function that allocated them:

| Site | Per frame | What it is |
| --- | --- | --- |
| edge motion `advance` | 7.5 | a new point object per route point per frame, and each edge's velocity array |
| `smoothInto`, with what V8 inlined into it | 3.2 | not resolved below the function |
| `cleanGivenCentreline` | 2.6 | the build's record of given points, a plain array grown one `push` at a time |
| node motion `advance` and `stepSpring2DBy` | 2.6 | a new spring state, position and velocity per moving node |
| `tessellateRibbons`, own | 1.2 | the ranges, `starts` and each route's label string |
| `tessellateCentreline` | 1.0 | not resolved below the function |
| `setNodes` | 0.8 | |
| the harness's own frame loop | 0.8 | |
| everything else | 2.2 | about 0.8 of it retarget work under `prepareRetarget` |

About 22 MiB a frame in all. The edge group's typed arrays (the
tessellation's, the colours and the intensities), which #159's buffer reuse
addresses, do not appear here: a typed array's contents live in an
`ArrayBuffer` outside V8's heap, which the sampling profile does not count.
Everything in the table is what #159 does not cover. The point objects edge
motion hands out are its public frame, so they are not a change this
renderer can make on its own.

The change tried: the record of given points written into an array as long
as the previous build's (`new Array(n)` and indexed writes, trimmed at the
end), with `starts` the same, so it is allocated once at its length rather
than copied about three times over as it grows. Still a plain array, since a
typed array here was measured raising Node's full collections before (see
`RibbonGiven`). No arithmetic changed.

Byte-identical: main's build and this one, given the same 140,000 random
`tessellateRibbons` calls over 2,800 scenes in Node 22.22.1 (smooth and
polyline, miter limits from 1 to 100, absolute and default tolerances, routes
kept, moved, added, dropped, reversed and duplicated between calls with the
previous build and size hint passed on, repeated, near-repeated and
doubled-back points, scales from 1e-19 to 1e19, `-0`, subnormal, `MAX_VALUE`,
non-finite and non-number coordinates, `null` and missing points), returned the
same bytes in every array, the same ranges and the same given points, holes
included, and refused the same 39,521 calls with the same messages. The same
check finds 2,226 differing calls in 5,000 against a build that does not trim
the record, 1,979 against one that does not trim `starts`, and 3,662 against
one that writes each route's start one place late. In Chrome the site fell
from 2.6 MiB a frame to about 1.3: 0.7 where the array is created and 0.6
where its first double is written, since V8 there converts an array created
for small integers into one for doubles. In Node it fell from 2.8 MiB a build
to 0.8.

AMD Ryzen 9 9900X, integrated RDNA 2, Google Chrome 156.0.8078.48 on the
Windows side, headed, attached through `windows-chrome.mjs` with no other
flags, adapter `amd` `rdna-2`, not a fallback, `renderer.backend` `webgpu` on
every row, DPR 1, viewport 1280 by 720, `fit` (zoom 0.0715),
`--motion=springs --sizes=10000 --edges=smooth --moving=1,0.1 --frames=1200`,
builds swapped through `packages/render/dist/ribbon.js` with the browser
cache cleared before each run, main (`2a653da`) first in each pair. #159 is
still open, so main here is without it. Load average 0.0 to 0.6, read before
and after each run. Six pairs in two rounds of three. Chrome closed its
DevTools connection twice in the second round, each time just after a run
had finished: first between the two runs of the fourth pair, which was then
run again whole on a new Chrome, and then after that fourth pair, so the
fifth and sixth pairs ran on a third. Main's run of the fourth pair first
lost its page and main's run of the sixth first timed out waiting for the
page to load; each was run again straight after. The control tick read 17.8
to 17.9 ms in the first round and 16.7 in the second, in both builds, so the
rounds compare within themselves, not with each other. Animated-mode medians
in milliseconds, one value per pair:

| Build | Moving | `setEdges` | `setEdges` p95 | `render` | `advance` | `apply` | Past one tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | all | 7.1, 7.0, 7.2, 7.7, 7.6, 7.4 | 9.4, 9.3, 9.3, 11.3, 10.8, 10.2 | 1.0, 1.0, 1.0, 1.1, 1.0, 1.0 | 2.5, 2.5, 2.5, 5.7, 3.5, 4.0 | 17.5, 17.1, 17.6, 21.6, 17.9, 17.3 | 0.5%, 0.3%, 1.2%, 15.3%, 4.2%, 4.8% |
| this | all | 7.0, 7.2, 7.3, 8.5, 7.8, 7.8 | 9.2, 9.5, 9.5, 13.5, 10.6, 12.3 | 1.0, 1.0, 1.0, 1.1, 1.0, 1.0 | 3.2, 2.5, 2.7, 5.6, 3.6, 3.6 | 15.8, 16.2, 16.2, 23.6, 20.0, 21.1 | 1.1%, 0.4%, 0.6%, 21.3%, 5.3%, 7.4% |
| main | a tenth | 2.8, 2.8, 2.9, 3.2, 3.0, 3.1 | 4.1, 4.1, 3.9, 5.7, 5.2, 5.4 | 1.0, 1.0, 1.0, 1.1, 1.0, 1.1 | 0.5, 0.5, 0.4, 0.5, 0.7, 0.6 | 2.2, 2.1, 1.7, 1.7, 2.0, 1.9 | 0% in every pair |
| this | a tenth | 2.9, 2.9, 3.0, 3.2, 3.1, 3.0 | 4.2, 4.2, 4.3, 5.9, 5.5, 5.5 | 1.0 in every pair | 0.5, 0.5, 0.5, 0.6, 0.6, 0.6 | 1.8, 1.8, 1.8, 2.8, 1.9, 2.8 | 0.1%, 0%, 0%, 0%, 0%, 0% |

`render` p95 was 1.1 to 1.5 on every row.

- **With every node moving, `setEdges` was not lower**: higher in five pairs
  of six, including all three of the second round, and lower in one. Ticks
  missed were higher in five pairs.
- With a tenth moving both builds hold the tick, and `setEdges` was higher in
  four pairs, equal in one and lower in one, by 0.1 ms, the browser's
  resolution, with its p95 higher in all six.
- One pair of CPU profiles, the two taken with the heap profiles above, about
  ten minutes apart in the first round's conditions: garbage collection
  963 ms of the 8 s sampled against main's 939, and `tessellateRibbons` 3,336
  against 3,249. The change took about 1.3 MiB of the frame's 22 (6%), so
  even a collection whose time followed the bytes would have saved about
  55 ms, which one pair cannot tell from noise; it did not fall.

Not kept. A young generation's collection costs what survives a scavenge
rather than what dies in it, so the bytes allocated may not be the measure
to reduce: the largest site, edge motion's points, is kept for one frame, as
each build is kept for the next to copy from. That is a hypothesis, not a
measurement. The next change is
`tsk_5ca35c49f0fc`: split the all-moving frame's collection into scavenges
and full collections with their times, and price what survives a frame,
before choosing another site to reduce.
