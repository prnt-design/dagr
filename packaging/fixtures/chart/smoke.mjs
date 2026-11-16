import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DagrChart, layoutChart } from '@prnt/dagr-chart';

const data = {
  categories: ['A', 'B'],
  series: [
    { id: 'orders', label: 'Orders', color: 0x6366f1, values: [-3, 7] },
    { id: 'total', label: 'Running total', color: 0xff6600, values: [30, 70], mark: 'line', axis: 'right' },
  ],
};
const layout = layoutChart(data, { width: 640, height: 360 });
assert.equal(layout.bars.length, 2);
assert.equal(layout.lines.length, 1);
assert.equal(layout.lines[0].points.length, 2);
assert.ok(layout.rightTicks.length > 0);
assert.equal(layoutChart({ categories: [], series: [] }, { width: 640, height: 360 }).bars.length, 0);
assert.throws(() => layoutChart({ ...data, series: [data.series[0], data.series[0]] }, { width: 640, height: 360 }), RangeError);
const html = renderToString(createElement(DagrChart, { ...data, label: 'Orders', rendering: 'svg', animate: false }));
assert.match(html, /<table/);
assert.match(html, /Orders/);
assert.match(html, /<svg/);
assert.match(html, /Running total/);
assert.match(html, />-3</);
assert.match(html, />70</);
const css = readFileSync(fileURLToPath(import.meta.resolve('@prnt/dagr-chart/styles.css')), 'utf8');
assert.match(css, /dagr-chart__table/);
await assert.rejects(import('@prnt/dagr/chart'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
