import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// The stage's rules, then the page's. In that order, because the page adds the
// frame around the stage (its height, its border) and a host override has to
// come after what it overrides.
import '@dagr/campaign-stage/stage.css';
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
