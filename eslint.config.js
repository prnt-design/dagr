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
);
