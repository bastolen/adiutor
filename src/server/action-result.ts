/**
 * @file A wrapper for server actions that turns expected errors into
 * user-facing messages. The result type itself is in
 * `src/lib/action-result.ts`, so client components can use it too.
 */
import { ZodError } from 'zod';

import type { ActionResult } from '@/lib/action-result';

import { concurrentChangeError, isDeadlock, ServiceError } from './errors';

/**
 * Runs a server action's work and turns expected problems (invalid input,
 * missing permission, conflicts) into a failed result with a safe message.
 * A database deadlock (`isDeadlock`) counts as a conflict too: Postgres ended
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
      return { ok: false, message: error.message };
    }
    if (error instanceof ZodError) {
      return { ok: false, message: error.issues[0]?.message ?? 'Check your input.' };
    }
    if (isDeadlock(error)) {
      // eslint-disable-next-line no-console -- Transactions lock in one order, so a deadlock points at one that doesn't; no request details.
      console.warn('A server action hit a database deadlock; the user was asked to try again.');
      return { ok: false, message: concurrentChangeError().message };
    }
    throw error;
  }
}
