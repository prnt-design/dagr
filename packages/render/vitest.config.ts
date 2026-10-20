import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The bench kit is private and never built, so it resolves from source,
// matching the `paths` entry in tsconfig.json.
export default defineConfig({
  resolve: {
    alias: {
      '@dagr/bench': fileURLToPath(new URL('../../bench/src/index.ts', import.meta.url)),
    },
  },
});
