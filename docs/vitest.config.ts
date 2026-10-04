import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string =>
  fileURLToPath(new URL(`../packages/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // An array, not an object, because the first match wins and
    // `@prnt/dagr-render/core` must be tried before `@prnt/dagr-render`,
    // whose alias would otherwise claim it as a subpath. The explorer
    // imports only the `core` entry.
    alias: [
      { find: '@prnt/dagr-render/core', replacement: source('render/src/core.ts') },
      { find: '@prnt/dagr-explorer', replacement: source('explorer/src/index.ts') },
      ...['graph', 'layout', 'vdsl', 'render'].map((name) => ({
        find: `@prnt/dagr-${name}`,
        replacement: source(`${name}/src/index.ts`),
      })),
    ],
  },
  test: { include: ['src/**/*.test.ts'] },
});
