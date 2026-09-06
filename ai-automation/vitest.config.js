import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit and node tests only. The browser test is Playwright's job (npm run e2e).
    include: ['packages/**/*.test.{js,ts}', 'apps/**/*.test.{js,ts,tsx}'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/**/*.js', 'apps/api/**/*.js', 'apps/editor/src/convert.ts'],
      exclude: ['**/*.test.*'],
    },
  },
});
