/**
 * What every campaign card actually renders at, in a real browser.
 *
 * `apps/demo/src/campaign-tiers.ts` declares a line budget per node kind, and
 * the card gate is derived from the heights those budgets give. A declared box
 * that is smaller than what the browser draws is a card hanging past its node's
 * bottom edge, over a neighbour the reader is also reading, so the budgets have
 * to be true rather than plausible.
 *
 * They cannot be computed. Word wrap breaks at word boundaries, not at a
 * character count, so arithmetic over string lengths picks the wrong worst case:
 * an earlier version of this check sampled the five longest-looking cards per
 * kind and passed, while `front` was overflowing by 18 pixels on a card the
 * sample never chose. So this renders EVERY card of three seeds, 8,946 of them,
 * and reports the tallest per kind. It takes about three seconds.
 *
 * The probe markup below is a HAND COPY of the card tier's DOM, so adding an
 * element in the tier's `create` without adding it here leaves the budgets
 * silently stale. If the card grows a part, grow the probe with it.
 *
 * Outside `bench:ci` for the same reason everything else here is: it answers a
 * question once, with numbers, and records how they were taken.
 *
 * ```
 * pnpm --filter @dagr/campaign build
 * npm --prefix bench/browser install --no-save playwright-core
 * node bench/browser/card-heights.mjs
 * ```
 */

import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
import { generateCampaign, cardRows } from '../../packages/campaign/dist/index.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const css = readFileSync(`${ROOT}/apps/demo/src/campaign-cards.css`, 'utf8');
const vars = readFileSync(`${ROOT}/apps/demo/src/styles.css`, 'utf8');

// The declared table, read out of the module rather than restated.
const src = readFileSync(`${ROOT}/apps/demo/src/campaign-tiers.ts`, 'utf8');
const LINES = Object.fromEntries([...src.matchAll(/^\s{2}(\w+): \{ lines: (\d+) \},$/gm)].map(m => [m[1], +m[2]]));
const CARD_WIDTH = +/const CARD_WIDTH = (\d+);/.exec(src)[1];
const LINE = +/const CARD_LINE_HEIGHT = (\d+);/.exec(src)[1];
const RULE = +/const CARD_RULE_HEIGHT = (\d+);/.exec(src)[1];
const PAD = +/const CARD_PADDING = (\d+);/.exec(src)[1];
const declared = k => LINES[k] * LINE + RULE + PAD;

// Worst-case node per kind across three seeds: the one whose text is longest.
// The five heaviest nodes per kind across three seeds, because "longest total
// text" is not always the node that renders tallest: a long value in a narrow
// value column beats a longer one-liner across the full width.
// EVERY node, across three seeds. Word wrap breaks at word boundaries, so a
// character-count heuristic picks the wrong worst case; the only way to know
// which card is tallest is to render them all.
const cards = [];
for (const seed of [20260814, 7, 999]) {
  for (const n of generateCampaign({ seed }).nodes) {
    cards.push({ kind: n.data.kind, name: n.name, oneLine: n.oneLine, rows: cardRows(n) });
  }
}
console.error(`measuring ${cards.length} cards`);

const html = `<!doctype html><html><head><style>
${vars.split('/*')[0]}
:root { --mono: 'Liberation Mono', monospace; --rule: #333; --ink: #eee; --ink-dim: #999; --amber: #ffb703; }
body { margin: 0; background: #07080a; }
.probe { position: relative; }
${css}
.campaign-card { position: relative; transform: none; }
</style></head><body>
${cards.map(c => `<div class="probe"><div class="campaign-card" data-kind="${c.kind}" style="width:${CARD_WIDTH}px">
<div class="campaign-card-head"><span class="campaign-card-name">${c.name}</span><span class="campaign-card-badge">${c.kind.replace('_',' ')}</span></div>
<div class="campaign-card-oneline">${c.oneLine}</div>
<dl class="campaign-card-rows">${c.rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
</div></div>`).join('')}
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.setContent(html);

/*
 * The advance this run measured against, asserted rather than assumed.
 *
 * A headless browser on a bare box has almost no fonts: `ui-monospace`,
 * `monospace` and even `serif` all resolve to a 6.000px advance at 12px here,
 * which is about 20% narrower than any monospace a reader actually has, so
 * budgets taken against it wrap later than reality and every long card clips.
 * The probe therefore names Liberation Mono, which is installed and sits at
 * 0.6em, the width the common monospace faces (SF Mono, Menlo, DejaVu Sans
 * Mono, Consolas) cluster at or under. Budgets taken here hold for a narrower
 * face and clip a line for a wider one.
 */
const advance = await page.evaluate(() => {
  const probe = document.createElement('span');
  probe.style.cssText = "font: 12px 'Liberation Mono', monospace; position: absolute; white-space: pre";
  probe.textContent = 'M'.repeat(100);
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return width;
});
if (advance < 7.0 || advance > 7.4) {
  throw new Error(
    `expected a 0.6em monospace advance, measured ${advance.toFixed(3)}px at 12px. ` +
      'The budgets in campaign-tiers.ts are calibrated against that width; a font ' +
      'this far off means the box has no real monospace installed and the numbers ' +
      'this run would print are not about any reader\'s browser.',
  );
}
console.error(`advance ${advance.toFixed(3)}px/char`);
// BORDER box, not `scrollHeight`, which is the padding box and drops the
// card's 1px top and bottom border. The declared numbers are border-box (the
// card is `box-sizing: border-box`), so measuring the padding box would be 2px
// lenient in exactly the direction that lets a card overflow its node.
const measured = await page.$$eval('.campaign-card', els =>
  els.map(el => ({ kind: el.dataset.kind, height: Math.ceil(el.getBoundingClientRect().height) })));
await browser.close();

const tallest = new Map();
for (const m of measured) tallest.set(m.kind, Math.max(tallest.get(m.kind) ?? 0, m.height));
let bad = 0;
console.log('kind'.padEnd(20), 'declared', 'tallest', 'linesNeeded', 'verdict');
for (const [kind, height] of tallest) {
  const d = declared(kind);
  const needed = Math.ceil((height - RULE - PAD) / LINE);
  const ok = height <= d;
  if (!ok) bad++;
  console.log(kind.padEnd(20), String(d).padStart(8), String(height).padStart(7), String(needed).padStart(11), ok ? 'fits' : `OVER by ${height - d}`);
}
console.log(bad === 0 ? '\nEvery kind fits its declared box.' : `\n${bad} kinds overflow.`);
