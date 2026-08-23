/**
 * Which backend `@dagr/render` comes up on in a real browser, and whether the
 * TSL shape graphs draw once it is there.
 *
 * **This is M4.9a's device half, and it is the first thing in this repository
 * that checks a `@dagr/render` pixel rather than the arithmetic behind one.**
 * `packages/render/src/webgpu-renderer.ts` carries a list of things it calls
 * UNVERIFIED, headed by "that any shape appears at all" and "that the shader
 * computes anything", because a TSL graph built in Node never reaches a
 * backend and never generates code. Opening the same package in a browser is
 * what closes that, and the box this runs on has WebGL2 through swiftshader and
 * no WebGPU adapter, so it closes it for one backend of two. What it therefore
 * CANNOT do is the parity comparison M4.9b owns, which needs both backends on
 * one machine.
 *
 * Outside `pnpm bench:ci` for the reason everything in this directory is: it
 * answers a question once, with numbers, and records how they were taken. It is
 * committed rather than kept in a scratch directory so that `pnpm lint` sees
 * it, which is the rule `card-heights.mjs` learned the hard way.
 *
 * ```
 * pnpm --filter @dagr/render build      # the page imports from dist
 * npm --prefix bench/browser install --no-save playwright-core
 * python3 -m http.server 8733           # from the REPO ROOT
 * node bench/browser/backend-probe.mjs
 * ```
 *
 * Pass a path as the first argument to write the drawn frame there as a PNG.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = new URL('../..', import.meta.url).pathname;
const ORIGIN = 'http://127.0.0.1:8733';

// The Chromium the rest of this directory uses, and the same swiftshader flags.
// This box has no GPU at all, so WebGL2 is software rasterised; that makes the
// timings meaningless and the PICTURE exactly as correct as a real one, which
// is the half this file is about.
const EXECUTABLE = '/home/dispatch/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * The page's import map, filled in from this process's own module resolution.
 *
 * The two specifiers `@dagr/render`'s dist actually imports are `three/webgpu`
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

const screenshotPath = process.argv[2];
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: LAUNCH_ARGS });
const page = await browser.newPage({
  viewport: { width: 640, height: 420 },
  deviceScaleFactor: 1,
});

const warnings = [];
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
});
page.on('pageerror', (error) => warnings.push(`pageerror: ${String(error)}`));

// `setContent` rather than a static file, because the import map has to be
// filled in first. The base URL still has to be the server's, or the page's own
// absolute import of `/packages/render/dist/index.js` has nothing to resolve
// against, so the route is intercepted rather than the file rewritten on disk.
await page.route(`${ORIGIN}/bench/browser/backend-probe.html`, (route) =>
  route.fulfill({ contentType: 'text/html', body: pageHtml() }),
);
await page.goto(`${ORIGIN}/bench/browser/backend-probe.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });

const advertised = await page.evaluate(() => window.webgpuAdvertised());
const results = [];
for (const preference of ['auto', 'webgpu', 'webgl2']) {
  results.push(await page.evaluate((value) => window.probe(value), preference));
}
if (screenshotPath !== undefined) {
  // `keep` matters: a disposed renderer releases its context and the canvas
  // goes white, so a screenshot taken after the ordinary probe run is a picture
  // of nothing under a true-sounding caption. Drawn again and left alive.
  await page.evaluate((value) => window.probe(value, true), 'auto');
  await page.locator('#stage').screenshot({ path: screenshotPath });
}
console.log(JSON.stringify({ advertised, results, warnings }, null, 1));
await browser.close();
