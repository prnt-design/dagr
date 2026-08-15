import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Resolve Dagr packages to their sources. The packages build to dist, but the
// demo should stay runnable in a fresh clone with nothing built yet.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@dagr/campaign': fileURLToPath(
        new URL('../../packages/campaign/src/index.ts', import.meta.url),
      ),
      '@dagr/graph': fileURLToPath(new URL('../../packages/graph/src/index.ts', import.meta.url)),
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
