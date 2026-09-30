import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['graph', 'layout', 'vdsl'].map((name) => [
        `@prnt/dagr-${name}`,
        fileURLToPath(
          new URL(`../packages/${name}/src/index.ts`, import.meta.url),
        ),
      ]),
    ),
  },
  test: { include: ['src/**/*.test.ts'] },
});
