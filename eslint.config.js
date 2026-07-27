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
    // The benchmark gate and its CLI are plain `.mjs` run by bare `node`, so
    // `no-undef` is live for them in a way it is not for the TypeScript
    // sources, where the compiler resolves globals through `types: ["node"]`.
    // The two they use, declared rather than pulling in a globals package for
    // them.
    files: ['bench/**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
);
