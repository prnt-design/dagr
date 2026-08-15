/**
 * The demo's committed screenshots, taken reproducibly.
 *
 * Every frame in `assets/screenshots/` should be regenerable by someone who did
 * not take it, or it is a picture nobody can check. This script builds the
 * frames from the deployed page's own entry points: each one is a URL hash, so
 * a reader can open the same hash and see the same view rather than trying to
 * land on a zoom with a trackpad.
 *
 * **What these frames are NOT.** This box has no WebGPU at all: `navigator.gpu`
 * is absent, so three's automatic fallback draws them through WebGL2 on
 * swiftshader, in software. The overlay never touches a GPU, so the cards and
 * titles are exactly what a reader sees; the shapes are the fallback's
 * rasterisation of the same signed distance fields. The captions say so, and
 * anything comparing a future WebGPU capture against these should expect
 * rasterisation differences and not read them as regressions.
 *
 * **Fonts are the other trap, and this one bit already.** A headless browser on
 * a bare box has almost no fonts and silently resolves `ui-monospace`,
 * `monospace`, even `serif`, to a 6.000px advance at 12px, about a sixth
 * narrower than any monospace a reader has. Card sizes were budgeted against
 * that once and five kinds clipped in a real face. So this asserts the advance
 * it is capturing at, and names the font in the caption.
 *
 * ```
 * pnpm --filter demo build
 * python3 -m http.server 8734 --directory apps/demo/dist
 * npm --prefix apps/demo/scripts install --no-save playwright
 * npx --prefix apps/demo/scripts playwright install chromium
 * node apps/demo/scripts/capture.mjs http://localhost:8734
 * ```
 *
 * `playwright` rather than `playwright-core` because core downloads no browser,
 * and `CHROMIUM_PATH` overrides the executable for a machine that already has
 * one. An earlier version pinned this box's own chromium build number, which
 * made the four lines above false everywhere else.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';

const base = process.argv[2] ?? 'http://localhost:8734';
const outDir = new URL('../../../assets/screenshots/', import.meta.url).pathname;

/**
 * The frames, each named by what it shows and reproducible from its hash.
 *
 * `wait` is what has to be true before the shutter opens, expressed against the
 * page rather than as a sleep: a fixed delay is a race that passes on a fast
 * box and commits a half-drawn frame on a slow one.
 */
const FRAMES = [
  {
    name: 'p7-campaign-fit',
    hash: '',
    caption:
      'The whole campaign fitted on load: 3,010 nodes over 101 tiles, routed edges as dashed ribbons and cross-tile edges bowed between them. No HTML overlay at all at this zoom.',
    expect: { titles: 0, cards: 0 },
  },
  {
    name: 'p7-campaign-names',
    hash: '#zoom=1.4',
    caption:
      'Names, from about 24 CSS pixels of node width, over the room graph of a keyed site. No cards yet: nothing is 460 wide.',
    expect: { titles: 12, cards: 0 },
  },
  {
    name: 'p7-campaign-card-quest',
    hash: '#node=quest-1',
    caption:
      'A quest framed by its own deep link. #node= fits the node, so the card sits in a corner that is on screen.',
    expect: { titles: 0, cards: 1 },
  },
  {
    name: 'p7-campaign-card-npc',
    hash: '#node=npc-3',
    caption: 'An NPC with a secret: the kind-specific rows are what cardRows formats.',
    expect: { titles: 0, cards: 1 },
  },
  {
    name: 'p7-campaign-finale',
    hash: '#node=dungeon-21&zoom=2',
    caption:
      'The 88-room finale, the Osterdale Citadel, at a zoom the hash also names: #node= decides where, #zoom= how close. The titles here are SITES, the citadel and its neighbours; its rooms are still shapes at this zoom.',
    expect: { titles: 8, cards: 0 },
  },
];

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH === undefined
    ? {}
    : { executablePath: process.env.CHROMIUM_PATH }),
  // swiftshader, explicitly, because this is a software rasteriser by
  // necessity here and a frame that silently came from a real GPU on one
  // machine and swiftshader on another is not a comparable frame.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
/**
 * Device pixel ratio 1, for consistency with the frames already committed.
 *
 * An earlier version of this comment claimed dpr 2 drew nothing on this box and
 * recorded it as possibly a bug in the renderer's device-pixel path. That was
 * wrong, and it was wrong for the reason the shutter gate below exists: the
 * capture was racing the renderer, and a bigger drawing buffer takes swiftshader
 * longer, so dpr 2 lost the race more often. Behind the gate, dpr 1, 2 and 3 all
 * draw the fitted campaign. The lesson is cheaper to carry than the bug was: an
 * observation taken through a broken measurement is not an observation.
 */
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});
const page = await context.newPage();

/**
 * The font pin, applied to every navigation rather than once.
 *
 * `addInitScript` runs before the page's own scripts on each load, so the
 * override is in place before the first paint of every frame; a `page.goto`
 * would otherwise drop a style tag added after the previous one.
 */
await context.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    // TWO declarations, because the stage moved into `@dagr/campaign-stage` and
    // took its own token with it: `--mono` is the page's, `--dagr-stage-mono`
    // is the stage's and is declared on `.stage` rather than on `:root`, so
    // that the stage can be mounted in a docs site without reading a variable
    // the host happens to share a name with. Pinning only `:root` would leave
    // every card and readout in the 6.000px fallback while the assertion below
    // passed on the page's own text.
    style.textContent =
      ":root { --mono: 'Liberation Mono', monospace; }\n" +
      ".stage { --dagr-stage-mono: 'Liberation Mono', monospace; }";
    document.head.appendChild(style);
  });
});

await page.goto(base, { waitUntil: 'load' });

// The advance this capture ran at, asserted rather than assumed. See the header.
// Measured INSIDE the stage and through the stage's own variable, since that is
// the text the frames are about: the cards and the readout.
const advance = await page.evaluate(() => {
  const stage = document.querySelector('.stage') ?? document.body;
  const probe = document.createElement('span');
  probe.style.cssText = 'font: 12px var(--dagr-stage-mono); position: absolute; white-space: pre';
  probe.textContent = 'M'.repeat(100);
  stage.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return width;
});
if (advance < 7.0 || advance > 7.4) {
  throw new Error(
    `the capture box resolved --mono to a ${advance.toFixed(3)}px advance at 12px. ` +
      'Frames taken here would show text at a width no reader has. The pin ' +
      'above should have supplied Liberation Mono; check it is installed.',
  );
}

await mkdir(outDir, { recursive: true });
const captions = [];

for (const frame of FRAMES) {
  // Navigate, then RELOAD. A goto that changes only the fragment is a
  // same-document navigation: the browser moves the hash and the app never
  // re-runs, so the second frame would silently be the first one's camera with
  // a different URL in the address bar. The demo reads its hash once at mount,
  // deliberately (see `camera-input.ts`), which is exactly why the capture has
  // to give it a fresh mount per frame.
  await page.goto(`${base}/${frame.hash}`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  // The readout is the page saying what it has actually drawn, so it is what
  // the shutter waits on: "3,010 nodes" appears only once the worker has laid
  // every tile out and the scene has been handed to the renderer.
  // A frame the RENDERER drew, which is a different claim from a page that has
  // rendered, and the difference put a black canvas in a committed screenshot.
  //
  // Two earlier gates both passed over an empty canvas. Body text containing
  // "nodes," is in the copy BELOW the canvas whatever the canvas is doing. The
  // readout is worse than it looks: `publish` runs from the same `draw` as
  // `render`, and the first `draw` happens while `renderer` is still null, so a
  // readout full of live camera numbers can sit over a canvas nothing has drawn
  // to. The demo therefore sets `data-renderer-drawn` on the stage AFTER
  // `createRenderer` resolves and a frame has gone through it, and that is what
  // the shutter waits for.
  await page.waitForSelector('[data-renderer-drawn="true"]', { timeout: 60_000 });
  // Then wait for the tiers this frame is ABOUT, counted off the DOM rather
  // than parsed out of the readout. A frame captured before its cards attach is
  // a picture of the tier below it, and the whole point of these five is which
  // tier is showing, so the expectation is the wait rather than a comment.
  await page.waitForFunction(
    (want) =>
      document.querySelectorAll('.campaign-card').length >= want.cards &&
      document.querySelectorAll('.campaign-title').length >= want.titles,
    frame.expect,
    { timeout: 60_000 },
  );

  // One more frame after the gate, so the shutter is never inside the frame the
  // gate observed.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const shown = await page.evaluate(() => ({
    cards: document.querySelectorAll('.campaign-card').length,
    titles: document.querySelectorAll('.campaign-title').length,
  }));
  // And assert the frame is not showing a tier it should not. The wait above is
  // a floor; this is the ceiling, and without it the "no cards yet" frame would
  // pass while showing cards.
  if (frame.expect.cards === 0 && shown.cards > 0) {
    throw new Error(`${frame.name} was meant to show no cards and shows ${shown.cards}`);
  }
  if (frame.expect.titles === 0 && shown.titles > 0) {
    throw new Error(`${frame.name} was meant to show no titles and shows ${shown.titles}`);
  }

  const path = `${outDir}${frame.name}.png`;
  await page.screenshot({ path });

  // And check the canvas actually has something on it. The tier counts above
  // are about the overlay, which is DOM and draws whether or not a GPU frame
  // exists, so on the fitted campaign (no overlay at all, by design) they are
  // satisfied by a black canvas. A blank 1102x598 PNG compresses to a few
  // kilobytes; every frame that draws is hundreds. This is a floor on the
  // image, not a description of it, and it is here because the alternative was
  // shipping the blank one twice.
  const canvas = await page.$('canvas');
  const canvasShot = canvas === null ? null : await canvas.screenshot();
  if (canvasShot === null || canvasShot.length < 30_000) {
    throw new Error(
      `${frame.name} captured an essentially empty canvas (${String(canvasShot?.length ?? 0)} bytes). ` +
        'The renderer gate passed, so this is a real blank frame rather than a race.',
    );
  }
  captions.push(
    `${frame.name}.png  [${frame.hash || 'no hash'}]  ${shown.titles} titles, ${shown.cards} cards\n    ${frame.caption}`,
  );
  console.error(`captured ${frame.name} (${shown.titles} titles, ${shown.cards} cards)`);
}

await writeFile(
  `${outDir}p7-captions.txt`,
  [
    'P7 campaign screenshots.',
    '',
    'Captured on the swiftshader WebGL2 fallback: this box has no WebGPU at all, navigator.gpu is absent.',
    `Text is Liberation Mono, pinned for the capture at ${advance.toFixed(3)}px per character at 12px,`,
    'because the capture box has none of the faces the demo names (ui-monospace, SFMono-Regular,',
    "'SF Mono', Menlo, Consolas) and Liberation Mono is not one of them either: it is a stand-in,",
    'chosen because it sits at the 0.6em those faces cluster at. Unpinned, this box falls back to a',
    '6.000px advance, about a sixth narrower than a reader sees.',
    'Viewport 1440x900 at device pixel ratio 1.',
    'Shapes are that fallback rasterising the same distance fields; the overlay never touches a GPU.',
    '',
    ...captions,
    '',
    'Regenerate with apps/demo/scripts/capture.mjs; see its header.',
  ].join('\n'),
);

await browser.close();
console.error('done');
