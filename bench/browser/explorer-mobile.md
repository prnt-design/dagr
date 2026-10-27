# Explorer mobile reading checks (M5.7b)

This is a library interaction check over `ExplorerRoot`, the current SVG/DOM
base and the public preassembled Explorer. It is separate from renderer
performance measurements and is not a real-device support claim.

Reproduce from the repository root after installing frozen workspace dependencies
and building `@prnt/dagr-layout` and its dependencies:

```sh
npm install --prefix /tmp/dagr-mobile-deps --no-save playwright-core esbuild
/tmp/dagr-mobile-deps/node_modules/.bin/playwright-core install chromium webkit
DAGR_BROWSER_DEPS=/tmp/dagr-mobile-deps node bench/browser/explorer-mobile.mjs --before
DAGR_BROWSER_DEPS=/tmp/dagr-mobile-deps node bench/browser/explorer-mobile.mjs
```

`DAGR_CHROMIUM` optionally selects a Chromium executable. `DAGR_MOBILE_OUT`
selects the evidence directory (default `/tmp/dagr-mobile-evidence`). The
script launches headless browsers, uses an ephemeral server port and closes
contexts, browsers and server on completion or failure. Before mode bundles
the changed library modules and stylesheet from `2a653da`, without modifying
the checkout. After mode bundles current source. Missing browsers are named
in the JSON report, not counted as passes; at least one browser must run.

The fixture uses controlled selection and the default connection list. It
searches Booking, inspects, follows `requires` to Payment and closes. Each
step has a screenshot. Portrait viewports have container width plus 32px of
page margin and height 844px; landscape viewports are 844 by 390px with the
same explicit embedded container width. The widths are 320, 358, 390 and
768 CSS pixels. The extra 358 case reproduces the published demo's measured
container inside a 390px viewport. Landscape also rotates the open reader,
then shrinks the viewport to 320px high without replacing its state.

The after assertions require an uncovered graph area, an onscreen compact
panel after inspection, 44px library controls, keyboard inspect/Escape and
focus return, controlled connection navigation, page scrolling beside the
graph, reduced-motion keyboard zoom, and no horizontal page overflow or page
errors. Chromium additionally receives protocol touch input for pinch, pan,
cancellation and a page swipe over an unfocused graph. Its browser visual
viewport is magnified to 200% and captured, then reset. This is browser visual
zoom, not a claim about desktop Ctrl-plus zoom, OS magnification or Safari.

## Observations and repair

The initial Chromium 145.0.7632.6 headless touch-emulation fixture reproduced
full graph coverage at 320px: graph and details both measured 320 by 482px
(the graph's 480px content height plus borders). At 390px the 360px details
left only 30px of graph width. Close and zoom controls measured 28 by 28px.
The prior published-demo observation at viewport 390 by 844 was a 358 by
480px graph and equally large details, recorded in the M5.7a working notes.

Details now dock below at container widths under 720px. At 390px the panel
measures 390 by 241px in portrait, leaving the other half of the graph
uncovered. In the 390px-high landscape viewport it is capped at 195px.
At 768px it remains a 360px side panel, leaving 408px of graph width.
Close and zoom controls measure 44 by 44px. The same default minimum applies
to search results, connection buttons, trace, view and toolbar controls.
Custom details and replacement host styles remain the host's responsibility.

A landscape search result could open details entirely below the visible page.
The compact panel now scrolls into view once when wholly offscreen, without
moving focus or scrolling again as connections are followed. This measured
case is the reason for that page-scroll change. The first graph touch still
focuses it, focused graph touches own pan/pinch, and an unfocused swipe still
scrolls the page. Search framing waits for the details DOM to commit; an
explicit camera focus reads current obstruction geometry before framing.
There is no additional graph dataset, query implementation or selection store.

## Recorded validation

On 2026-10-27, Chromium 145.0.7632.6 on Linux, headless, touch emulation,
DPR 1, all eight before scenarios completed and all eight after scenarios
passed (ten named checks per after scenario). The 96 screenshots and both
JSON reports are attached to Dispatch task `tsk_eb73b47f05e3`, in the evidence
thread under comment `886f975f-c537-482b-9249-c38c0303e444`. Before mode records
the small controls and coverage; it does not assert the repaired geometry.

| Container | Portrait details after | Landscape details after | Close/zoom after |
| --- | --- | --- | --- |
| 320px | 320 x 241px, bottom | 320 x 195px, bottom | 44 x 44px |
| 358px | 358 x 241px, bottom | 358 x 195px, bottom | 44 x 44px |
| 390px | 390 x 241px, bottom | 390 x 195px, bottom | 44 x 44px |
| 768px | 360 x 482px, right | 360 x 482px, right | 44 x 44px |

The Explorer regression suite passes 478 tests under each of React 18 and
React 19, including SSR/hydration, controlled rejection, cancellation before
the search framing callback, retained details/focus while docking, observer
cleanup and current obstruction geometry before observer delivery.

## Checks that remain unavailable

WebKit 27.2 (Playwright build 2370) downloaded, but could not launch on this
Ubuntu 26.04 host: GTK4, Graphene, GStreamer, libsoup and other shared libraries
are absent. Installing system dependencies requires a sudo password. The
report records the actual launch error. No WebKit check is claimed.

No real iOS/Android device, screen reader or software keyboard was available.
A headless desktop browser with touch emulation does not open an operating
system software keyboard. Viewport shrinking exercises retained state and
reachable controls, not keyboard occlusion or input-method behavior. Real
keyboard occlusion, safe-area behavior on hardware, desktop browser zoom and
WebKit reading/gesture parity remain explicit follow-up checks. No mobile
10k performance claim is made.
