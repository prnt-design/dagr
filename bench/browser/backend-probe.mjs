/**
 * Which backend `@prnt/dagr-render` comes up on in a real browser, and whether the
 * TSL shape graphs draw once it is there.
 *
 * **This is M4.9a's device half, and it is the first thing in this repository
 * that checks a `@prnt/dagr-render` pixel rather than the arithmetic behind one.**
 * `packages/render/src/webgpu-renderer.ts` carries a list of things it calls
 * UNVERIFIED, headed by "that any shape appears at all" and "that the shader
 * computes anything", because a TSL graph built in Node never reaches a
 * backend and never generates code. Opening the same package in a browser is
 * what closes that. On a machine without a WebGPU adapter it closes it for
 * WebGL2 only; see the README for which machines and browsers have one.
 *
 * Outside `pnpm bench:ci` for the reason everything in this directory is: it
 * answers a question once, with numbers, and records how they were taken. It is
 * committed rather than kept in a scratch directory so that `pnpm lint` sees
 * it, which is the rule `card-heights.mjs` learned the hard way.
 *
 * ```
 * pnpm --filter @prnt/dagr-render build      # the page imports from dist
 * npm --prefix bench/browser install --no-save playwright-core
 * python3 -m http.server 8733           # from the REPO ROOT
 * node bench/browser/backend-probe.mjs  # [screenshot.png] [--headed] [--parity] [--pick]
 * ```
 *
 * Pass a path to write the drawn frame there as a PNG. The browser is
 * Playwright's own Chromium unless `DAGR_CHROMIUM` names another executable,
 * and `DAGR_CHROMIUM_ARGS` adds space-separated launch flags. `DAGR_CDP`, a
 * DevTools endpoint such as `windows-chrome.mjs` prints, attaches to a running
 * Chrome instead of launching one. The output
 * records the browser, mode and flags, because a backend result without them
 * cannot be reproduced. `--parity` adds M4.9b's backend comparison and exits
 * non-zero unless it passes and all eighty-eight of its controls fail on
 * what they change. It also exits non-zero when the adapter reports `isFallbackAdapter`: a software
 * adapter such as
 * SwiftShader still comes up on `webgpu`, so its side of the comparison would
 * not be a GPU's. The compared scene has two solid edge ribbons under the
 * shapes, three dashed ones beside them (one through two joins), a smooth
 * one above and a smooth dashed one below and left, and one above the nodes
 * across the circle, drawn over three frames with the dashes' flow advancing;
 * the second control shifts every ribbon, the third flows the dashes further
 * on one side, the fourth draws the smooth ones as polylines, the fifth holds
 * one side's flow at its first frame's and the sixth draws one side's
 * above-nodes ribbon below the nodes. A group outline, `createNodeGroupLayer`'s
 * SVG, is then composed over the first frame on each backend and screenshotted
 * with the layer shown and hidden; the seventh control widens one side's
 * padding and the eighth the outline the page expects on both. Rich-node
 * tiers, `createRichNodes` over `createHtmlOverlay`, are composed and
 * screenshotted the same way; the ninth control moves one side's tier boxes,
 * the tenth widens the boxes the page expects and the eleventh swaps the tiers
 * it expects. The shapes alone are compared again at zoom 0.5 and 2, each
 * with a control that shifts one shape and one that expects zoom 1's shapes,
 * the solid straight ribbons alone at zoom 0.5 and 1.5, each with a
 * control that shifts them and one that expects zoom 1's ribbons, and the
 * three dashed ribbons alone at zoom 0.5 and 1.2, each with a control that
 * flows one side's dashes further and one that expects a period in world units,
 * the solid smooth ribbon alone at zoom 0.5 and 1.2, each with a control
 * that shifts it, one that expects zoom 1's curve and one that draws one
 * side's as a polyline, and the smooth dashed ribbon alone at zoom 0.5 and
 * 1.2, each with the dashed zooms' two controls and one that draws one side's
 * as a polyline, and the above-nodes ribbon with the circle alone at zoom 0.5
 * and 2, each with a control that shifts it, one that expects zoom 1's circle
 * and ribbon and one that draws one side's below the nodes. The shapes alone
 * are compared at device pixel ratio 2 too, with a control that shifts one
 * shape and one that expects ratio 1's shapes, at zoom 1 and at zoom 0.5 and
 * 2, where a third expects zoom 1's shapes. At that ratio, and at zoom 1
 * only, so are the solid straight ribbons alone, with a control that shifts them and one that expects ratio
 * 1's ribbons, the three dashed ribbons alone, with a control that flows
 * one side's dashes further and one that expects a period that doubles with
 * the ratio, the solid smooth ribbon alone, with a control that shifts it,
 * one that expects ratio 1's curve and one that draws one side's as a
 * polyline, the smooth dashed ribbon alone, with a control that flows one
 * side's dashes further, one that expects a period that doubles with the
 * ratio and one that draws one side's as a polyline, and the above-nodes
 * ribbon with the circle alone, with a control that shifts it, one that
 * expects ratio 1's circle and ribbon and one that draws one side's below the
 * nodes.
 * The tiers are checked again at zoom 0.5 and 2, each with a bounds control,
 * a placement control, and a control that expects zoom 1's tiers, and the
 * outline at zoom 0.5 and 1.5, each with a padding control, a
 * placement control, and a control that expects zoom 1's outline, and at
 * device pixel ratio 2 on a page of that device scale factor, with a padding
 * control, a placement control, and a control that expects ratio 1's
 * outline. The tiers are checked at that ratio too, with a bounds control, a
 * placement control, a tier control, and a control that expects ratio 1's
 * boxes. The whole scene is compared at that ratio too, with the six
 * controls of ratio 1 and one that expects ratio 1's scene.
 * `--pick` adds M4.8b's check of `pickNode` on both backends at device pixel
 * ratios 1 and 2, at zoom 1 and at zoom 0.5 and 1.2 with a panned camera,
 * and exits non-zero on the same adapter terms or on any pick
 * that disagrees with the shapes' distance functions.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPS = process.env.DAGR_BROWSER_DEPS ?? fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(DEPS, 'package.json'));
const { chromium } = require('playwright-core');

const ROOT = new URL('../..', import.meta.url).pathname;
const ORIGIN = 'http://127.0.0.1:8733';

const EXECUTABLE = process.env.DAGR_CHROMIUM;
const LAUNCH_ARGS = (process.env.DAGR_CHROMIUM_ARGS ?? '').split(' ').filter(Boolean);
const CDP = process.env.DAGR_CDP;
const CONTROL_SHIFT_PX = 1 / 3;
const EDGE_CONTROL_SHIFT_PX = 2;
// A quarter of the dash period: wider than the band, so dash ends leave it.
const DASH_CONTROL_SHIFT_PX = 3;
// Less than the 2 px ring, so only the check named in each control can see it.
// At device pixel ratio 2 the ring is 3 px and a 1.5 device pixel shift fails
// placement on antialiasing alone, so the controls move by this many CSS
// pixels (3 device pixels) instead.
const GROUP_CONTROL_SHIFT_PX = 1.5;
// More than the 1 px a tier's box edge may sit from where the page expects it.
const RICH_CONTROL_SHIFT_PX = 1.5;
// Either side of zoom 1, where the tiers both nodes show differ from zoom 1's.
const RICH_ZOOMS = [0.5, 2];
// At zoom 1, on a page whose device scale factor matches, where the gates,
// read in CSS pixels, pick zoom 1's tiers.
const RICH_DPRS = [2];
// Either side of zoom 1, with the outline's corners scaled at 0.5; at 2 its
// left side leaves the frame.
const GROUP_ZOOMS = [0.5, 1.5];
// At zoom 1, on a page whose device scale factor matches, so each screenshot
// is the drawing buffer's size.
const GROUP_DPRS = [2];
// Either side of zoom 1, with both shapes and their glow inside the frame.
const SHAPE_ZOOMS = [0.5, 2];
// At zoom 1, where a device pixel is half a world unit and the frame is twice
// as many device pixels across, and at each of SHAPE_ZOOMS, where the frame
// covers the same world as at ratio 1.
const SHAPE_DPRS = [2];
// Either side of zoom 1, with both of the elbow's joins inside the frame; at 2
// its middle run leaves it. At 1.5 the diagonal's first cap is outside it.
const RIBBON_ZOOMS = [0.5, 1.5];
// At zoom 1, where the frame covers the same world as at ratio 1.
const RIBBON_DPRS = [2];
// Either side of zoom 1, with the dashed joins' right angle and fanned turn
// inside the frame; above about 1.21 the horizontal's lower edge leaves it. At
// 1.2 the diagonal's first cap and the joined route's last run are outside it.
const DASH_ZOOMS = [0.5, 1.2];
// At zoom 1, where the frame covers the same world as at ratio 1.
const DASH_DPRS = [2];
// Either side of zoom 1, with the whole curve inside the frame; above about
// 1.21 its top leaves it.
const SMOOTH_ZOOMS = [0.5, 1.2];
// At zoom 1, where the frame covers the same world as at ratio 1.
const SMOOTH_DPRS = [2];
// Either side of zoom 1, with both of the curve's turns inside the frame. Above
// about 1.08 its first cap starts to leave it, and at 1.2 so does about two
// thirds of the way to its first turn.
const SMOOTH_DASH_ZOOMS = [0.5, 1.2];
// At zoom 1, where the frame covers the same world as at ratio 1.
const SMOOTH_DASH_DPRS = [2];
// Either side of zoom 1, with the circle, its glow and the whole ribbon inside
// the frame; above about 2.18 the ribbon's end leaves it.
const ABOVE_ZOOMS = [0.5, 2];
// At zoom 1, where the frame covers the same world as at ratio 1.
const ABOVE_DPRS = [2];
// The whole scene at zoom 1, where the frame covers the same world as at ratio 1.
const SCENE_DPRS = [2];

/**
 * The page's import map, filled in from this process's own module resolution.
 *
 * The two specifiers `@prnt/dagr-render`'s dist actually imports are `three/webgpu`
 * and `three/tsl`, resolved against the package that declares three as a peer
 * dependency so the copy the page loads is the copy the package was built
 * against. Written this way rather than committed as literal paths because a
 * pnpm store path carries the three version in it, so a committed one would
 * point at a directory that no longer exists after the next bump, and the
 * symptom would be a 404 in a page that otherwise looks fine.
 */
function pageHtml() {
  const fromRender = createRequire(`${ROOT}packages/render/package.json`);
  const served = (specifier) => {
    const resolved = fromRender.resolve(specifier);
    // The static server's root is the repository, so a path outside it has no
    // URL at all. Checked rather than assumed, because the slice below would
    // otherwise produce a plausible-looking URL out of an unrelated absolute
    // path and the only symptom would be a 404 in a page that loads.
    if (!resolved.startsWith(ROOT)) {
      throw new Error(
        `${specifier} resolved to ${resolved}, which is outside ${ROOT} and cannot be served`,
      );
    }
    // ROOT ends in a slash, so dropping one character short of its length keeps
    // the leading slash the page's import map needs.
    return resolved.slice(ROOT.length - 1);
  };
  return readFileSync(`${ROOT}bench/browser/backend-probe.html`, 'utf8')
    .replace('__THREE_WEBGPU__', served('three/webgpu'))
    .replace('__THREE_TSL__', served('three/tsl'));
}

function shapeFailure(check) {
  if (check.error !== undefined) return check.error;
  const reasons = [];
  if (check.backends.webgpu !== 'webgpu' || check.backends.webgl2 !== 'webgl2') {
    reasons.push(`the frames drew on ${check.backends.webgpu} and ${check.backends.webgl2}, not webgpu and webgl2`);
  }
  if (!check.sameSize) reasons.push("the two backends' frames are different sizes");
  if (!check.filled) {
    reasons.push(`${check.fill.filled} of ${check.fill.pixels} pixels inside the fills hold the fill colour on webgpu`);
  }
  if (check.interior.maxDelta > check.tolerance.interiorMaxDelta) {
    reasons.push(
      `${check.interior.differing} interior pixels differ, by up to ${check.interior.maxDelta} against a tolerance of ${check.tolerance.interiorMaxDelta}`,
    );
  }
  return reasons.join('; ');
}

/**
 * Why a shape control at another zoom did not fail on the check it is aimed
 * at: the shift only on the interior, the expected zoom only on the fills.
 */
function shapeControlFailure(control, aimedAt) {
  if (control.pass) return 'passed, so the check cannot see what it changes';
  const shifted = control.interior?.maxDelta > control.tolerance?.interiorMaxDelta;
  const onAim = aimedAt === 'interior' ? shifted && control.filled : !shifted && !control.filled;
  return control.error === undefined &&
    control.backends.webgpu === 'webgpu' &&
    control.backends.webgl2 === 'webgl2' &&
    control.sameSize &&
    onAim
    ? undefined
    : `failed, but not on what it changes: ${shapeFailure(control)}`;
}

function ribbonFailure(check) {
  if (check.error !== undefined) return check.error;
  const reasons = [];
  if (check.backends.webgpu !== 'webgpu' || check.backends.webgl2 !== 'webgl2') {
    reasons.push(`the frames drew on ${check.backends.webgpu} and ${check.backends.webgl2}, not webgpu and webgl2`);
  }
  if (!check.sameSize) reasons.push("the two backends' frames are different sizes");
  if (check.ribbon.pixels === 0 || check.ribbon.edgeColored < check.ribbon.pixels) {
    reasons.push(`${check.ribbon.edgeColored} of ${check.ribbon.pixels} pixels inside the ribbons hold the edge colour on webgpu`);
  }
  if (check.beside.pixels === 0 || check.beside.clear < check.beside.pixels) {
    reasons.push(`${check.beside.clear} of ${check.beside.pixels} pixels just outside them hold the clear colour on webgpu`);
  }
  if (check.interior.maxDelta > check.tolerance.interiorMaxDelta) {
    reasons.push(
      `${check.interior.differing} interior pixels differ, by up to ${check.interior.maxDelta} against a tolerance of ${check.tolerance.interiorMaxDelta}`,
    );
  }
  return reasons.join('; ');
}

/**
 * Why a ribbon control at another zoom or ratio did not fail on the check it
 * is aimed at: the shift only on the interior, the expected zoom or ratio only
 * on the edge colour.
 */
function ribbonControlFailure(control, aimedAt) {
  if (control.pass) return 'passed, so the check cannot see what it changes';
  const shifted = control.interior?.maxDelta > control.tolerance?.interiorMaxDelta;
  const unlit = control.ribbon?.edgeColored < control.ribbon?.pixels;
  const onAim = aimedAt === 'interior' ? shifted && control.ribbonDrawn : !shifted && unlit;
  return control.error === undefined &&
    control.backends.webgpu === 'webgpu' &&
    control.backends.webgl2 === 'webgl2' &&
    control.sameSize &&
    onAim
    ? undefined
    : `failed, but not on what it changes: ${ribbonFailure(control)}`;
}

function aboveFailure(check) {
  if (check.error !== undefined) return check.error;
  const reasons = [];
  if (check.backends.webgpu !== 'webgpu' || check.backends.webgl2 !== 'webgl2') {
    reasons.push(`the frames drew on ${check.backends.webgpu} and ${check.backends.webgl2}, not webgpu and webgl2`);
  }
  if (!check.sameSize) reasons.push("the two backends' frames are different sizes");
  if (!check.aboveDrawn) {
    reasons.push(
      `${check.ribbon.edgeColored} of ${check.ribbon.pixels} pixels inside the above-nodes ribbon hold the edge colour on webgpu, ${check.over.pixels} of them over the circle's fill`,
      `${check.fill.filled} of ${check.fill.pixels} pixels inside the circle's fill clear of the ribbon hold the fill colour on webgpu`,
    );
  }
  if (check.interior.maxDelta > check.tolerance.interiorMaxDelta) {
    reasons.push(
      `${check.interior.differing} interior pixels differ, by up to ${check.interior.maxDelta} against a tolerance of ${check.tolerance.interiorMaxDelta}`,
    );
  }
  return reasons.join('; ');
}

/**
 * Why an above-nodes control at another zoom did not fail on the check it is
 * aimed at: the shift and the layer only on the interior, the expected zoom
 * only on the ribbon's colour.
 */
function aboveControlFailure(control, aimedAt) {
  if (control.pass) return 'passed, so the check cannot see what it changes';
  const shifted = control.interior?.maxDelta > control.tolerance?.interiorMaxDelta;
  const unlit = control.ribbon?.edgeColored < control.ribbon?.pixels;
  const onAim = aimedAt === 'interior' ? shifted && control.aboveDrawn : !shifted && unlit;
  return control.error === undefined &&
    control.backends.webgpu === 'webgpu' &&
    control.backends.webgl2 === 'webgl2' &&
    control.sameSize &&
    onAim
    ? undefined
    : `failed, but not on what it changes: ${aboveFailure(control)}`;
}

function dashFailure(check) {
  if (check.error !== undefined) return check.error;
  const reasons = [];
  if (check.backends.webgpu !== 'webgpu' || check.backends.webgl2 !== 'webgl2') {
    reasons.push(`the frames drew on ${check.backends.webgpu} and ${check.backends.webgl2}, not webgpu and webgl2`);
  }
  if (!check.sameSize) reasons.push("the two backends' frames are different sizes");
  if (check.dash.pixels === 0 || check.dash.edgeColored < check.dash.pixels) {
    reasons.push(`${check.dash.edgeColored} of ${check.dash.pixels} pixels inside the dashes hold the edge colour on webgpu`);
  }
  if (check.gap.pixels === 0 || check.gap.clear < check.gap.pixels) {
    reasons.push(`${check.gap.clear} of ${check.gap.pixels} pixels inside the dash gaps hold the clear colour on webgpu`);
  }
  if (check.interior.maxDelta > check.tolerance.interiorMaxDelta) {
    reasons.push(
      `${check.interior.differing} interior pixels differ, by up to ${check.interior.maxDelta} against a tolerance of ${check.tolerance.interiorMaxDelta}`,
    );
  }
  return reasons.join('; ');
}

/**
 * Why a dash control at another zoom did not fail on the check it is aimed
 * at: the flow only on the interior, the world-unit period only on the dash
 * and gap colours.
 */
function dashControlFailure(control, aimedAt) {
  if (control.pass) return 'passed, so the check cannot see what it changes';
  const shifted = control.interior?.maxDelta > control.tolerance?.interiorMaxDelta;
  const miscoloured =
    control.dash?.edgeColored < control.dash?.pixels || control.gap?.clear < control.gap?.pixels;
  const onAim = aimedAt === 'interior' ? shifted && control.dashesDrawn : !shifted && miscoloured;
  return control.error === undefined &&
    control.backends.webgpu === 'webgpu' &&
    control.backends.webgl2 === 'webgl2' &&
    control.sameSize &&
    onAim
    ? undefined
    : `failed, but not on what it changes: ${dashFailure(control)}`;
}

function parityFailure(check) {
  if (check.error !== undefined) return check.error;
  const reasons = [];
  if (check.backends.webgpu !== 'webgpu' || check.backends.webgl2 !== 'webgl2') {
    reasons.push(`the frames drew on ${check.backends.webgpu} and ${check.backends.webgl2}, not webgpu and webgl2`);
  }
  if (!check.sameSize) reasons.push("the two backends' frames are different sizes");
  if (!check.ribbonDrawn) {
    reasons.push(
      `${check.ribbon.edgeColored} of ${check.ribbon.pixels} pixels inside the ribbons hold the edge colour on webgpu`,
      `${check.gap.clear} of ${check.gap.pixels} pixels inside the dash gaps hold the clear colour on webgpu`,
      `${check.curve.edgeColored} of ${check.curve.pixels} pixels inside the solid smooth ribbon hold the edge colour on webgpu`,
      `${check.curvedDash.edgeColored} of ${check.curvedDash.pixels} pixels inside the smooth dashed ribbon's dashes hold the edge colour on webgpu`,
      `${check.curvedDash.clear} of ${check.curvedDash.gapPixels} pixels inside the smooth dashed ribbon's gaps hold the clear colour on webgpu`,
      `${check.over.edgeColored} of ${check.over.pixels} pixels inside the above-nodes ribbon over the circle's fill hold the edge colour on webgpu`,
    );
  }
  if (check.interior.maxDelta > check.tolerance.interiorMaxDelta) {
    reasons.push(
      `${check.interior.differing} interior pixels differ, by up to ${check.interior.maxDelta} against a tolerance of ${check.tolerance.interiorMaxDelta}`,
    );
  }
  return `${reasons.join('; ')} (counts summed over ${check.frames.length} frames)`;
}

/**
 * Why the control did not fail the way it must, or undefined when it did. A
 * control that threw, drew on the wrong backend or compared frames of different
 * sizes also reports `pass: false`, but says nothing about whether the check
 * can see a shifted shape, ribbon, dash pattern, curve, flow or layer.
 */
function controlFailure(control, moved) {
  if (control.pass) return `passed, so the check cannot see a misplaced ${moved}`;
  const failedOnShift =
    control.error === undefined &&
    control.backends.webgpu === 'webgpu' &&
    control.backends.webgl2 === 'webgl2' &&
    control.sameSize &&
    control.ribbonDrawn &&
    control.interior.maxDelta > control.tolerance.interiorMaxDelta;
  return failedOnShift ? undefined : `failed, but not on what it changes: ${parityFailure(control)}`;
}

/**
 * The same for the scene's ratio control, which must fail only on the colour
 * checks, with pixels it expected in one colour holding another rather than
 * with a check left empty.
 */
function sceneRatioControlFailure(control) {
  if (control.pass) return 'passed, so the check cannot see that the scene follows the ratio';
  const miscoloured =
    control.error === undefined &&
    [
      [control.ribbon.edgeColored, control.ribbon.pixels],
      [control.gap.clear, control.gap.pixels],
      [control.curve.edgeColored, control.curve.pixels],
      [control.curvedDash.edgeColored, control.curvedDash.pixels],
      [control.curvedDash.clear, control.curvedDash.gapPixels],
      [control.over.edgeColored, control.over.pixels],
    ].some(([held, of]) => of > 0 && held < of);
  const onAim =
    miscoloured &&
    control.backends.webgpu === 'webgpu' &&
    control.backends.webgl2 === 'webgl2' &&
    control.sameSize &&
    control.interior.maxDelta <= control.tolerance.interiorMaxDelta;
  return onAim ? undefined : `failed, but not on what it changes: ${parityFailure(control)}`;
}

/**
 * The reasons every composed layer shares: `{ done }` when the check stopped
 * before comparing, otherwise `{ reasons }` to add to.
 */
function composedReasons(check) {
  if (check.error !== undefined) return { done: check.error };
  if (!check.sameSize) return { done: `the composed frames are different sizes: ${JSON.stringify(check.sizes)}` };
  const reasons = [];
  if (check.backends.webgpu !== 'webgpu' || check.backends.webgl2 !== 'webgl2') {
    reasons.push(`the frames drew on ${check.backends.webgpu} and ${check.backends.webgl2}, not webgpu and webgl2`);
  }
  for (const [backend, matched] of Object.entries(check.canvasMatched)) {
    if (!matched) reasons.push(`on ${backend} the screenshot without the layer does not match the canvas read back`);
  }
  return { reasons };
}

function addedReason(check, reasons) {
  if (check.added.pixels > 0) {
    reasons.push(`the layer adds ${check.added.pixels} differing pixels, by up to ${check.added.maxDelta}`);
  }
  return reasons.join('; ');
}

function groupFailure(check) {
  const { done, reasons } = composedReasons(check);
  if (done !== undefined) return done;
  for (const [backend, outline] of Object.entries(check.outline)) {
    if (!outline.placed) {
      reasons.push(
        `on ${backend} the layer changed ${outline.ring} pixels on the outline, ${outline.title} in the title and ${outline.stray} elsewhere, spanning ${JSON.stringify(outline.span)} against ${JSON.stringify(outline.box)}`,
      );
    }
  }
  return addedReason(check, reasons);
}

function richFailure(check) {
  const { done, reasons } = composedReasons(check);
  if (done !== undefined) return done;
  for (const [backend, { nodes, stray, placed, tiered }] of Object.entries(check.tiers)) {
    if (placed && tiered) continue;
    const each = nodes.map(
      (node) =>
        `${node.id} changed ${node.changed} pixels spanning ${JSON.stringify(node.span)} against ${JSON.stringify(node.box)}, ${node.colored} of ${node.inside} inside it in the ${node.tier} colour`,
    );
    reasons.push(`on ${backend} ${each.join(', ')}, and ${stray} elsewhere`);
  }
  return addedReason(check, reasons);
}

/**
 * A composed layer's frames on both backends, each screenshotted with the
 * layer shown and hidden, or an error. `frame` names the page function that
 * mounts the layer, given the WebGL2 side's control `shift`, the `zoom` and
 * the `dpr`, on the page whose device scale factor is `dpr`.
 */
async function composedShots(frame, shift, zoom = 1, dpr = 1) {
  const on = await pageAt(dpr);
  const shots = {};
  for (const backend of ['webgpu', 'webgl2']) {
    const mounted = await on.evaluate(([name, value, by, at, ratio]) => window[name](value, by, at, ratio), [
      frame,
      backend,
      backend === 'webgl2' ? shift : 0,
      zoom,
      dpr,
    ]);
    if (mounted.error !== undefined) return { error: `${backend}: ${mounted.error}` };
    try {
      const shown = (await on.locator('#frame').screenshot()).toString('base64');
      await on.evaluate(() => window.composedHide());
      const hidden = (await on.locator('#frame').screenshot()).toString('base64');
      shots[backend === 'webgpu' ? 'gpu' : 'gl'] = { reported: mounted.reported, shown, hidden };
    } finally {
      await on.evaluate(() => window.composedRelease());
    }
  }
  return shots;
}

/** The check runs on the page the shots were taken on, which holds their canvas read back. */
async function composedParity(check, shots, args) {
  if (shots.error !== undefined) return { pass: false, error: shots.error };
  const on = await pageAt(args.dpr ?? 1);
  return on.evaluate(([name, value]) => window[name](value), [check, { ...shots, ...args }]);
}

/**
 * Why an outline control did not fail on the check it is aimed at, or
 * undefined when it did. `paddingShift` must fail only on the difference the
 * layer adds between the backends, `expectedShift`, `expectedZoom` and
 * `expectedDpr` only on placement.
 */
function groupControlFailure(control, aimedAt) {
  if (control.pass) return 'passed, so the check cannot see a misplaced outline';
  const onAim =
    aimedAt === 'added'
      ? control.placed && control.added.pixels > 0
      : !control.placed && control.added.pixels === 0;
  return control.error === undefined && control.sameSize && control.sound && onAim
    ? undefined
    : `failed, but not on what it changes: ${groupFailure(control)}`;
}

/**
 * The same for a tier control: `boundsShift` must fail only on the difference
 * the tiers add, `expectedShift` and `expectedDpr` only on placement,
 * `swapTiers` and `expectedZoom` only on which tier a node shows. A wider or
 * moved expected box also takes pixels the tiers do not cover into the colour
 * test, so `expectedShift` and `expectedDpr` may fail on the colour too.
 */
function richControlFailure(control, aimedAt) {
  if (control.pass) return 'passed, so the check cannot see a misplaced or wrong tier';
  const fails = {
    added: control.added?.pixels > 0,
    placed: control.placed === false,
    tiered: control.tiered === false,
  };
  const onAim = Object.entries(fails).every(
    ([check, failed]) => failed === (check === aimedAt) || (aimedAt === 'placed' && check === 'tiered'),
  );
  return control.error === undefined && control.sameSize && control.sound && onAim
    ? undefined
    : `failed, but not on what it changes: ${richFailure(control)}`;
}

function pickFailure(run) {
  if (run.error !== undefined) return run.error;
  const reasons = [];
  if (run.reported !== run.backend) reasons.push(`the renderer came up on ${run.reported}`);
  if (run.mismatchCount > 0) reasons.push(`${run.mismatchCount} of ${run.checked} picks disagree`);
  const missed = Object.entries(run.hits)
    .filter(([id, count]) => id !== 'background' && count === 0)
    .map(([id]) => id);
  if (missed.length > 0) reasons.push(`no pick hit ${missed.join(', ')}`);
  return reasons.join('; ');
}

const cliArgs = process.argv.slice(2);
const headless = !cliArgs.includes('--headed');
if (!headless && CDP !== undefined) {
  throw new Error('--headed chooses how a browser is launched; an attached one (DAGR_CDP) runs as it was started');
}
const screenshotPath = cliArgs.find((arg) => !arg.startsWith('--'));
const browser =
  CDP === undefined
    ? await chromium.launch({
        headless,
        args: LAUNCH_ARGS,
        ...(EXECUTABLE === undefined ? {} : { executablePath: EXECUTABLE }),
      })
    : await chromium.connectOverCDP(CDP);
const warnings = [];

async function openPage(deviceScaleFactor) {
  const opened = await browser.newPage({ viewport: { width: 640, height: 420 }, deviceScaleFactor });
  opened.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  opened.on('pageerror', (error) => warnings.push(`pageerror: ${String(error)}`));
  // `setContent` rather than a static file, because the import map has to be
  // filled in first. The base URL still has to be the server's, or the page's own
  // absolute import of `/packages/render/dist/index.js` has nothing to resolve
  // against, so the route is intercepted rather than the file rewritten on disk.
  await opened.route(`${ORIGIN}/bench/browser/backend-probe.html`, (route) =>
    route.fulfill({ contentType: 'text/html', body: pageHtml() }),
  );
  await opened.goto(`${ORIGIN}/bench/browser/backend-probe.html`, { waitUntil: 'load' });
  await opened.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
  return opened;
}

const page = await openPage(1);
// A screenshot is taken at the page's device scale factor, so a composed
// layer at another device pixel ratio needs a page of its own.
const pages = new Map([[1, page]]);
async function pageAt(dpr) {
  if (!pages.has(dpr)) pages.set(dpr, await openPage(dpr));
  const at = pages.get(dpr);
  await at.bringToFront();
  return at;
}

const advertised = await page.evaluate(() => window.webgpuAdvertised());
const results = [];
for (const preference of ['auto', 'webgpu', 'webgl2']) {
  results.push(await page.evaluate((value) => window.probe(value), preference));
}
let parity;
if (cliArgs.includes('--parity')) {
  if (advertised.adapter?.isFallbackAdapter === true) {
    console.error(
      `the adapter is a fallback adapter (${advertised.adapter.vendor} ${advertised.adapter.architecture}), not a GPU, so this parity run is not a WebGPU result`,
    );
    process.exitCode = 1;
  }
  // The check waits on animation frames, which a hidden or occluded tab does
  // not run, so the evaluate would hang rather than fail.
  await page.bringToFront();
  parity = {
    check: await page.evaluate(() => window.parity()),
    control: await page.evaluate((shift) => window.parity(shift), CONTROL_SHIFT_PX),
    edgeControl: await page.evaluate((shift) => window.parity(0, shift), EDGE_CONTROL_SHIFT_PX),
    dashControl: await page.evaluate((shift) => window.parity(0, 0, shift), DASH_CONTROL_SHIFT_PX),
    curveControl: await page.evaluate(() => window.parity(0, 0, 0, true)),
    flowControl: await page.evaluate(() => window.parity(0, 0, 0, false, true)),
    layerControl: await page.evaluate(() => window.parity(0, 0, 0, false, false, true)),
  };
  parity.sceneDprs = [];
  for (const dpr of SCENE_DPRS) {
    const at = (args) => page.evaluate((values) => window.parity(...values), args);
    parity.sceneDprs.push({
      zoom: 1,
      dpr,
      check: await at([0, 0, 0, false, false, false, dpr]),
      control: await at([CONTROL_SHIFT_PX / dpr, 0, 0, false, false, false, dpr]),
      edgeControl: await at([0, EDGE_CONTROL_SHIFT_PX / dpr, 0, false, false, false, dpr]),
      dashControl: await at([0, 0, DASH_CONTROL_SHIFT_PX, false, false, false, dpr]),
      curveControl: await at([0, 0, 0, true, false, false, dpr]),
      flowControl: await at([0, 0, 0, false, true, false, dpr]),
      layerControl: await at([0, 0, 0, false, false, true, dpr]),
      ratioControl: await at([0, 0, 0, false, false, false, dpr, 1]),
    });
  }
  parity.shapeZooms = [];
  for (const zoom of SHAPE_ZOOMS) {
    parity.shapeZooms.push({
      zoom,
      check: await page.evaluate((at) => window.shapeParity(at), zoom),
      control: await page.evaluate(([at, shift]) => window.shapeParity(at, shift), [zoom, CONTROL_SHIFT_PX / zoom]),
      zoomControl: await page.evaluate((at) => window.shapeParity(at, 0, 1), zoom),
    });
  }
  for (const dpr of SHAPE_DPRS) {
    for (const zoom of [1, ...SHAPE_ZOOMS]) {
      const at = (shift, expectedZoom, expectedDpr) =>
        page.evaluate((args) => window.shapeParity(...args), [zoom, shift, expectedZoom, dpr, expectedDpr]);
      parity.shapeZooms.push({
        zoom,
        dpr,
        check: await at(0, zoom, dpr),
        control: await at(CONTROL_SHIFT_PX / (zoom * dpr), zoom, dpr),
        ratioControl: await at(0, zoom, 1),
        ...(zoom === 1 ? {} : { zoomControl: await at(0, 1, dpr) }),
      });
    }
  }
  parity.ribbonZooms = [];
  for (const zoom of RIBBON_ZOOMS) {
    parity.ribbonZooms.push({
      zoom,
      check: await page.evaluate((at) => window.ribbonParity(at), zoom),
      control: await page.evaluate(([at, shift]) => window.ribbonParity(at, shift), [zoom, EDGE_CONTROL_SHIFT_PX / zoom]),
      zoomControl: await page.evaluate((at) => window.ribbonParity(at, 0, 1), zoom),
    });
  }
  for (const dpr of RIBBON_DPRS) {
    parity.ribbonZooms.push({
      zoom: 1,
      dpr,
      check: await page.evaluate((ratio) => window.ribbonParity(1, 0, 1, false, 'smooth', ratio), dpr),
      control: await page.evaluate(
        ([ratio, shift]) => window.ribbonParity(1, shift, 1, false, 'smooth', ratio),
        [dpr, EDGE_CONTROL_SHIFT_PX / dpr],
      ),
      zoomControl: await page.evaluate((ratio) => window.ribbonParity(1, 0, 1, false, 'smooth', ratio, 1), dpr),
    });
  }
  parity.smoothZooms = [];
  for (const zoom of SMOOTH_ZOOMS) {
    parity.smoothZooms.push({
      zoom,
      check: await page.evaluate((at) => window.ribbonParity(at, 0, at, true), zoom),
      control: await page.evaluate(
        ([at, shift]) => window.ribbonParity(at, shift, at, true),
        [zoom, EDGE_CONTROL_SHIFT_PX / zoom],
      ),
      zoomControl: await page.evaluate((at) => window.ribbonParity(at, 0, 1, true), zoom),
      curveControl: await page.evaluate((at) => window.ribbonParity(at, 0, at, true, 'polyline'), zoom),
    });
  }
  for (const dpr of SMOOTH_DPRS) {
    parity.smoothZooms.push({
      zoom: 1,
      dpr,
      check: await page.evaluate((ratio) => window.ribbonParity(1, 0, 1, true, 'smooth', ratio), dpr),
      control: await page.evaluate(
        ([ratio, shift]) => window.ribbonParity(1, shift, 1, true, 'smooth', ratio),
        [dpr, EDGE_CONTROL_SHIFT_PX / dpr],
      ),
      zoomControl: await page.evaluate((ratio) => window.ribbonParity(1, 0, 1, true, 'smooth', ratio, 1), dpr),
      curveControl: await page.evaluate((ratio) => window.ribbonParity(1, 0, 1, true, 'polyline', ratio), dpr),
    });
  }
  parity.dashZooms = [];
  for (const zoom of DASH_ZOOMS) {
    parity.dashZooms.push({
      zoom,
      check: await page.evaluate((at) => window.dashParity(at), zoom),
      control: await page.evaluate(([at, shift]) => window.dashParity(at, shift), [zoom, DASH_CONTROL_SHIFT_PX]),
      zoomControl: await page.evaluate((at) => window.dashParity(at, 0, 1), zoom),
    });
  }
  for (const dpr of DASH_DPRS) {
    parity.dashZooms.push({
      zoom: 1,
      dpr,
      check: await page.evaluate((ratio) => window.dashParity(1, 0, 1, false, 'smooth', ratio), dpr),
      control: await page.evaluate(
        ([ratio, shift]) => window.dashParity(1, shift, 1, false, 'smooth', ratio),
        [dpr, DASH_CONTROL_SHIFT_PX],
      ),
      zoomControl: await page.evaluate((ratio) => window.dashParity(1, 0, 1, false, 'smooth', ratio, 1), dpr),
    });
  }
  parity.smoothDashZooms = [];
  for (const zoom of SMOOTH_DASH_ZOOMS) {
    parity.smoothDashZooms.push({
      zoom,
      check: await page.evaluate((at) => window.dashParity(at, 0, at, true), zoom),
      control: await page.evaluate(
        ([at, shift]) => window.dashParity(at, shift, at, true),
        [zoom, DASH_CONTROL_SHIFT_PX],
      ),
      zoomControl: await page.evaluate((at) => window.dashParity(at, 0, 1, true), zoom),
      curveControl: await page.evaluate((at) => window.dashParity(at, 0, at, true, 'polyline'), zoom),
    });
  }
  for (const dpr of SMOOTH_DASH_DPRS) {
    parity.smoothDashZooms.push({
      zoom: 1,
      dpr,
      check: await page.evaluate((ratio) => window.dashParity(1, 0, 1, true, 'smooth', ratio), dpr),
      control: await page.evaluate(
        ([ratio, shift]) => window.dashParity(1, shift, 1, true, 'smooth', ratio),
        [dpr, DASH_CONTROL_SHIFT_PX],
      ),
      zoomControl: await page.evaluate((ratio) => window.dashParity(1, 0, 1, true, 'smooth', ratio, 1), dpr),
      curveControl: await page.evaluate((ratio) => window.dashParity(1, 0, 1, true, 'polyline', ratio), dpr),
    });
  }
  parity.aboveZooms = [];
  for (const zoom of ABOVE_ZOOMS) {
    parity.aboveZooms.push({
      zoom,
      check: await page.evaluate((at) => window.aboveParity(at), zoom),
      control: await page.evaluate(([at, shift]) => window.aboveParity(at, shift), [zoom, EDGE_CONTROL_SHIFT_PX / zoom]),
      zoomControl: await page.evaluate((at) => window.aboveParity(at, 0, 1), zoom),
      layerControl: await page.evaluate((at) => window.aboveParity(at, 0, at, 'below-nodes'), zoom),
    });
  }
  for (const dpr of ABOVE_DPRS) {
    parity.aboveZooms.push({
      zoom: 1,
      dpr,
      check: await page.evaluate((ratio) => window.aboveParity(1, 0, 1, 'above-nodes', ratio), dpr),
      control: await page.evaluate(
        ([ratio, shift]) => window.aboveParity(1, shift, 1, 'above-nodes', ratio),
        [dpr, EDGE_CONTROL_SHIFT_PX / dpr],
      ),
      zoomControl: await page.evaluate((ratio) => window.aboveParity(1, 0, 1, 'above-nodes', ratio, 1), dpr),
      layerControl: await page.evaluate((ratio) => window.aboveParity(1, 0, 1, 'below-nodes', ratio), dpr),
    });
  }
  // The page keeps only the latest draw's canvas read back, so every check
  // that reuses a set of screenshots runs before the next draw.
  const shots = await composedShots('groupFrame', 0);
  parity.groups = await composedParity('groupParity', shots, {});
  parity.placementControl = await composedParity('groupParity', shots, { expectedShift: GROUP_CONTROL_SHIFT_PX });
  parity.outlineControl = await composedParity(
    'groupParity',
    await composedShots('groupFrame', GROUP_CONTROL_SHIFT_PX),
    { paddingShift: GROUP_CONTROL_SHIFT_PX },
  );
  parity.groupZooms = [];
  for (const zoom of GROUP_ZOOMS) {
    const zoomShots = await composedShots('groupFrame', 0, zoom);
    const shift = GROUP_CONTROL_SHIFT_PX / zoom;
    parity.groupZooms.push({
      zoom,
      check: await composedParity('groupParity', zoomShots, { zoom }),
      placementControl: await composedParity('groupParity', zoomShots, { zoom, expectedShift: shift }),
      zoomControl: await composedParity('groupParity', zoomShots, { zoom, expectedZoom: 1 }),
      outlineControl: await composedParity('groupParity', await composedShots('groupFrame', shift, zoom), {
        zoom,
        paddingShift: shift,
      }),
    });
  }
  for (const dpr of GROUP_DPRS) {
    const dprShots = await composedShots('groupFrame', 0, 1, dpr);
    const shift = GROUP_CONTROL_SHIFT_PX;
    parity.groupZooms.push({
      zoom: 1,
      dpr,
      check: await composedParity('groupParity', dprShots, { dpr }),
      placementControl: await composedParity('groupParity', dprShots, { dpr, expectedShift: shift }),
      zoomControl: await composedParity('groupParity', dprShots, { dpr, expectedDpr: 1 }),
      outlineControl: await composedParity('groupParity', await composedShots('groupFrame', shift, 1, dpr), {
        dpr,
        paddingShift: shift,
      }),
    });
  }
  const richShots = await composedShots('richFrame', 0);
  parity.rich = await composedParity('richParity', richShots, {});
  parity.richPlacementControl = await composedParity('richParity', richShots, { expectedShift: RICH_CONTROL_SHIFT_PX });
  parity.tierControl = await composedParity('richParity', richShots, { swapTiers: true });
  parity.richBoundsControl = await composedParity(
    'richParity',
    await composedShots('richFrame', RICH_CONTROL_SHIFT_PX),
    { boundsShift: RICH_CONTROL_SHIFT_PX },
  );
  parity.richZooms = [];
  for (const zoom of RICH_ZOOMS) {
    const zoomShots = await composedShots('richFrame', 0, zoom);
    const boundsShift = RICH_CONTROL_SHIFT_PX / zoom;
    parity.richZooms.push({
      zoom,
      check: await composedParity('richParity', zoomShots, { zoom }),
      placementControl: await composedParity('richParity', zoomShots, { zoom, expectedShift: RICH_CONTROL_SHIFT_PX }),
      zoomControl: await composedParity('richParity', zoomShots, { zoom, expectedZoom: 1 }),
      boundsControl: await composedParity('richParity', await composedShots('richFrame', boundsShift, zoom), {
        zoom,
        boundsShift,
      }),
    });
  }
  for (const dpr of RICH_DPRS) {
    const dprShots = await composedShots('richFrame', 0, 1, dpr);
    const boundsShift = RICH_CONTROL_SHIFT_PX / dpr;
    parity.richZooms.push({
      zoom: 1,
      dpr,
      check: await composedParity('richParity', dprShots, { dpr }),
      placementControl: await composedParity('richParity', dprShots, { dpr, expectedShift: RICH_CONTROL_SHIFT_PX }),
      tierControl: await composedParity('richParity', dprShots, { dpr, swapTiers: true }),
      zoomControl: await composedParity('richParity', dprShots, { dpr, expectedDpr: 1 }),
      boundsControl: await composedParity('richParity', await composedShots('richFrame', boundsShift, 1, dpr), {
        dpr,
        boundsShift,
      }),
    });
  }
  if (!parity.check.pass) {
    console.error(`the parity check failed: ${parityFailure(parity.check)}`);
    process.exitCode = 1;
  }
  const control = controlFailure(parity.control, 'shape');
  if (control !== undefined) {
    console.error(
      `the parity control, with one shape shifted by ${Number(CONTROL_SHIFT_PX.toPrecision(3))} px, ${control}`,
    );
    process.exitCode = 1;
  }
  const edgeControl = controlFailure(parity.edgeControl, 'ribbon');
  if (edgeControl !== undefined) {
    console.error(`the edge control, with the ribbons shifted by ${EDGE_CONTROL_SHIFT_PX} px, ${edgeControl}`);
    process.exitCode = 1;
  }
  const dashControl = controlFailure(parity.dashControl, 'dash');
  if (dashControl !== undefined) {
    console.error(`the dash control, with the dashes flowed ${DASH_CONTROL_SHIFT_PX} px further, ${dashControl}`);
    process.exitCode = 1;
  }
  const curveControl = controlFailure(parity.curveControl, 'curve');
  if (curveControl !== undefined) {
    console.error(`the curve control, with the smooth ribbons drawn as polylines, ${curveControl}`);
    process.exitCode = 1;
  }
  const flowControl = controlFailure(parity.flowControl, 'dash flow');
  if (flowControl !== undefined) {
    console.error(`the flow control, with one side's flow held at its first frame's, ${flowControl}`);
    process.exitCode = 1;
  }
  const layerControl = controlFailure(parity.layerControl, 'layer');
  if (layerControl !== undefined) {
    console.error(`the layer control, with one side's above-nodes ribbon drawn below the nodes, ${layerControl}`);
    process.exitCode = 1;
  }
  for (const { zoom, dpr, check, ratioControl, ...controls } of parity.sceneDprs) {
    const at = `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the parity check at ${at} failed: ${parityFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [key, moved, what] of [
      ['control', 'shape', `one shape shifted by ${Number(CONTROL_SHIFT_PX.toPrecision(3))} device px`],
      ['edgeControl', 'ribbon', `the ribbons shifted by ${EDGE_CONTROL_SHIFT_PX} device px`],
      ['dashControl', 'dash', `the dashes flowed ${DASH_CONTROL_SHIFT_PX} px further`],
      ['curveControl', 'curve', 'the smooth ribbons drawn as polylines'],
      ['flowControl', 'dash flow', "one side's flow held at its first frame's"],
      ['layerControl', 'layer', "one side's above-nodes ribbon drawn below the nodes"],
    ]) {
      const failure = controlFailure(controls[key], moved);
      if (failure !== undefined) {
        console.error(`the ${key} at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
    const ratio = sceneRatioControlFailure(ratioControl);
    if (ratio !== undefined) {
      console.error(`the ratioControl at ${at}, with device pixel ratio 1's scene expected, ${ratio}`);
      process.exitCode = 1;
    }
  }
  for (const { zoom, dpr, check, control, zoomControl, ratioControl } of parity.shapeZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the shape check at ${at} failed: ${shapeFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [run, aimedAt, what] of [
      [control, 'interior', `one shape shifted by ${Number(CONTROL_SHIFT_PX.toPrecision(3))} px`],
      ...(dpr === undefined || zoom !== 1 ? [[zoomControl, 'fill', "zoom 1's shapes expected"]] : []),
      ...(dpr === undefined ? [] : [[ratioControl, 'fill', "device pixel ratio 1's shapes expected"]]),
    ]) {
      const failure = shapeControlFailure(run, aimedAt);
      if (failure !== undefined) {
        console.error(`the shape control at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  for (const { zoom, dpr, check, control, zoomControl } of parity.ribbonZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the ribbon check at ${at} failed: ${ribbonFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [run, aimedAt, what] of [
      [control, 'interior', `the ribbons shifted by ${EDGE_CONTROL_SHIFT_PX} px`],
      [zoomControl, 'edge colour', dpr === undefined ? "zoom 1's ribbons expected" : "device pixel ratio 1's ribbons expected"],
    ]) {
      const failure = ribbonControlFailure(run, aimedAt);
      if (failure !== undefined) {
        console.error(`the ribbon control at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  for (const { zoom, dpr, check, control, zoomControl, curveControl } of parity.smoothZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the smooth ribbon check at ${at} failed: ${ribbonFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [run, aimedAt, what] of [
      [control, 'interior', `the ribbon shifted by ${EDGE_CONTROL_SHIFT_PX} px`],
      [zoomControl, 'edge colour', dpr === undefined ? "zoom 1's ribbon expected" : "device pixel ratio 1's ribbon expected"],
      [curveControl, 'interior', "one side's ribbon drawn as a polyline"],
    ]) {
      const failure = ribbonControlFailure(run, aimedAt);
      if (failure !== undefined) {
        console.error(`the smooth ribbon control at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  for (const { zoom, dpr, check, control, zoomControl } of parity.dashZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the dash check at ${at} failed: ${dashFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [run, aimedAt, what] of [
      [control, 'interior', `the dashes flowed ${DASH_CONTROL_SHIFT_PX} px further`],
      [
        zoomControl,
        'dash colours',
        dpr === undefined ? 'a period in world units expected' : 'a period that doubles with the ratio expected',
      ],
    ]) {
      const failure = dashControlFailure(run, aimedAt);
      if (failure !== undefined) {
        console.error(`the dash control at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  for (const { zoom, dpr, check, control, zoomControl, curveControl } of parity.smoothDashZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the smooth dash check at ${at} failed: ${dashFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [run, aimedAt, what] of [
      [control, 'interior', `the dashes flowed ${DASH_CONTROL_SHIFT_PX} px further`],
      [
        zoomControl,
        'dash colours',
        dpr === undefined ? 'a period in world units expected' : 'a period that doubles with the ratio expected',
      ],
      [curveControl, 'interior', "one side's ribbon drawn as a polyline"],
    ]) {
      const failure = dashControlFailure(run, aimedAt);
      if (failure !== undefined) {
        console.error(`the smooth dash control at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  for (const { zoom, dpr, check, control, zoomControl, layerControl } of parity.aboveZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the above-nodes check at ${at} failed: ${aboveFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [run, aimedAt, what] of [
      [control, 'interior', `the ribbon shifted by ${EDGE_CONTROL_SHIFT_PX} px`],
      [
        zoomControl,
        'colours',
        dpr === undefined ? "zoom 1's circle and ribbon expected" : "device pixel ratio 1's circle and ribbon expected",
      ],
      [layerControl, 'interior', "one side's ribbon drawn below the nodes"],
    ]) {
      const failure = aboveControlFailure(run, aimedAt);
      if (failure !== undefined) {
        console.error(`the above-nodes control at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  if (!parity.groups.pass) {
    console.error(`the group outline check failed: ${groupFailure(parity.groups)}`);
    process.exitCode = 1;
  }
  const outlineControl = groupControlFailure(parity.outlineControl, 'added');
  if (outlineControl !== undefined) {
    console.error(`the outline control, with one side's padding ${GROUP_CONTROL_SHIFT_PX} px wider, ${outlineControl}`);
    process.exitCode = 1;
  }
  const placementControl = groupControlFailure(parity.placementControl, 'placed');
  if (placementControl !== undefined) {
    console.error(
      `the placement control, with the expected outline ${GROUP_CONTROL_SHIFT_PX} px wider on both sides, ${placementControl}`,
    );
    process.exitCode = 1;
  }
  for (const { zoom, dpr, check, ...controls } of parity.groupZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    const shiftPx = GROUP_CONTROL_SHIFT_PX * (dpr ?? 1);
    if (!check.pass) {
      console.error(`the group outline check at ${at} failed: ${groupFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [key, aimedAt, what] of [
      ['outlineControl', 'added', `one side's padding ${shiftPx} device px wider`],
      ['placementControl', 'placed', `the expected outline ${shiftPx} device px wider on both sides`],
      ['zoomControl', 'placed', dpr === undefined ? "zoom 1's outline expected" : "device pixel ratio 1's outline expected"],
    ]) {
      const failure = groupControlFailure(controls[key], aimedAt);
      if (failure !== undefined) {
        console.error(`the group ${key} at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
  if (!parity.rich.pass) {
    console.error(`the rich-node tier check failed: ${richFailure(parity.rich)}`);
    process.exitCode = 1;
  }
  for (const [key, aimedAt, what] of [
    ['richBoundsControl', 'added', `the rich bounds control, with one side's tier boxes moved ${RICH_CONTROL_SHIFT_PX} px`],
    ['richPlacementControl', 'placed', `the rich placement control, with the expected tier boxes ${RICH_CONTROL_SHIFT_PX} px wider on both sides`],
    ['tierControl', 'tiered', "the tier control, with each node expecting the other node's tier"],
  ]) {
    const failure = richControlFailure(parity[key], aimedAt);
    if (failure !== undefined) {
      console.error(`${what}, ${failure}`);
      process.exitCode = 1;
    }
  }
  for (const { zoom, dpr, check, ...controls } of parity.richZooms) {
    const at = dpr === undefined ? `zoom ${zoom}` : `zoom ${zoom} and device pixel ratio ${dpr}`;
    if (!check.pass) {
      console.error(`the rich-node tier check at ${at} failed: ${richFailure(check)}`);
      process.exitCode = 1;
    }
    for (const [key, aimedAt, what] of [
      ['boundsControl', 'added', `one side's tier boxes moved ${RICH_CONTROL_SHIFT_PX} device px`],
      ['placementControl', 'placed', `the expected tier boxes ${RICH_CONTROL_SHIFT_PX} device px wider on both sides`],
      ...(dpr === undefined
        ? [['zoomControl', 'tiered', "zoom 1's tiers expected"]]
        : [
            ['tierControl', 'tiered', "each node expecting the other node's tier"],
            ['zoomControl', 'placed', "device pixel ratio 1's boxes expected"],
          ]),
    ]) {
      const failure = richControlFailure(controls[key], aimedAt);
      if (failure !== undefined) {
        console.error(`the rich ${key} at ${at}, with ${what}, ${failure}`);
        process.exitCode = 1;
      }
    }
  }
}
let pick;
if (cliArgs.includes('--pick')) {
  if (advertised.adapter?.isFallbackAdapter === true) {
    console.error(
      `the adapter is a fallback adapter (${advertised.adapter.vendor} ${advertised.adapter.architecture}), not a GPU, so this pick run is not a WebGPU result`,
    );
    process.exitCode = 1;
  }
  pick = [];
  for (const backend of ['webgpu', 'webgl2']) {
    for (const ratio of [1, 2]) {
      for (const zoom of [1, 0.5, 1.2]) {
        const center = zoom === 1 ? { x: 0, y: 0 } : { x: 12, y: -8 };
        const run = await page.evaluate(
          ([value, dpr, scale, position]) => window.pickCheck(value, dpr, scale, position, true),
          [backend, ratio, zoom, center],
        );
        if (screenshotPath !== undefined && run.reported === backend) {
          await page.locator('#stage').screenshot({ path: `${screenshotPath}.pick-${backend}-dpr${ratio}-zoom${zoom}.png` });
        }
        if (run.reported === backend) await page.evaluate(() => window.disposePick());
        if (ratio === 1 && zoom !== 1) {
          const control = await page.evaluate(
            ([value, scale, position]) => window.pickCheck(value, 1, scale, position, false, true),
            [backend, zoom, center],
          );
          run.staleCameraControl = control;
          if (control.reported !== backend || !(control.mismatchCount > 0) || control.pass) {
            console.error(`the stale-camera pick control failed on ${backend} at zoom ${zoom}`);
            process.exitCode = 1;
          }
        }
        pick.push({ ...run, devicePixelRatio: ratio, zoom, center });
      }
    }
  }
  for (const run of pick.filter((each) => !each.pass)) {
    console.error(`the pick check failed on ${run.backend} at DPR ${run.devicePixelRatio}, zoom ${run.zoom}: ${pickFailure(run)}`);
    process.exitCode = 1;
  }
}
if (screenshotPath !== undefined) {
  // `keep` matters: a disposed renderer releases its context and the canvas
  // goes white, so a screenshot taken after the ordinary probe run is a picture
  // of nothing under a true-sounding caption. Drawn again and left alive.
  await page.evaluate((value) => window.probe(value, true), 'auto');
  await page.locator('#stage').screenshot({ path: screenshotPath });
}
const launch = {
  browserVersion: browser.version(),
  ...(CDP === undefined
    ? { executable: EXECUTABLE ?? 'playwright default', mode: headless ? 'headless' : 'headed', args: LAUNCH_ARGS }
    : { attached: CDP }),
  userAgent: await page.evaluate('navigator.userAgent'),
};
console.log(JSON.stringify({ launch, advertised, results, parity, pick, warnings }, null, 1));
await browser.close();
