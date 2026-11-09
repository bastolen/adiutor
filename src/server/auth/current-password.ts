/**
 * @file Checking the signed-in user's current password before a change that
 * asks for it (changing the password, deactivating the account). Better
 * Auth's per-IP limiter only runs for requests over HTTP, not for its
 * `auth.api` calls from server actions, and the app's own wrong-password
 * limit only covers sign-ins (`auth-guards/`): without this, a signed-in
 * (possibly stolen) session could guess the password without limit or trace.
 * Each check takes one of the user's attempts first and gives it back unless
 * the password was wrong, so checks sent at the same moment can't all get
 * through; each wrong one is recorded in the audit log.
 */
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import {
  hitRateLimit,
  RATE_LIMITS,
  releaseRateLimitHit,
  tooManyAttemptsError,
} from '../rate-limit';

/**
 * What a current password is checked for, recorded with a wrong one
 * (`password_check_failed`'s `purpose`).
 */
export type PasswordCheckPurpose = 'change_password' | 'deactivate';

/**
 * The key counting a user's wrong current passwords
 * (`RATE_LIMITS.wrongCurrentPasswordsPerUser`). A bucket of its own,
 * not the address's sign-in one (`failedSignInsKey`), so a stolen session
 * can't pause the owner's password sign-in. Stored: changing it resets live
 * counts.
 *
 * @param userId - The user.
 * @returns The key.
 */
export function wrongCurrentPasswordsKey(userId: string): string {
  return `current-password-failed:user:${userId}`;
}

/**
 * Checks the signed-in user's current password with `check`, under the
 * limit on wrong ones per user. It takes one of the user's attempts before
 * the check and gives it back when the password was right, or when the check
 * failed for another reason (it then rethrows that error); a wrong password
 * keeps the attempt and is recorded as `password_check_failed`.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user, checking their own password.
 * @param purpose - What it's checked for, recorded with a wrong one.
 * @param check - Checks the password (and may make the change it protects, e.g. Better Auth's
 *   `changePassword`): resolves `true` when it was right, `false` when it was wrong.
 * @throws {ServiceError} `rate_limited` once the user's wrong passwords used up the limit
 *   (without running the check), `invalid` for a wrong password.
 */
export async function checkCurrentPassword(
  ctx: ServiceContext,
  actor: Pick<Actor, 'id'>,
  purpose: PasswordCheckPurpose,
  check: () => Promise<boolean>,
): Promise<void> {
  const key = wrongCurrentPasswordsKey(actor.id);
  const { allowed, retryAfterSeconds } = await hitRateLimit(
    ctx,
    key,
    RATE_LIMITS.wrongCurrentPasswordsPerUser,
  );
  if (!allowed) {
    throw tooManyAttemptsError(retryAfterSeconds);
  }

  let right: boolean;
  try {
    right = await check();
  } catch (error) {
    // Not a wrong password: the attempt doesn't count.
    await releaseRateLimitHit(ctx, key);
    throw error;
  }
  if (right) {
    await releaseRateLimitHit(ctx, key);
    return;
  }
  await recordEvent(ctx, {
    action: 'password_check_failed',
    actorUserId: actor.id,
    targetUserId: actor.id,
    details: { purpose },
  });
  // The wording each form used before: `errors.wrongPassword.change_password` on the Security
  // page's password form, `errors.wrongPassword.deactivate` in its "Deactivate account" dialog.
  throw new ServiceError('invalid', `errors.wrongPassword.${purpose}`);
}
