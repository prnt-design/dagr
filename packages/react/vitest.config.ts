import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the Dagr packages to their sources, matching the `paths` entries in
// tsconfig.json. The workspace dependencies point at dist, which does not exist
// in a fresh clone or in CI, where test runs before build.
export default defineConfig({
  resolve: {
    alias: {
      '@dagr/graph': fileURLToPath(new URL('../graph/src/index.ts', import.meta.url)),
      '@dagr/layout': fileURLToPath(new URL('../layout/src/index.ts', import.meta.url)),
      '@dagr/render': fileURLToPath(new URL('../render/src/index.ts', import.meta.url)),
    },
  },
});
