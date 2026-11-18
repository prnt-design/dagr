# Outline scaling decision, 2026-11-18

Decline outline virtualization for M5.7c in this increment. On this host the
5,000-item keyboard work did not establish a need to remove offscreen list
items. Keeping every item mounted retains the DOM content used by browser
find-in-page and the native full-list structure. This is a tradeoff in favor
of the existing reading model, not proof of screen-reader behavior or a
performance guarantee on other devices. Revisit for a concrete large-list
consumer or measured latency on its target device.

## Measurement

Base: `a8aaa30ac905f1e6021ba32e635b4e52b02dcafa`. Chromium
148.0.7778.96, Linux headless, AMD Ryzen 9 9900X, production React 19.
The source-bundled `DagrExplorer` used 1,000 or 5,000 independent nodes,
no edges, one group containing every node, custom accessible names, the
standard SVG map and stylesheet, and a long custom drawer. Viewports were
1440 by 900 and 390 by 900 CSS pixels, DPR 1. The narrow profile is a desktop
browser at a narrow width, not a phone or touch-device measurement.

| Items | Width | Median | p95 |
| --- | --- | --- | --- |
| 1,000 | 1440 | 1.4 ms | 1.6 ms |
| 1,000 | 390 | 1.4 ms | 2.0 ms |
| 5,000 | 1440 | 4.3 ms | 4.8 ms |
| 5,000 | 390 | 3.9 ms | 4.6 ms |

Each case dispatched 60 synthetic bubbling ArrowDown events to the focused
button, discarding 10 warmup moves. Each sample spans dispatch through the
next `setTimeout(0)` task, including React's event update work. Two animation
frames separate moves. Values are timer-based main-thread observations,
not trusted-input, input-to-paint, frame-drop or assistive-technology timings.
Median is sorted sample index 25; p95 is index 47, over 50 samples.
[Raw samples and environment](./outline-scaling.json) accompany this report.
The earlier jsdom 27 ms result used a different environment and method and
is not a before/after comparison.

All four cases asserted ArrowDown focus after 60 moves, End reaching the last
item, Home returning to the first, selection, a drawer opening, a controlled
map/outline roundtrip, outline scroll retention, drawer body scroll and focus
retention, all items still mounted, and search selecting the final node.
Custom names were recorded as `Node 00000 custom Test group`; no page errors
were recorded. Keyboard, drawer, map and search screenshots and the exact
capture harness are attached to the task/PR delivery record. The whole
bundle/server/browser window used the canonical exclusive compute lock,
with browser and server teardown in `finally`. An initial attempt stopped
on a harness selector error (textbox instead of searchbox); the corrected
run completed all cases.

## Limits

This synthetic graph isolates list size and does not model dense edges,
expensive host content, changing views, a slow device, or initial mount
latency. The browser run uses React 19 only. Existing React 18/19 and SSR
suites remain the compatibility checks, with no runtime changes in this
increment. Real devices and screen-reader checks remain with M5.8c,
`tsk_7656d37da9de`. Find-in-page and screen-reader announcements were not
measured. Virtualizing would remove offscreen text and native list children
unless additional machinery restores them; those costs need explicit design
and validation before changing this reading alternative.
