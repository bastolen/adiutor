/**
 * @file The checks on signed-in requests: the second step and recent confirmation
 * a change needs, the MFA a role requires, and turning two-step
 * verification on or off.
 */
import { APIError } from 'better-auth/api';

import { db } from '@/db';
import {
  allowsEmailCodes,
  canConfirmSessions,
  isMfaConfirmedRecently,
  isSessionMfaVerified,
  mfaConfirmedUntil,
  needsFreshSignIn,
  type SignInChange,
  wouldRemoveRequiredMfa,
} from '@/lib/authz/mfa';
import { availableProviders } from '@/lib/sign-in/providers';
import {
  MFA_REQUIRED_FOR_ROLE,
  MFA_VERIFICATION_REQUIRED,
  SESSION_NOT_FRESH,
  TWO_FACTOR_ALREADY_OFF,
} from '@/lib/sign-in/sign-in-refusals';

import { loadMfaContext } from '../mfa-state';
import { requestState } from '../request-state';
import { releaseSignInChangeLock, takeSignInChangeLock } from '../sign-in-change-lock';
import { limitEmailCode, reserveStepUpAttempt } from './attempts';
import { signInChangeOf } from './change-lock';
import {
  type AuthGuardContext,
  RENAME_PATHS,
  refuseUnfinishedBackupCodes,
  CREDENTIAL_PATHS,
  STEP_PATHS,
  EMAIL_CODE_PATHS,
  refuseEmailCodes,
  CODE_PATHS,
  refuseSignInChangeInProgress,
} from './paths';
import { refusalBody } from './refusal-messages';

/**
 * Checks whether a request's code finished setting up an authenticator app
 * (`finishingAuthenticatorSetup` in `request-state.ts`, set by the guards).
 *
 * @param ctx - The endpoint context, as passed to the hooks.
 * @param ctx.context - Better Auth's request state.
 * @returns Whether it did, as far as the checks before it could tell.
 */
export function finishesAuthenticatorSetup(ctx: { context: object }): boolean {
  return requestState(ctx.context).finishingAuthenticatorSetup === true;
}

/**
 * Refuses a change that would leave a role that requires MFA without it.
 *
 * @param ctx - The endpoint context, for the request's language.
 * @throws {APIError} Always.
 */
function refuseMfaDowngrade(ctx: AuthGuardContext): never {
  throw new APIError('FORBIDDEN', refusalBody(ctx, MFA_REQUIRED_FOR_ROLE.code));
}

/**
 * Refuses turning off two-step verification that's off already.
 *
 * @param ctx - The endpoint context, for the request's language.
 * @throws {APIError} Always: `BAD_REQUEST` with code `TWO_FACTOR_ALREADY_OFF`.
 */
function refuseTwoFactorAlreadyOff(ctx: AuthGuardContext): never {
  throw new APIError('BAD_REQUEST', refusalBody(ctx, TWO_FACTOR_ALREADY_OFF.code));
}

/** A session as the checks for a signed-in request see it. */
interface SignedInSession {
  /** The session's MFA facts. */
  session: {
    /** Whether it had a second factor. */
    mfaVerified?: boolean | null;
    /** Which one. */
    mfaMethod?: string | null;
    /** When. */
    mfaVerifiedAt?: Date | string | null;
    /** When it signed in. */
    createdAt?: Date | string | null;
  };
  /** Its user. */
  user: { id: string; twoFactorEnabled?: boolean | null };
}

/**
 * The checks of `checkSignedIn`, once a change holds the user's lock.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint path.
 * @param session - The session and its user.
 * @param change - What the request changes about how the user signs in, if anything.
 * @throws {APIError} When the request is refused.
 */
async function checkSignedInRequest(
  ctx: AuthGuardContext,
  path: string,
  session: SignedInSession,
  change: SignInChange | null,
): Promise<void> {
  const mfa = await loadMfaContext(db, session.user.id);
  if (!mfa) {
    return;
  }
  const { mfaRole, state } = mfa;
  const sessionMfa = {
    mfaVerified: session.session.mfaVerified ?? false,
    mfaMethod: session.session.mfaMethod ?? null,
    mfaVerifiedAt: session.session.mfaVerifiedAt ?? null,
  };
  const confirmed = RENAME_PATHS.has(path)
    ? isSessionMfaVerified(sessionMfa, mfaRole)
    : isMfaConfirmedRecently(mfaConfirmedUntil(sessionMfa, mfaRole, state));
  if (path === '/two-factor/verify-backup-code' && !state.authenticator) {
    refuseUnfinishedBackupCodes();
  }
  // A code step while two-step verification is still off is turning it on; an authenticator code
  // while it's on but without an authenticator app finishes setting one up next to email codes.
  const finishesSetup = path === '/two-factor/verify-totp' && !state.authenticator;
  const settingUp =
    CREDENTIAL_PATHS.has(path) ||
    (STEP_PATHS.has(path) && !session.user.twoFactorEnabled) ||
    finishesSetup;

  // An account with a second step that can be used here must have confirmed with it in the last
  // 15 minutes (renaming: at all), even when that step doesn't count as its MFA (GitHub with 2FA
  // next to a password), and with GitHub only while the account has no passkey or authenticator
  // app (`mfaConfirmedUntil`). Without one, there's nothing to protect yet.
  const hasSecondStep = canConfirmSessions(state, mfaRole, availableProviders);
  if (settingUp && hasSecondStep && !confirmed) {
    throw new APIError('FORBIDDEN', refusalBody(ctx, MFA_VERIFICATION_REQUIRED.code));
  }
  const signedInAt = session.session.createdAt ? new Date(session.session.createdAt) : null;
  // Without a second step, a sign-in from the last hour instead (`needsFreshSignIn`), so an old
  // (stolen) session can't add the first way in. (A first password is set through
  // `setFirstPassword`, which applies this rule itself: Better Auth's `setPassword` is server-only
  // and never reaches these checks.)
  if (settingUp && needsFreshSignIn({ canConfirmSessions: hasSecondStep, signedInAt })) {
    throw new APIError('FORBIDDEN', refusalBody(ctx, SESSION_NOT_FRESH.code));
  }
  // Only once the session may make the change at all, like the refusals below: nothing to turn off.
  if (path === '/two-factor/disable' && !state.twoFactorEnabled) {
    refuseTwoFactorAlreadyOff(ctx);
  }
  if (change && wouldRemoveRequiredMfa(state, mfaRole, change, availableProviders)) {
    refuseMfaDowngrade(ctx);
  }
  if (finishesSetup && session.user.twoFactorEnabled) {
    requestState(ctx.context).finishingAuthenticatorSetup = true;
  }
  if (EMAIL_CODE_PATHS.has(path) && !allowsEmailCodes(state, mfaRole)) {
    refuseEmailCodes(ctx);
  }
  // An emailed code waits for the last one (setting up too), and on the step-up page counts
  // towards the user's limit; setting up email codes doesn't count.
  if (path === '/two-factor/send-otp') {
    await limitEmailCode(ctx, session.user.id, !settingUp);
  }
  if (settingUp) {
    return;
  }

  // Last, so no check after it can refuse the request and leave the attempt taken.
  if (CODE_PATHS.has(path)) {
    await reserveStepUpAttempt(ctx, session.user.id);
  }
}

/**
 * The checks for a request made with a session: changing sign-in methods,
 * and confirming the session on the step-up page. A change to how the user
 * signs in first takes the user's lock, before anything about them is read,
 * so two at the same moment can't both pass the checks; it's given back
 * after the request ({@link releaseSignInChangeLockOf}), or right away when
 * the change is refused.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint path.
 * @param session - The session and its user.
 * @throws {APIError} When the request is refused.
 */
export async function checkSignedIn(
  ctx: AuthGuardContext,
  path: string,
  session: SignedInSession,
): Promise<void> {
  const change = signInChangeOf(path, ctx.body);
  const lock = change ? await takeSignInChangeLock({ db }, session.user.id) : null;
  if (change && !lock) {
    refuseSignInChangeInProgress(ctx);
  }
  try {
    await checkSignedInRequest(ctx, path, session, change);
  } catch (error) {
    if (lock) {
      await releaseSignInChangeLock({ db }, lock);
    }
    throw error;
  }
  if (lock) {
    requestState(ctx.context).heldSignInChangeLock = lock;
  }
}
