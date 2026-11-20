/**
 * @file Playwright configuration for end-to-end tests in `e2e/`.
 *
 * The tests run against their own server on port 3100 (or the port
 * `E2E_PORT` names, see `e2e/support/fixtures.ts`), using the test
 * database (prepared and seeded by `e2e/support/global-setup.ts`) and writing emails
 * to `e2e/.outbox` instead of sending them. Locally the app is built first,
 * unless nothing the build reads changed since the last one
 * (`tests/build/build-state.ts`; `E2E_REBUILD=1` builds anyway); in CI the
 * build from the earlier step is reused. Your `pnpm dev` server and
 * development database are never touched.
 * @see https://playwright.dev/docs/test-configuration
 */
import { defineConfig, devices } from '@playwright/test';

import {
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_CRON_SECRET,
  E2E_PORT,
  OUTBOX_DIR,
} from './e2e/support/fixtures';
import { buildIsCurrent } from './tests/build/build-state';
import getTestDatabaseUrl from './tests/database/database-url';

/** Whether the tests run in CI (GitHub Actions sets `CI=true`). */
const isCI = Boolean(process.env.CI);

/**
 * Whether to start the last production build without building first: in CI
 * (an earlier step builds), and locally when nothing the build reads changed
 * since (`E2E_REBUILD=1` builds anyway).
 */
const reuseBuild = isCI || (!process.env.E2E_REBUILD && buildIsCurrent());

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/support/global-setup.ts',
  /** Tests share one database, so they run one at a time. */
  fullyParallel: false,
  workers: 1,
  /** Fail the CI run if a `test.only` was left in the code. */
  forbidOnly: isCI,
  /**
   * Retry flaky tests in CI only. `e2e/security.spec.ts` never retries: its
   * tests use up state, so a retry could only fail at an earlier test.
   */
  retries: isCI ? 2 : 0,
  /** Annotate GitHub pull requests in CI; HTML report locally. */
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: E2E_BASE_URL,
    /**
     * The browser asks for English (US), the default language, so the specs
     * find their text in English; a spec about other languages sets its own.
     */
    locale: 'en-US',
    /**
     * Record a trace when a test is retried, for debugging (in the HTML
     * report). `e2e/security.spec.ts` keeps one of its first failure instead.
     */
    trace: 'on-first-retry',
  },
  /** Browsers to test in. Add Firefox and WebKit here when needed. */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: reuseBuild
      ? `pnpm start --port ${E2E_PORT}`
      : `pnpm build && pnpm start --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL: getTestDatabaseUrl(),
      BETTER_AUTH_URL: E2E_BASE_URL,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      // The email helpers start the jobs' tick with it, so queued emails go out.
      CRON_SECRET: E2E_CRON_SECRET,
      EMAIL_OUTBOX_DIR: OUTBOX_DIR,
      // Allows the email outbox in this production build.
      E2E_TESTS: '1',
      // OAuth isn't tested end to end; hide the buttons even if .env configures them (every
      // provider in `OAUTH_PROVIDERS` needs its credentials blanked here).
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      // Every test sends its own client address in `X-Forwarded-For` (`e2e/support/test.ts`), so
      // the server reads addresses with the defaults even if .env names other headers or proxies.
      CLIENT_IP_HEADERS: '',
      TRUSTED_PROXIES: '',
    },
  },
});
