/**
 * Makes `react-dom-18` load React 18, for the React 18 run only.
 *
 * A NON-TEST helper, named in `vitest.react18.config.ts` as a setup file.
 *
 * The config's aliases cover every import Vite transforms: the sources and
 * the tests. They cannot cover `react-dom`'s own `require('react')`, because
 * Vitest leaves `node_modules` to Node, and Node resolves that require from
 * where pnpm put the package. pnpm satisfies an aliased package's peer by
 * NAME from the importer's dependencies, and this package's `react` is 19,
 * so the React 18 `react-dom` is linked beside React 19 and fails at load
 * reading React 18 internals that 19 no longer has.
 *
 * The fix that keeps the lockfile honest would be a `peerDependencyRules` or
 * `packageExtensions` entry, which lives in the root `package.json`. This
 * hook does the same thing in the one process that needs it: a bare `react`
 * request from inside the React 18 `react-dom` is answered with the file
 * the React 18 package resolves it to.
 *
 * `module.registerHooks` is Node's synchronous hook, the only kind that also
 * sees `require`. It needs Node 22.15 or later, which CI runs.
 */

import { realpathSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Joined by hand rather than with `new URL(path, import.meta.url)`, which
// Vite rewrites into an asset URL in a browser-like environment.
const NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const installed = (name: string): string => realpathSync(join(NODE_MODULES, name));

const reactDom18 = pathToFileURL(installed('react-dom-18')).href + '/';
const fromReact18 = createRequire(join(installed('react-18'), 'package.json'));

if (typeof registerHooks !== 'function') {
  throw new Error('the React 18 run needs module.registerHooks, from Node 22.15');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromReactDom18 = context.parentURL?.startsWith(reactDom18) === true;
    if (fromReactDom18 && (specifier === 'react' || specifier.startsWith('react/'))) {
      return { url: pathToFileURL(fromReact18.resolve(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
