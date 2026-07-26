import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Resolve Dagr packages to their sources. The packages build to dist, but the
// demo should stay runnable in a fresh clone with nothing built yet.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@dagr/graph': fileURLToPath(new URL('../../packages/graph/src/index.ts', import.meta.url)),
    },
  },
});
