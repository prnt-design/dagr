/* global process, console, document, URL */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const html = execFileSync(process.execPath, ['server.mjs'], { encoding: 'utf8' });
assert.match(html, /data-node-id="a"/);
const dom = new JSDOM(`<div id="app">${html}</div>`, { url: 'https://consumer.invalid' });
Object.defineProperties(dom.window.HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => 390 },
  clientHeight: { configurable: true, get: () => 480 },
});
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
  x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 480, width: 390, height: 480,
});
for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'Element']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const observers = new Set();
globalThis.ResizeObserver = class {
  observe() { observers.add(this); }
  disconnect() { observers.delete(this); }
};
const frames = new Map();
let nextFrame = 0;
globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const React = await import('react');
const { hydrateRoot, createRoot } = await import('react-dom/client');
const { DagrExplorer } = await import('@prnt/dagr-explorer');
const { createPinchGesture } = await import('@prnt/dagr-render/core');
assert.equal(React.version.split('.')[0], process.argv[2]);
const fromRenderer = createRequire(import.meta.resolve('@prnt/dagr-render/core'));
assert.throws(() => fromRenderer.resolve('three'), { code: 'MODULE_NOT_FOUND' });
assert.match(readFileSync(new URL(import.meta.resolve('@prnt/dagr-explorer/styles.css')), 'utf8'), /data-dagr-explorer/);
const gesture = createPinchGesture();
gesture.down(1, { x: 0, y: 0 });
gesture.down(2, { x: 100, y: 0 });
assert.equal(gesture.move(2, { x: 200, y: 0 }).factor, 2);
gesture.reset();
assert.equal(gesture.move(2, { x: 300, y: 0 }), null);

const host = document.getElementById('app');
const viewport = host.querySelector('[data-dagr-explorer="viewport"]');
const apiRef = React.createRef();
const element = React.createElement(DagrExplorer, {
  label: 'Consumer map', apiRef,
  views: [{ id: 'v', label: 'View', nodes: [{ id: 'a', label: 'Alpha' }], edges: [] }],
});
const recovered = [];
const warnings = [];
const originalError = console.error;
console.error = (...args) => warnings.push(args);
let root;
try {
  await React.act(async () => { root = hydrateRoot(host, element, { onRecoverableError: (error) => recovered.push(error) }); });
  assert.equal(host.querySelector('[data-dagr-explorer="viewport"]'), viewport);
  assert.ok(apiRef.current);
  assert.ok(observers.size > 0);
  await React.act(async () => {
    for (let tick = 0; frames.size > 0 && tick < 120; tick++) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(tick * 16.7);
    }
  });
  assert.equal(host.querySelector('[data-dagr-explorer="plane"]').style.visibility, 'visible');
  await React.act(async () => apiRef.current.setQuery('Alpha'));
  assert.equal(host.querySelector('input').value, 'Alpha');
  await React.act(async () => root.unmount());
  assert.equal(apiRef.current, null);
  assert.equal(observers.size, 0);
  assert.equal(frames.size, 0);
  await React.act(async () => { root = createRoot(host); root.render(element); });
  assert.ok(apiRef.current);
  await React.act(async () => root.unmount());
  assert.equal(host.childElementCount, 0);
  assert.equal(apiRef.current, null);
  assert.equal(observers.size, 0);
  assert.equal(frames.size, 0);
  assert.deepEqual(recovered, []);
  assert.deepEqual(warnings, []);
} finally {
  console.error = originalError;
  dom.window.close();
}
