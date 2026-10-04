import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the Dagr packages to their sources, matching the `paths` entries in
// tsconfig.json. The workspace dependencies point at dist, which does not exist
// in a fresh clone or in CI, where test runs before build.
export default defineConfig({
  resolve: {
    alias: {
      '@prnt/dagr-graph': fileURLToPath(new URL('../graph/src/index.ts', import.meta.url)),
      '@prnt/dagr-layout': fileURLToPath(new URL('../layout/src/index.ts', import.meta.url)),
      '@prnt/dagr-render/core': fileURLToPath(new URL('../render/src/core.ts', import.meta.url)),
    },
  },
  test: {
    // The React major this config runs against. `test/react-version.test.tsx`
    // holds the runtime to it, so an alias that silently misses cannot make
    // the React 18 run a second React 19 run.
    env: { DAGR_REACT_MAJOR: '19' },
  },
});
