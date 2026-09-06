import { defineConfig } from '@playwright/test';

/**
 * Level 3 - one browser test, and only one.
 *
 * Playwright starts the whole stack itself, so "did you remember to start the
 * server?" stops being a question anybody has to ask.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },        // retry an assertion for 10 s before failing it
  retries: process.env.CI ? 2 : 0,    // a flaky test in CI is retried, but still reported
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',        // a recording of every click, when it fails
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Sandboxes and CI images sometimes ship their own Chromium. Point
    // PW_CHROMIUM_PATH at it rather than downloading a second copy.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  // Both halves, waited for separately. Waiting only on the editor is a trap:
  // Vite is ready in about 300 ms and the API takes a second or two, so the
  // first test fires at an API that is not listening yet.
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://localhost:5678/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:editor',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
  ],
});
