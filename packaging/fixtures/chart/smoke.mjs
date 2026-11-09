import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DagrChart, layoutChart } from '@prnt/dagr-chart';

const data = {
  categories: ['A', 'B'],
  series: [{ id: 'orders', label: 'Orders', color: 0x6366f1, values: [3, 7] }],
};
const layout = layoutChart(data, { width: 640, height: 360 });
assert.equal(layout.bars.length, 2);
const html = renderToString(createElement(DagrChart, { ...data, label: 'Orders', rendering: 'svg', animate: false }));
assert.match(html, /<table/);
assert.match(html, /Orders/);
assert.match(html, /<svg/);
const css = readFileSync(fileURLToPath(import.meta.resolve('@prnt/dagr-chart/styles.css')), 'utf8');
assert.match(css, /dagr-chart__table/);
await assert.rejects(import('@prnt/dagr/chart'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
