// Flat config for ESLint 9. Deliberately not type-checked linting: the
// type-aware rules are slow, and `pnpm typecheck` already runs tsc in strict
// mode across every workspace package.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.docusaurus/**',
      'docs/build/**',
      'docs/.docusaurus/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The benchmark gate, its CLI, the packaging verifier and the docs'
    // generator scripts are plain `.mjs` run by bare `node`, so `no-undef` is
    // live for them in a way it is not for the TypeScript sources, where the
    // compiler resolves globals through `types: ["node"]`. The globals they
    // use, declared rather than pulling in a globals package for them.
    files: [
      'bench/**/*.mjs',
      'packaging/bin/**/*.mjs',
      'docs/scripts/**/*.mjs',
      'apps/demo/scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: { URL: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
  {
    // `bench/browser` and the demo's capture script drive a real browser, so
    // parts of these files run in the PAGE rather than in node: the callback
    // handed to `page.evaluate` is serialised and evaluated there. Declared as
    // its own block rather than widening the node one above, which would stop
    // `no-undef` catching a browser global used by mistake in a node script.
    files: ['bench/browser/**/*.mjs', 'apps/demo/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
);
