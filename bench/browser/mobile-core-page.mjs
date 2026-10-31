import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from '@prnt/dagr-graph';
import { DagrCanvas, useDagrCanvas } from '@prnt/dagr-react';
import { ExplorerRoot, ExplorerViewport, useExplorer } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';

const h = React.createElement;
const graph = new Graph();
for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id);
for (const [a, b] of [['a', 'b'], ['b', 'c'], ['c', 'd']]) graph.addEdge(a, b);
const nodes = [...graph.nodes()].map((node) => ({ id: node.id, label: `Concept ${node.id}` }));
const edges = [
  { id: 'ab', source: 'a', target: 'b' },
  { id: 'bc', source: 'b', target: 'c' },
  { id: 'cd', source: 'c', target: 'd' },
];

window.__dagrMobile = {};
function CanvasProbe() {
  const handle = useDagrCanvas();
  useEffect(() => {
    window.__dagrMobile.canvas = () => ({
      scale: handle.renderer.camera.zoom,
      center: { ...handle.renderer.camera.center },
      backend: handle.renderer.backend,
    });
    return () => { delete window.__dagrMobile.canvas; };
  }, [handle]);
  return null;
}
function ExplorerProbe() {
  const state = useExplorer();
  useEffect(() => {
    window.__dagrMobile.explorer = () => ({
      scale: state.camera.get()?.scale,
      center: state.camera.get(),
      selectedId: state.selectedId,
    });
    return () => { delete window.__dagrMobile.explorer; };
  }, [state]);
  return null;
}

createRoot(document.getElementById('root')).render(h(React.Fragment, null,
  h('h1', null, 'Shared Dagr touch contract'),
  h('p', null, 'Correctness fixture, not a mobile performance measurement.'),
  h('h2', null, 'DagrCanvas'),
  h('section', { id: 'canvas' }, h(DagrCanvas, {
    graph, navigation: true, label: 'Core canvas', cameraLimits: false,
    clearColor: 0xfafafa, style: { height: 300 },
    onError: (error) => { window.__dagrMobile.error = error.message; },
  }, h(CanvasProbe))),
  h('h2', null, 'Explorer'),
  h('section', { id: 'explorer' }, h(ExplorerRoot, { nodes, edges, label: 'Core Explorer' },
    h(ExplorerViewport, { style: { height: 300 } }), h(ExplorerProbe))),
));
