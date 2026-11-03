import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from '@prnt/dagr-graph';
import { DagrCanvas, useDagrCanvas } from '@prnt/dagr-react';

const h = React.createElement;
const params = new URLSearchParams(window.location.search);
const count = Number(params.get('nodes') ?? 1000);
const maxPixelRatio = params.has('max') ? Number(params.get('max')) : undefined;
// A ternary tree, so layout stays quick at a few thousand nodes.
const graph = new Graph();
for (let i = 0; i < count; i += 1) graph.addNode(`n${i}`);
for (let i = 1; i < count; i += 1) graph.addEdge(`n${Math.floor((i - 1) / 3)}`, `n${i}`);

const draws = [];
const frames = [];
let recording = false;
let drawn = 0;
const tick = (now) => {
  frames.push(now);
  if (recording) requestAnimationFrame(tick);
};
window.__dagrBudget = {
  // Every draw and every animation frame between record(true) and record(false).
  record(on) {
    recording = on;
    if (!on) return { draws: [...draws], frames: [...frames] };
    draws.length = 0;
    frames.length = 0;
    requestAnimationFrame(tick);
    return null;
  },
  // rAF timestamps over `total` frames, for the pacing with nothing to draw.
  frames: (total) => new Promise((resolve) => {
    const stamps = [];
    const step = (now) => {
      stamps.push(now);
      if (stamps.length > total) resolve(stamps);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }),
};
function Probe() {
  const handle = useDagrCanvas();
  useEffect(() => {
    const { renderer } = handle;
    const render = renderer.render;
    renderer.render = function timed() {
      const start = performance.now();
      render.call(renderer);
      drawn += 1;
      if (recording) draws.push({ at: start, ms: performance.now() - start });
    };
    window.__dagrBudget.state = () => {
      const canvas = document.querySelector('#canvas canvas');
      return {
        drawn,
        backend: renderer.backend,
        scale: renderer.camera.zoom,
        viewport: { ...renderer.camera.viewport },
        buffer: { width: canvas.width, height: canvas.height },
      };
    };
    return () => {
      renderer.render = render;
      delete window.__dagrBudget.state;
    };
  }, [handle]);
  return null;
}

createRoot(document.getElementById('root')).render(h('section', { id: 'canvas' }, h(DagrCanvas, {
  graph, navigation: true, label: 'Budget canvas', cameraLimits: false, clearColor: 0xfafafa, maxPixelRatio,
  style: { width: '100vw', height: '100vh' }, onError: (error) => { window.__dagrBudget.error = error.message; },
}, h(Probe))));
