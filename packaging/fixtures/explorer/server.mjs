/* global document, console */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DagrExplorer } from '@prnt/dagr-explorer';

if (typeof document !== 'undefined') throw new Error('SSR requires a DOM-free process');
console.log(renderToString(createElement(DagrExplorer, {
  label: 'Consumer map',
  views: [{ id: 'v', label: 'View', nodes: [{ id: 'a', label: 'Alpha' }], edges: [] }],
})));
