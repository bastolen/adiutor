/**
 * @file One change to how a user signs in at a time: which endpoints are such a
 * change, and the lock the checks hold for them until the request ends.
 */
import { db } from '@/db';
import { type SignInChange } from '@/lib/authz/mfa';

import { requestState, takeRequestState } from '../request-state';
import { releaseSignInChangeLock, takeSignInChangeLock } from '../sign-in-change-lock';

/**
 * Works out which change a request makes to how the user signs in, as far as
 * it could take away their MFA (see `wouldRemoveRequiredMfa`).
 *
 * @param path - The endpoint path.
 * @param body - The request body.
 * @returns The change, or `null` for requests that can't take MFA away.
 */
export function signInChangeOf(
  path: string,
  body: Record<string, unknown> | null | undefined,
): SignInChange | null {
  switch (path) {
    case '/passkey/delete-passkey':
      return { kind: 'remove_passkey' };
    case '/two-factor/disable':
      return { kind: 'turn_off_two_factor' };
    case '/unlink-account':
      return typeof body?.accountId === 'string'
        ? { kind: 'disconnect_provider', accountId: body.accountId }
        : null;
    case '/link-social':
      return {
        kind: 'connect_provider',
        providerId: typeof body?.provider === 'string' ? body.provider : 'unknown',
      };
    default:
      return null;
  }
}

/**
 * Makes sure the request holds the user's lock, for a decision made during
 * it rather than before it (whether a provider connected at the OAuth
 * callback counts): reuses the lock the request took already, or takes it.
 * It's given back after the request, like the others.
 *
 * @param ctx - The endpoint context.
 * @param ctx.context - Better Auth's request state.
 * @param userId - The user.
 * @returns Whether the request holds it now; `false` while another change holds it.
 */
export async function holdSignInChangeLock(
  ctx: { context: object },
  userId: string,
): Promise<boolean> {
  const state = requestState(ctx.context);
  if (state.heldSignInChangeLock) {
    return state.heldSignInChangeLock.userId === userId;
  }
  const lock = await takeSignInChangeLock({ db }, userId);
  if (!lock) {
    return false;
  }
  state.heldSignInChangeLock = lock;
  return true;
}

/**
 * Gives back the lock a sign-in change took, once Better Auth made it (called
 * after the request). Without one, nothing happens.
 *
 * @param ctx - The endpoint context (its `context` is shared with the checks before).
 * @param ctx.context - Better Auth's request state.
 */
export async function releaseSignInChangeLockOf(ctx: { context: object }): Promise<void> {
  const lock = takeRequestState(ctx.context, 'heldSignInChangeLock');
  if (!lock) {
    return;
  }
  await releaseSignInChangeLock({ db }, lock);
}
