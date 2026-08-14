/**
 * Opens `label-throughput.html` in a headless Chromium, runs a plan of
 * measurements in it, and prints the results as JSON.
 *
 * Usage and the numbers this produced are in `README.md` beside it. Not part of
 * `pnpm bench:ci`: a browser frame time has no automated way to be re-measured
 * against a committed baseline, which is the same reason M4.10's GPU numbers
 * stay local.
 *
 * The executable path is the dispatch box's Chromium. On a machine with its own
 * browser, point it at that instead; the numbers are not comparable across
 * machines anyway, and this one has no GPU at all, so it rasterises in
 * software.
 */
import { chromium } from 'playwright-core';
const exe = '/home/dispatch/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror:', String(e)));
await page.goto('http://127.0.0.1:8733/bench/browser/label-throughput.html', { waitUntil: 'load' });
const plan = JSON.parse(process.argv[2]);
const results = await page.evaluate((p) => window.runBench(p), plan);
console.log(JSON.stringify(results, null, 1));
await browser.close();
