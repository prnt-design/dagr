import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve @dagr/graph to its source, matching the `paths` entry in
// tsconfig.json. The workspace dependency points at dist, which does not exist
// in a fresh clone or in CI, where test runs before build.
export default defineConfig({
  resolve: {
    alias: {
      '@dagr/graph': fileURLToPath(new URL('../graph/src/index.ts', import.meta.url)),
      '@dagr/bench': fileURLToPath(new URL('../../bench/src/index.ts', import.meta.url)),
    },
  },
});
