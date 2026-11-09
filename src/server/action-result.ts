/**
 * @file A wrapper for server actions that turns expected errors into
 * user-facing messages, in the request's language. The result type itself is
 * in `src/lib/action-result.ts`, so client components can use it too.
 */
import { ZodError } from 'zod';

import type { ActionResult } from '@/lib/action-result';
import requestLocale from '@/lib/i18n/request-locale';

import {
  concurrentChangeError,
  isDeadlock,
  ServiceError,
  serviceErrorMessage,
  validationErrorMessage,
} from './errors';

/**
 * Runs a server action's work and turns expected problems (invalid input,
 * missing permission, conflicts) into a failed result with a safe message,
 * translated into the request's language: a service error's message
 * (`serviceErrorMessage`), or the first problem of invalid input
 * (`validationErrorMessage`, "Check your input." when zod worded it). A
 * database deadlock (`isDeadlock`) counts as a conflict too: Postgres ended
 * the transaction to let another one through, so nothing was changed and the
 * user is asked to try again ({@link concurrentChangeError}). Unexpected
 * errors are rethrown, so they're logged and shown as an error.
 *
 * @param work - The action's work; returns the success result.
 * @returns The result for the form.
 */
export default async function runAction<T>(
  work: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ServiceError) {
      return { ok: false, message: serviceErrorMessage(error, await requestLocale()) };
    }
    if (error instanceof ZodError) {
      return { ok: false, message: validationErrorMessage(error, await requestLocale()) };
    }
    if (isDeadlock(error)) {
      // eslint-disable-next-line no-console -- Transactions lock in one order, so a deadlock points at one that doesn't; no request details.
      console.warn('A server action hit a database deadlock; the user was asked to try again.');
      return {
        ok: false,
        message: serviceErrorMessage(concurrentChangeError(), await requestLocale()),
      };
    }
    throw error;
  }
}
