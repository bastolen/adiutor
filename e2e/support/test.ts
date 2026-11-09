/**
 * @file The Playwright `test` and `expect` every spec uses: Playwright's own,
 * plus a check that fails a test when one of its pages reports a Content
 * Security Policy violation (e.g. a script without the request's nonce, see
 * `src/lib/request/csp.ts`), since a blocked script often breaks a page
 * silently, or a message it couldn't show (the `[i18n]` line of
 * `src/lib/i18n/message-errors.ts`, e.g. a client component whose namespace
 * no provider passes).
 *
 * It watches every page open during the test: those of the test's own
 * context, of contexts made earlier (e.g. in `beforeAll`) and of contexts the
 * test makes with `browser.newContext()` or `browser.newPage()`. It catches
 * what Chromium reports in the console, and uncaught errors from blocked
 * `eval` (Chromium doesn't always log those).
 *
 * Each test also gets its own client address (`X-Forwarded-For`), so Better
 * Auth's per-IP limits (3 sign-ins per 10 seconds, sign-in links, codes)
 * don't carry over from the tests before it. It reaches the test's own
 * context, the contexts and pages it makes, and its `request` context. A
 * test that sets the header itself (`useOwnClientIp`, or explicit request
 * headers) still wins.
 */
import {
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  expect,
  type Page,
  test as base,
} from '@playwright/test';

import { randomClientIp } from './helpers';

export { expect };

/**
 * What a CSP violation looks like in a console message or an uncaught error,
 * and the prefix of a message that couldn't be shown.
 */
const VIOLATION = /Content Security Policy|Content-Security-Policy|EvalError|\[i18n\]/i;

/**
 * Playwright's `test`, failing on CSP violations in any page open during the
 * test, with a client address of its own.
 */
export const test = base.extend<{ cspViolations: string[] }>({
  /**
   * A fresh client address for each test, under any headers the spec set.
   *
   * @param fixtures - Playwright's fixtures.
   * @param fixtures.extraHTTPHeaders - The headers the spec or config set, if any.
   * @param provide - Hands the headers to the test (Playwright's `use`, renamed for the hooks lint rule).
   */
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ 'X-Forwarded-For': randomClientIp(), ...extraHTTPHeaders });
  },
  cspViolations: [
    // `runTest` is Playwright's `use`, renamed so the React hooks lint rule doesn't mistake it.
    async ({ browser, context }, runTest) => {
      const violations: string[] = [];
      /** Undoes the listeners and wrappers, so long-lived contexts don't collect them. */
      const cleanups: (() => void)[] = [];

      /**
       * Collects the violations a page reports.
       *
       * @param page - The page.
       */
      const watchPage = (page: Page) => {
        /**
         * Keeps a console error about the policy.
         *
         * @param message - The console message.
         */
        const onConsole = (message: ConsoleMessage) => {
          if (message.type() === 'error' && VIOLATION.test(message.text())) {
            violations.push(`${page.url()}: ${message.text()}`);
          }
        };
        /**
         * Keeps an uncaught error caused by the policy.
         *
         * @param error - The error.
         */
        const onPageError = (error: Error) => {
          if (VIOLATION.test(`${error.name}: ${error.message}`)) {
            violations.push(`${page.url()}: ${error.name}: ${error.message}`);
          }
        };
        page.on('console', onConsole);
        page.on('pageerror', onPageError);
        cleanups.push(() => {
          page.off('console', onConsole);
          page.off('pageerror', onPageError);
        });
      };

      /**
       * Watches a context's open pages and the ones it opens later.
       *
       * @param watched - The context.
       */
      const watchContext = (watched: BrowserContext) => {
        watched.pages().forEach(watchPage);
        watched.on('page', watchPage);
        cleanups.push(() => watched.off('page', watchPage));
      };

      new Set([context, ...browser.contexts()]).forEach(watchContext);
      const { newContext, newPage } = browser;
      /**
       * Makes a context the test asked for, and watches it.
       *
       * @param args - The test's arguments.
       * @returns The context.
       */
      const watchedNewContext = async (...args: Parameters<Browser['newContext']>) => {
        const created = await newContext.apply(browser, args);
        watchContext(created);
        return created;
      };
      /**
       * Makes a page (in a context of its own) the test asked for, and watches it.
       *
       * @param args - The test's arguments.
       * @returns The page.
       */
      const watchedNewPage = async (...args: Parameters<Browser['newPage']>) => {
        const created = await newPage.apply(browser, args);
        watchPage(created);
        return created;
      };
      // Contexts and pages the test makes itself, e.g. to sign in as someone else.
      Object.assign(browser, { newContext: watchedNewContext, newPage: watchedNewPage });

      try {
        await runTest(violations);
      } finally {
        Object.assign(browser, { newContext, newPage });
        cleanups.forEach((cleanup) => cleanup());
      }
      expect(violations, 'Content Security Policy violations and missing messages').toEqual([]);
    },
    { auto: true },
  ],
});
