/**
 * @file Vitest configuration, with two projects:
 * - `unit`: unit and component tests (`*.test.ts(x)` next to the code in
 *   `src/`, the test helpers' own tests in `tests/`, and the scripts' in
 *   `scripts/`), in a simulated browser DOM.
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
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
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
          /** Tests share one database, so files run one at a time. */
          fileParallelism: false,
          testTimeout: 15_000,
          /**
           * Every provider that can prove MFA (`MFA_PROVIDERS`) counts as
           * configured (dummy values; nothing calls the providers), so its MFA
           * rules apply as in production, whatever the local `.env` says. A new
           * one needs its credentials here too.
           */
          env: {
            GITHUB_CLIENT_ID: 'adiutor-tests-github-client',
            GITHUB_CLIENT_SECRET: 'adiutor-tests-github-secret',
          },
        },
      },
    ],
  },
});
