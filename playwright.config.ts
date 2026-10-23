/**
 * @file Playwright configuration for end-to-end tests in `e2e/`.
 *
 * Starts the app automatically: the dev server locally (reusing one that is
 * already running), or the production build in CI.
 * @see https://playwright.dev/docs/test-configuration
 */
import { defineConfig, devices } from '@playwright/test';

/** Whether the tests run in CI (GitHub Actions sets `CI=true`). */
const isCI = Boolean(process.env.CI);

/** Address the app is served on. */
const baseURL = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  /** Fail the CI run if a `test.only` was left in the code. */
  forbidOnly: isCI,
  /** Retry flaky tests in CI only. */
  retries: isCI ? 2 : 0,
  /** One worker in CI for stable results; as many as possible locally. */
  workers: isCI ? 1 : undefined,
  /** Annotate GitHub pull requests in CI; HTML report locally. */
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL,
    /** Record a trace when a test is retried, for debugging. */
    trace: 'on-first-retry',
  },
  /** Browsers to test in. Add Firefox and WebKit here when needed. */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: isCI ? 'pnpm start' : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !isCI,
  },
});
