/**
 * @file The facts about a finished Better Auth request that the phases after it
 * share.
 */
import { isAPIError } from 'better-auth/api';

import { normalizeEmail } from '../auth-guards';
import type { AuthHookContext } from './hook-context';

/** The facts about a finished Better Auth request that the phases of {@link afterAuthRequest} share. */
export interface FinishedRequest {
  /** The endpoint's path, e.g. `/sign-in/email`. */
  path: string;
  /** What the endpoint returned, or the error it threw. */
  returned: unknown;
  /** Whether it failed (redirects are thrown as errors too; only 4xx/5xx count). */
  failed: boolean;
  /** The signed-in user the request was made with, if any. */
  sessionUser: NonNullable<AuthHookContext['context']['session']>['user'] | null;
  /** That user, or the user of the session the request created. */
  userId: string | null;
  /** The address a password sign-in was for, normalized. */
  email: string | null;
}

/**
 * Reads the facts about a finished request.
 *
 * @param ctx - The endpoint context, with its response.
 * @param path - The endpoint's path.
 * @returns The facts.
 */
export function finishedRequest(ctx: AuthHookContext, path: string): FinishedRequest {
  const { returned } = ctx.context;
  const sessionUser = ctx.context.session?.user ?? null;
  return {
    path,
    returned,
    // Redirects (e.g. after a provider callback) are thrown as errors too; only 4xx/5xx failed.
    failed: isAPIError(returned) && returned.statusCode >= 400,
    sessionUser,
    userId: sessionUser?.id ?? ctx.context.newSession?.user.id ?? null,
    email: path === '/sign-in/email' ? normalizeEmail(ctx.body?.email) : null,
  };
}
