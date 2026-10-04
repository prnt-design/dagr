import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * The same suite against React 18.
 *
 * The package claims `react >=18.2.0 <20.0.0`, so the gate runs both majors.
 * `react-18` and `react-dom-18` are npm aliases of the 18.3 installs, and
 * every specifier the sources and tests can name is pointed at them here.
 * The patterns are anchored, so `react-dom/client` never matches `react-dom`
 * first and lands on the wrong file.
 */
const react18 = (path: string): string =>
  fileURLToPath(new URL(`./node_modules/react-18/${path}`, import.meta.url));
const reactDom18 = (path: string): string =>
  fileURLToPath(new URL(`./node_modules/react-dom-18/${path}`, import.meta.url));

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        { find: /^react$/, replacement: react18('index.js') },
        { find: /^react\/jsx-runtime$/, replacement: react18('jsx-runtime.js') },
        { find: /^react\/jsx-dev-runtime$/, replacement: react18('jsx-dev-runtime.js') },
        { find: /^react-dom$/, replacement: reactDom18('index.js') },
        { find: /^react-dom\/client$/, replacement: reactDom18('client.js') },
        // The Node build, in every environment: the tests run in Node, and
        // `test/server.test.tsx` holds this to React 18.
        { find: /^react-dom\/server$/, replacement: reactDom18('server.node.js') },
        { find: /^react-dom\/test-utils$/, replacement: reactDom18('test-utils.js') },
      ],
    },
    test: {
      env: { DAGR_REACT_MAJOR: '18' },
      setupFiles: [fileURLToPath(new URL('./test/react18-setup.ts', import.meta.url))],
    },
  }),
);
