import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// The stages' rules, then the page's. In that order, because the page adds the
// frame around whichever stage is mounted (its height, its border) and a host
// override has to come after what it overrides. All of them are imported
// unconditionally even though only one stage is on screen at a time: a
// stylesheet is a static import either way, and together they are a few
// hundred bytes against a bundle that carries three.js.
import '@dagr/campaign-stage/stage.css';
import '@dagr/living-stage/living.css';
import '@prnt/dagr-chart/styles.css';
import './chart/chart.css';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Demo mount point #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
