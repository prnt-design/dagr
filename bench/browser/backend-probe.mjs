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
 * node bench/browser/backend-probe.mjs  # [screenshot.png] [--headed] [--parity]
 * ```
 *
 * Pass a path to write the drawn frame there as a PNG. The browser is
 * Playwright's own Chromium unless `DAGR_CHROMIUM` names another executable,
 * and `DAGR_CHROMIUM_ARGS` adds space-separated launch flags. The output
 * records the browser, mode and flags, because a backend result without them
 * cannot be reproduced. `--parity` adds M4.9b's backend comparison and exits
 * non-zero unless it passes and its control fails, or when the adapter reports
 * `isFallbackAdapter`: a software adapter such as SwiftShader still comes up on
 * `webgpu`, so its side of the comparison would not be a GPU's.
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

const cliArgs = process.argv.slice(2);
const headless = !cliArgs.includes('--headed');
const screenshotPath = cliArgs.find((arg) => !arg.startsWith('--'));
const browser = await chromium.launch({
  headless,
  args: LAUNCH_ARGS,
  ...(EXECUTABLE === undefined ? {} : { executablePath: EXECUTABLE }),
});
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
let parity;
if (cliArgs.includes('--parity')) {
  parity = {
    check: await page.evaluate(() => window.parity()),
    control: await page.evaluate(() => window.parity(1 / 3)),
  };
  if (!parity.check.pass || parity.control.pass) process.exitCode = 1;
  if (advertised.adapter?.isFallbackAdapter === true) {
    console.error(
      `the adapter is a fallback adapter (${advertised.adapter.vendor} ${advertised.adapter.architecture}), not a GPU, so this parity run is not a WebGPU result`,
    );
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
  executable: EXECUTABLE ?? 'playwright default',
  mode: headless ? 'headless' : 'headed',
  args: LAUNCH_ARGS,
  userAgent: await page.evaluate('navigator.userAgent'),
};
console.log(JSON.stringify({ launch, advertised, results, parity, warnings }, null, 1));
await browser.close();
