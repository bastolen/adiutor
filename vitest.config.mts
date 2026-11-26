/**
 * @file Vitest configuration, with two projects:
 * - `unit`: unit and component tests (`*.test.ts(x)` next to the code in
 *   `src/`), in a simulated browser DOM. Tests cover the application only, so
 *   the test helpers in `tests/` and the scripts in `scripts/` have none.
 * - `integration`: service tests against a real PostgreSQL test database
 *   (`*.int.test.ts`), run one file at a time.
 *
 * End-to-end tests in `e2e/` run with Playwright instead.
 * @see https://nextjs.org/docs/app/guides/testing/vitest
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /** Compile React components. */
  plugins: [react()],
  /** Resolve `@/` imports from tsconfig.json. */
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          /** Simulated browser DOM, so React components can render. */
          environment: 'jsdom',
          /** Adds DOM matchers such as `toBeInTheDocument()`. */
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.ts'],
          /** Creates and migrates the test database once per run. */
          globalSetup: ['./tests/integration/global-setup.ts'],
          /** Points the app's `@/db` module at the test database in every file. */
          setupFiles: ['./tests/integration/setup.ts'],
          /** Tests share one database, so files run one at a time. */
          fileParallelism: false,
          testTimeout: 15_000,
          /**
           * Every provider that can prove MFA (`MFA_PROVIDERS`) counts as
           * configured (dummy values; nothing calls the providers), so its MFA
           * rules apply as in production, whatever the local `.env` says. A new
           * one needs its credentials here too. Loopback is allowed for webhooks.
           */
          env: {
            GITHUB_CLIENT_ID: 'adiutor-tests-github-client',
            GITHUB_CLIENT_SECRET: 'adiutor-tests-github-secret',
            /**
             * Webhooks never reach loopback, except where the operator allows it: the tests'
             * receivers listen on 127.0.0.1 (`tests/http/webhook-receiver.ts`).
             */
            WEBHOOK_ALLOWED_NETWORKS: '127.0.0.1/32',
          },
        },
      },
    ],
  },
});
