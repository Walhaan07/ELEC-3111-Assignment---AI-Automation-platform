import js from '@eslint/js';
import globals from 'globals';

/**
 * Deliberately small. The rules here are the ones that catch real mistakes in
 * this codebase; style is Prettier's business, not a reviewer's.
 */
export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', 'coverage/**',
      'playwright-report/**', 'test-results/**', 'benchmarks/results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
    },
  },
  {
    // k6 scripts run inside k6, which provides its own globals
    files: ['benchmarks/k6/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
];
