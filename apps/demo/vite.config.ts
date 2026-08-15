import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Resolve Dagr packages to their sources. The packages build to dist, but the
// demo should stay runnable in a fresh clone with nothing built yet.
//
// The map is LONGER than this app's dependency list, on purpose. The demo
// imports `@dagr/campaign-stage`, and the stage's own source imports
// `@dagr/graph`, `@dagr/layout` and `@dagr/render`; an alias is a path mapping
// rather than a dependency, so those three entries are what keep the whole
// tree on source. Drop one and that package alone falls back to its `dist`,
// which a fresh clone does not have.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // FIRST, and it has to be. An alias key matches the specifier itself or
      // anything under it as a path, so the bare entry below would rewrite
      // `@dagr/campaign-stage/stage.css` into `.../src/index.ts/stage.css` and
      // fail with "not a directory". Entries are tried in order, so the
      // subpath is claimed before the package name is.
      '@dagr/campaign-stage/stage.css': fileURLToPath(
        new URL('../../packages/campaign-stage/src/stage.css', import.meta.url),
      ),
      '@dagr/campaign-stage': fileURLToPath(
        new URL('../../packages/campaign-stage/src/index.ts', import.meta.url),
      ),
      '@dagr/campaign': fileURLToPath(
        new URL('../../packages/campaign/src/index.ts', import.meta.url),
      ),
      '@dagr/graph': fileURLToPath(new URL('../../packages/graph/src/index.ts', import.meta.url)),
      '@dagr/layout': fileURLToPath(new URL('../../packages/layout/src/index.ts', import.meta.url)),
      // This alias is also why the demo does not depend on `three`, and why it
      // would prove nothing if it did. `@dagr/render` resolves to a file inside
      // `packages/render/`, so `three/webgpu` resolves from THERE, finds
      // render's own devDependency copy, and never looks in this app's
      // `node_modules` at all. The peer-dependency arrangement is therefore NOT
      // exercised here: a consumer smoke test that installs the built package,
      // or M4.9, is what would exercise it.
      '@dagr/render': fileURLToPath(new URL('../../packages/render/src/index.ts', import.meta.url)),
    },
  },
  // `vite build` warns that the one chunk is over 500 kB. That is three.js, it
  // is expected, and it stays unsplit: this is a private demo nobody installs,
  // so a second network round trip would buy it nothing. `chunkSizeWarningLimit`
  // is deliberately NOT raised either, because a limit set above the known cost
  // would also hide the next increase, which might not be a known one.
});
