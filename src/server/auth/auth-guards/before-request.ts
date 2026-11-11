/**
 * @file The hook Better Auth runs before each request: it routes the request to
 * the checks that apply to its endpoint.
 */
import { APIError, getSessionFromCtx } from 'better-auth/api';

import { db } from '@/db';
import { normalizeEmail } from '@/lib/email-address';

import { markReverify } from '../reverify-marker';
import { reservePasswordAttempt, limit, AUTH_GUARD_LIMITS } from './attempts';
import { checkCodeStep } from './code-step';
import { checkPasswordReset } from './password-reset';
import { type AuthGuardContext, CREDENTIAL_PATHS, STEP_PATHS } from './paths';
import { noteRefusalLocale, twoFactorMethodNotAllowedBody } from './refusal-messages';
import {
  confirmSignInLinkFirst,
  refuseUnsafeReturnAddresses,
  refuseInvalidPasskeyName,
} from './request-checks';
import { checkSignedIn } from './signed-in';

/**
 * Reads the email address a request is about, lower-cased.
 *
 * @param ctx - The endpoint context.
 * @returns The address, or `null` without one (Better Auth then refuses the request itself).
 */
function emailOf(ctx: AuthGuardContext): string | null {
  return normalizeEmail(ctx.body?.email);
}

/**
 * Runs the checks for a Better Auth request; see the file description.
 *
 * @param ctx - The endpoint context.
 * @throws {APIError} When the request is refused.
 */
export async function beforeAuthRequest(ctx: AuthGuardContext): Promise<void> {
  const { path } = ctx;
  if (!path) {
    return;
  }
  // Any refusal below is worded in the request's language, with Adiutor's default for a
  // browser that chose none.
  await noteRefusalLocale(ctx, db);

  if (path === '/magic-link/verify') {
    // The confirmation page first: it passes only safe return addresses on.
    confirmSignInLinkFirst(ctx);
    refuseUnsafeReturnAddresses(ctx, path);
    return;
  }
  // Before anything is counted, marked or locked, so a refused request leaves nothing behind.
  refuseUnsafeReturnAddresses(ctx, path);

  if (path === '/sign-in/email') {
    const email = emailOf(ctx);
    if (email) {
      await reservePasswordAttempt(ctx, email);
    }
    return;
  }
  if (path === '/sign-in/magic-link' || path === '/request-password-reset') {
    const email = emailOf(ctx);
    if (email) {
      await limit(ctx, `${path}:email:${email}`, AUTH_GUARD_LIMITS.emailsPerAddress);
    }
    return;
  }
  if (path === '/sign-in/social') {
    // "Confirm with GitHub" on the step-up page: only the user's own confirmed account may answer.
    await markReverify(ctx);
    return;
  }
  if (path === '/reset-password') {
    // Setting a password through a reset or welcome link (the POST; the link's GET is
    // `/reset-password/:token`).
    await checkPasswordReset(ctx);
    return;
  }

  if (!CREDENTIAL_PATHS.has(path) && !STEP_PATHS.has(path)) {
    return;
  }
  // Pure, so before the session is read or the user's lock taken: a refused name leaves nothing behind.
  refuseInvalidPasskeyName(ctx, path);
  // `/two-factor/enable` would turn on email codes without proving one arrives (`method: 'otp'`).
  const method = ctx.body?.method;
  if (path === '/two-factor/enable' && method !== undefined && method !== 'totp') {
    throw new APIError('BAD_REQUEST', twoFactorMethodNotAllowedBody(ctx));
  }

  const session = await getSessionFromCtx(
    ctx as unknown as Parameters<typeof getSessionFromCtx>[0],
  );
  if (session) {
    await checkSignedIn(ctx, path, session);
    return;
  }

  // A password sign-in waiting for its code step (sign-in methods can't be changed without a session).
  if (STEP_PATHS.has(path)) {
    await checkCodeStep(ctx, path);
  }
}
