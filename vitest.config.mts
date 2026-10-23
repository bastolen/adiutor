/**
 * @file Vitest configuration for unit and component tests.
 *
 * Tests live next to the code they test as `*.test.ts` or `*.test.tsx` files
 * in `src/`. End-to-end tests in `e2e/` run with Playwright instead.
 * @see https://nextjs.org/docs/app/guides/testing/vitest
 */
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /** Resolve `@/` imports from tsconfig.json and compile React components. */
  plugins: [tsconfigPaths(), react()],
  test: {
    /** Simulated browser DOM, so React components can render. */
    environment: 'jsdom',
    /** Adds DOM matchers such as `toBeInTheDocument()`. */
    setupFiles: ['./vitest.setup.ts'],
    /** Only unit and component tests; Playwright handles `e2e/`. */
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
