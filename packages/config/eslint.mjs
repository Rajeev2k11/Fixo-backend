// Shared flat ESLint config. Each package spreads this and sets tsconfigRootDir.
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

import { moduleBoundaries } from './eslint-rules/module-boundaries.mjs';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/*.mjs'] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // NestJS modules are decorated empty classes by design.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // CLAUDE.md rule 1, enforced (tested in eslint-rules/module-boundaries.test.mjs).
    files: ['**/src/modules/**/*.ts'],
    plugins: { fixo: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'fixo/module-boundaries': 'error' },
  },
  prettier,
);
