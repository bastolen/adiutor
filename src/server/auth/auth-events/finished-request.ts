/**
 * @file The facts about a finished Better Auth request that the phases after it
 * share.
 */
import { isAPIError } from 'better-auth/api';

import { normalizeEmail } from '@/lib/email-address';

import { CODE_PATHS } from '../auth-guards';
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

/**
 * Whether a request checked a code with a session (the step-up page, or
 * setting up two-step verification) and that code was wrong. With a session,
 * Better Auth answers 401 only for a code it compared. Its other refusals
 * there compared none: an emailed code that expired, too many tries for one
 * code, a method that isn't turned on (all 400), a request that crossed
 * another (409), or an error of the server.
 *
 * It's the one answer for both what counts towards the step-up limit
 * (`settleStepUpAttempt`) and what the audit log records as a wrong code
 * (`mfa_failed`), so the two never disagree: a code that wasn't compared
 * gives its attempt back and isn't recorded.
 *
 * @param request - The facts about the request.
 * @returns Whether a code was compared and refused.
 */
export function isWrongCodeWithSession(request: FinishedRequest): boolean {
  const { path, returned, sessionUser } = request;
  return (
    sessionUser !== null &&
    CODE_PATHS.has(path) &&
    isAPIError(returned) &&
    returned.statusCode === 401
  );
}
