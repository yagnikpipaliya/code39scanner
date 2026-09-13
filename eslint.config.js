import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-demo', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // `noUncheckedIndexedAccess` is on; indexed reads in bounds-checked numeric loops use `!`.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
