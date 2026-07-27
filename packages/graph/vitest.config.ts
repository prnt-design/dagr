import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve @dagr/bench to its source, matching the `paths` entry in
// tsconfig.json. The bench kit is private and never built, so there is no dist
// to point at, and the same alias pattern already resolves @dagr/graph from
// source over in packages/layout.
export default defineConfig({
  resolve: {
    alias: {
      '@dagr/bench': fileURLToPath(new URL('../../bench/src/index.ts', import.meta.url)),
    },
  },
});
