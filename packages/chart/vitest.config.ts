import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@prnt/dagr-render': fileURLToPath(new URL('../render/src/index.ts', import.meta.url)),
    },
  },
});
