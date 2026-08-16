/**
 * What every campaign card actually renders at, in a real browser.
 *
 * `packages/campaign-stage/src/campaign-tiers.ts` declares a line budget per node
 * kind, and
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
const css = readFileSync(`${ROOT}/packages/campaign-stage/src/campaign-cards.css`, 'utf8');

// The declared table, read out of the module rather than restated.
const src = readFileSync(`${ROOT}/packages/campaign-stage/src/campaign-tiers.ts`, 'utf8');
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

// The card's tokens, declared here rather than lifted off a stylesheet. They
// are the stage's own now (`--dagr-stage-*`, declared on `.stage` in
// `stage.css` so the component can be mounted in a docs site), and the probe
// cards below are not inside a `.stage`, so `:root` is what they inherit from.
// The font is pinned rather than borrowed: see the advance assertion below.
// A previous version also read `apps/demo/src/styles.css` and inlined it, which
// contributed nothing: that file opens with a comment, so the split it used
// returned an empty string, and these declarations were always the whole of it.
// The two marks the card tier builds, as the probe's hand copy of them. The
// PATH does not matter to a height: every kind's mark is the same 12px box on
// the badge and the same out-of-flow 44px block behind the text, so what these
// have to reproduce is the SPACE, and one path stands in for all twenty. The
// badge one is the half that moves a number: it takes 16px out of the head, so
// a long name has that much less room before it wraps.
const BADGE_ICON =
  '<svg class="campaign-card-badge-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 3h11v10h-11z"/></svg>';
const MARK =
  '<svg class="campaign-card-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 3h11v10h-11z"/></svg>';

const html = `<!doctype html><html><head><style>
:root {
  --dagr-stage-mono: 'Liberation Mono', monospace;
  --dagr-stage-rule: #333;
  --dagr-stage-ink: #eee;
  --dagr-stage-ink-dim: #999;
  --dagr-stage-amber: #ffb703;
}
body { margin: 0; background: #07080a; }
.probe { position: relative; }
${css}
/* The card positions itself for real here, since the watermark inside it is
   absolutely positioned and would otherwise escape to the nearest positioned
   ancestor and take a scrollbar with it. The transform is dropped because the
   counter-scale has no zoom to read outside the stage.
   NOTE: no backticks in this block. It is inside a JS template literal. */
.campaign-card { position: relative; transform: none; }
</style></head><body>
${cards.map(c => `<div class="probe"><div class="campaign-card" data-kind="${c.kind}" style="width:${CARD_WIDTH}px">
${MARK}
<div class="campaign-card-head"><span class="campaign-card-name">${c.name}</span><span class="campaign-card-badge">${BADGE_ICON}<span class="campaign-card-badge-text">${c.kind.replace('_',' ')}</span></span></div>
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
 * which is about a sixth narrower than any monospace a reader actually has, so
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
