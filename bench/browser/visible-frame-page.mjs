import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from '@prnt/dagr-graph';
import { DagrCanvas, useDagrCanvas } from '@prnt/dagr-react';
import { ExplorerRoot, ExplorerViewport, useExplorer } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';

const h = React.createElement;
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const pairs = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'e'], ['d', 'f'], ['e', 'f']];
const graph = new Graph();
for (const id of ids) graph.addNode(id);
for (const [a, b] of pairs) graph.addEdge(a, b);
const nodes = ids.map((id) => ({ id, label: `Concept ${id}` }));
const edges = pairs.map(([source, target]) => ({ id: `${source}${target}`, source, target }));

const probe = { error: undefined, events: [] };
window.__dagrFrame = probe;
const visual = window.visualViewport;
for (const type of ['resize', 'scroll']) visual?.addEventListener(type, () => probe.events.push(type));
probe.visual = () => ({
  width: visual.width, height: visual.height, offsetLeft: visual.offsetLeft, offsetTop: visual.offsetTop, scale: visual.scale,
  layout: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
  scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio,
  canvasBox: (({ top, bottom }) => ({ top, bottom }))(document.querySelector('#canvas').getBoundingClientRect()),
});

function CanvasProbe() {
  const handle = useDagrCanvas();
  useEffect(() => {
    probe.canvas = () => {
      const { camera } = handle.renderer;
      const canvas = document.querySelector('#canvas canvas');
      return {
        zoom: camera.zoom, center: { ...camera.center }, frame: { ...camera.frame },
        viewport: { ...camera.viewport }, buffer: { width: canvas?.width, height: canvas?.height },
        backend: handle.renderer.backend,
      };
    };
    return () => { delete probe.canvas; };
  }, [handle]);
  return null;
}

function ExplorerProbe() {
  const state = useExplorer();
  useEffect(() => {
    probe.explorer = () => ({ camera: state.camera.get(), selectedId: state.selectedId });
    probe.select = (id) => state.select(id);
    return () => { delete probe.explorer; delete probe.select; };
  }, [state]);
  return null;
}

createRoot(document.getElementById('root')).render(h(React.Fragment, null,
  h('h1', null, 'Dagr visible frame'),
  h('div', { id: 'lead', style: { height: 360 } }, 'Page content above the surfaces. Touch here pans the page.'),
  h('section', { id: 'canvas' }, h(DagrCanvas, {
    graph, navigation: true, label: 'Core canvas', clearColor: 0xfafafa, style: { height: 280 },
    onError: (error) => { probe.error = error.message; },
  }, h(CanvasProbe))),
  h('section', { id: 'explorer' }, h(ExplorerRoot, { nodes, edges, label: 'Core Explorer' },
    h(ExplorerViewport, { style: { height: 280 } }), h(ExplorerProbe))),
  h('div', { style: { height: 1200 } }, 'Page content below the surfaces.'),
));
