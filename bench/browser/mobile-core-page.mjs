import React, { useEffect, useState } from 'react';
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
function CanvasProbe({ name }) {
  const handle = useDagrCanvas();
  useEffect(() => {
    window.__dagrMobile[name] = () => ({
      scale: handle.renderer.camera.zoom,
      center: { ...handle.renderer.camera.center },
      backend: handle.renderer.backend,
    });
    window.__dagrMobile[`${name}Focus`] = (id) => handle.focusNode(id);
    return () => { delete window.__dagrMobile[name]; delete window.__dagrMobile[`${name}Focus`]; };
  }, [handle, name]);
  return null;
}
const onError = (error) => { window.__dagrMobile.error = error.message; };
function ExplorerProbe({ name }) {
  const state = useExplorer();
  useEffect(() => {
    window.__dagrMobile[name] = () => ({
      scale: state.camera.get()?.scale,
      center: state.camera.get(),
      selectedId: state.selectedId,
      detailsOpen: state.detailsOpen,
    });
    window.__dagrMobile[`${name}Focus`] = (id) => {
      state.focusNode(id);
      return nodes.some((node) => node.id === id);
    };
    return () => { delete window.__dagrMobile[name]; delete window.__dagrMobile[`${name}Focus`]; };
  }, [state, name]);
  return null;
}
// Records each selection the explorer asks for and applies none: the check
// decides when the owner's prop changes, as a host syncing to a URL would.
const requests = [];
window.__dagrMobile.controlledRequests = () => [...requests];
function ControlledExplorer() {
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    window.__dagrMobile.controlledSelect = setSelectedId;
    return () => { delete window.__dagrMobile.controlledSelect; };
  }, []);
  return h(ExplorerRoot, { nodes, edges, label: 'Controlled Explorer', selectedId, onSelectedChange: (id) => requests.push(id) },
    h(ExplorerViewport, { style: { height: 300 } }), h(ExplorerProbe, { name: 'controlled' }));
}

createRoot(document.getElementById('root')).render(h(React.Fragment, null,
  h('h1', null, 'Shared Dagr touch contract'),
  h('p', null, 'Correctness fixture, not a mobile performance measurement.'),
  h('h2', null, 'DagrCanvas'),
  h('section', { id: 'canvas' }, h(DagrCanvas, {
    graph, navigation: true, label: 'Core canvas', cameraLimits: false,
    clearColor: 0xfafafa, style: { height: 300 }, onError,
  }, h(CanvasProbe, { name: 'canvas' }))),
  h('h2', null, 'DagrCanvas, two-finger'),
  h('section', { id: 'canvas-two-finger' }, h(DagrCanvas, {
    graph, navigation: true, touchNavigation: 'two-finger', label: 'Two-finger canvas',
    cameraLimits: false, clearColor: 0xfafafa, style: { height: 300 }, onError,
  }, h(CanvasProbe, { name: 'canvasTwoFinger' }))),
  h('h2', null, 'Explorer'),
  h('section', { id: 'explorer' }, h(ExplorerRoot, { nodes, edges, label: 'Core Explorer' },
    h(ExplorerViewport, { style: { height: 300 } }), h(ExplorerProbe, { name: 'explorer' }))),
  h('h2', null, 'Explorer, controlled selection'),
  h('section', { id: 'explorer-controlled' }, h(ControlledExplorer)),
  h('div', { style: { height: 1500 } }),
));
