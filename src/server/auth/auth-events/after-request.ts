/**
 * @file The hook Better Auth runs after each request, in named phases: settle
 * what the checks left (locks, attempts, cookies), then react to the
 * request's success or failure.
 */
import { isAPIError } from 'better-auth/api';
import { count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { passkey } from '@/db/schema';
import { allowsEmailCodes, hasMfa, mfaMethodFromPath } from '@/lib/authz/mfa';
import { firstRow } from '@/lib/defined';
import { ACTING_AS_CHANGED_COOKIE } from '@/lib/sign-in/auth-cookies';
import { isMfaProvider } from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';

import {
  CODE_PATHS,
  finishesAuthenticatorSetup,
  releaseSignInChangeLockOf,
  settlePasswordAttempt,
  settleStepUpAttempt,
  endEmailCodeCooldown,
} from '../auth-guards';
import { loadMfaContext } from '../mfa-state';
import { requestState } from '../request-state';
import { signedSession } from '../signed-session';
import { forgetTrustedDevices } from '../trusted-devices';
import {
  clearCookiesAtSignOut,
  clearStaleProviderLinkedCookie,
  clearStaleProviderStepUpCookie,
  forgetSignedOutBrowserTrust,
  replacePreviousSession,
} from './browser-cleanup';
import { setNextPageCookie } from './cookies';
import { type FinishedRequest, finishedRequest, isWrongCodeWithSession } from './finished-request';
import { type AuthHookContext, safely, audit, auditAndNotify } from './hook-context';
import rememberLanguage from './language';
import { refreshProviderMfa, stepUpOutcomeOf, forgetProviderTokens } from './provider-accounts';
import { reactToFailure } from './refused-attempts';
import { recordRefusedReverify } from './reverify';
import { type ProviderCheckResult, recordProviderSession } from './session-hooks';
import { markSessionVerified } from './session-records';
import rememberTimeZone from './time-zone';

/**
 * First phase of {@link afterAuthRequest}: gives back the request's sign-in
 * change lock, clears the cookies that mustn't outlive it, and forgets a
 * signed-out browser's trusted device.
 *
 * @param ctx - The endpoint context, with its response.
 * @param path - The endpoint's path.
 */
async function settleRequest(ctx: AuthHookContext, path: string): Promise<void> {
  // A change to how the user signs in is made now: the next one may go ahead (`auth-guards/`).
  await safely('release sign-in change lock', () => releaseSignInChangeLockOf(ctx));
  // Signing out clears the browser but for the "Last used" hint, and the next-page notices (the
  // provider-linked one names an account) never reach the next person on the browser.
  await safely('clear cookies', async () => {
    if (path === '/sign-out') {
      clearCookiesAtSignOut(ctx);
      return;
    }
    clearStaleProviderLinkedCookie(ctx);
    clearStaleProviderStepUpCookie(ctx);
  });
  if (path === '/sign-out') {
    // Its "Trust this device" is forgotten too, not only dropped from the browser: a copy of the
    // cookie no longer skips the code step either.
    await safely("forget the browser's trusted device", () => forgetSignedOutBrowserTrust(ctx));
  }
}

/**
 * Settles the attempts the guards took before the request (`auth-guards/`):
 * a password sign-in's and a step-up code check's.
 *
 * @param ctx - The endpoint context, with its response.
 * @param request - The facts about the request.
 * @returns Whether this sign-in paused password sign-in for the address.
 */
async function settleAttempts(ctx: AuthHookContext, request: FinishedRequest): Promise<boolean> {
  const { path, returned, failed, sessionUser, email } = request;
  let paused = false;
  if (path === '/sign-in/email') {
    await safely('settle password attempt', async () => {
      // Only a refused email and password counts towards the per-address limit (`auth-guards/`),
      // whether or not the address exists; anything else gives back the attempt it took.
      const wrongPassword = isAPIError(returned) && returned.statusCode === 401;
      paused = await settlePasswordAttempt(ctx, email, wrongPassword);
    });
  }
  if (sessionUser && CODE_PATHS.has(path)) {
    // A code checked with a session (the step-up page, or setting up two-step verification): a
    // wrong code keeps the attempt it took (`auth-guards/`); anything else gives it back: a right
    // code, or one Better Auth refused without comparing it (e.g. an expired email code). The
    // same answer decides what's recorded as a wrong code (`reactToFailure`).
    const wrongCode = isWrongCodeWithSession(request);
    await safely('settle step-up attempt', () =>
      settleStepUpAttempt(ctx, sessionUser.id, wrongCode),
    );
  }
  // An emailed code checked with a session was used (on the step-up page, or turning email codes
  // on): that session's next one needn't wait (`EMAIL_CODE_RESEND_SECONDS`). A code at a sign-in's
  // code step needs nothing: its challenge ends with the sign-in.
  const challenge = requestState(ctx.context).emailCodeChallenge;
  if (path === '/two-factor/verify-otp' && !failed && challenge) {
    await safely('end the email code cooldown', () => endEmailCodeCooldown(challenge));
  }
  return paused;
}

/**
 * Reacts to a change to how the user signs in that went through: a code that
 * confirmed the session or turned two-step verification on (or finished an
 * authenticator app next to email codes), two-step verification turned off,
 * new backup codes, a passkey added or removed, a changed password. Each is
 * recorded and emailed, and sessions are marked verified or trusted devices
 * forgotten where the change calls for it.
 *
 * @param ctx - The endpoint context, with its response.
 * @param path - The endpoint's path.
 * @param userId - The user.
 * @param sessionUser - The signed-in user the request was made with, if any.
 */
async function reactToSignInChange(
  ctx: AuthHookContext,
  path: string,
  userId: string,
  sessionUser: FinishedRequest['sessionUser'],
): Promise<void> {
  switch (path) {
    case '/two-factor/verify-totp':
    case '/two-factor/verify-otp':
    case '/two-factor/verify-backup-code': {
      if (!sessionUser || !ctx.context.session) {
        break;
      }
      const method = mfaMethodFromPath(path);
      if (sessionUser.twoFactorEnabled && finishesAuthenticatorSetup(ctx)) {
        // Not a step-up: this code finished setting up an authenticator app next to email codes
        // (the guard checked this request), so it's a new way to sign in. Email codes no longer
        // count, so neither does a browser trusted after one: every trusted device is forgotten.
        await forgetTrustedDevices(db, userId);
        await markSessionVerified(ctx.context.session.session.id, 'authenticator');
        await auditAndNotify(ctx, 'two_factor_enabled', userId, { details: { method } });
      } else if (sessionUser.twoFactorEnabled) {
        // Signed in already: the step-up page confirmed this session with a code. Email codes
        // only count where the rules allow them (the guard refuses them elsewhere anyway).
        const mfa = await loadMfaContext(db, userId);
        const allowed =
          method !== 'email_code' || (mfa !== null && allowsEmailCodes(mfa.state, mfa.mfaRole));
        if (method && allowed) {
          await markSessionVerified(ctx.context.session.session.id, method);
          await audit(ctx, 'mfa_verified', userId, { method });
        }
      } else {
        // Signed in without it yet: this turned two-step verification on (and Better Auth
        // replaced the session; `beforeSessionCreate` decided whether the new one counts).
        await auditAndNotify(ctx, 'two_factor_enabled', userId, { details: { method } });
      }
      break;
    }
    case '/two-factor/disable':
      await forgetTrustedDevices(db, userId);
      await auditAndNotify(ctx, 'two_factor_disabled', userId);
      break;
    case '/two-factor/generate-backup-codes':
      await auditAndNotify(ctx, 'backup_codes_regenerated', userId);
      break;
    case '/passkey/verify-registration': {
      await auditAndNotify(ctx, 'passkey_added', userId);
      // A first passkey on an account without other MFA that counts (for its role now) counts
      // for the current session too: there was nothing to protect before. (Accounts with a second
      // step need a confirmed session to add one at all; see `auth-guards/`.)
      const { total } = firstRow(
        await db.select({ total: count() }).from(passkey).where(eq(passkey.userId, userId)),
        'the passkey count',
      );
      const mfa = total === 1 ? await loadMfaContext(db, userId) : null;
      const hadMfa =
        mfa !== null && hasMfa({ ...mfa.state, passkeyCount: 0 }, mfa.mfaRole, availableProviders);
      if (mfa && !hadMfa && ctx.context.session) {
        await markSessionVerified(ctx.context.session.session.id, 'passkey');
      }
      break;
    }
    case '/passkey/delete-passkey':
      await auditAndNotify(ctx, 'passkey_removed', userId);
      break;
    case '/change-password':
      // A new password starts afresh, as a reset does: no earlier "Trust this device" skips the
      // code step with it (a synced password manager would hand it to a stolen browser).
      await forgetTrustedDevices(db, userId);
      await auditAndNotify(ctx, 'password_changed', userId);
      break;
    // Session revocation is audited where it happens (`sessions.ts`); Better Auth's own
    // `/revoke-*` endpoints are disabled (`DISABLED_AUTH_PATHS`).
    default:
  }
}

/**
 * Whether a sign-in through this endpoint comes back to the app with a
 * redirect: a provider's callback, or an email link. No code of the page
 * that started it runs afterwards, so it can't tell the browser's other tabs
 * itself, as a password, passkey or code sign-in does (`loadFresh` with
 * `everyTab`).
 *
 * @param path - The endpoint's path.
 * @returns Whether it's `/callback/…` or `/magic-link/verify`.
 */
function signsInByRedirect(path: string): boolean {
  return path.startsWith('/callback/') || path === '/magic-link/verify';
}

/**
 * Reacts to a request that went through: ends the browser's previous session
 * when a new one started, and when that sign-in came back with a redirect and
 * the browser acts as someone else now, leaves the next page a cookie that
 * tells the other tabs to load afresh (`ACTING_AS_CHANGED_COOKIE`). It checks
 * a provider callback's MFA (for `recordProviderSession`), and otherwise
 * reacts to the change to how the user signs in ({@link reactToSignInChange}).
 *
 * @param ctx - The endpoint context, with its response.
 * @param request - The facts about the request.
 * @param providerCheck - Filled in with whether a provider's 2FA confirmed the new session.
 */
async function reactToSuccess(
  ctx: AuthHookContext,
  request: FinishedRequest,
  providerCheck: ProviderCheckResult,
): Promise<void> {
  const { path, failed, userId, sessionUser } = request;
  if (failed || !userId) {
    return;
  }

  const { newSession } = ctx.context;
  if (newSession) {
    // Unless it says otherwise: telling the other tabs once too often only loads them again.
    let actsAsSomeoneElse = true;
    // Also for a password sign-in that goes on to the code step, and whoever's the old session
    // was: see `replacePreviousSession`. On its own, so a failure doesn't skip what follows.
    await safely("end the browser's previous session", async () => {
      actsAsSomeoneElse = await replacePreviousSession(ctx, {
        id: newSession.session.id,
        userId: newSession.user.id,
      });
    });
    if (actsAsSomeoneElse && signsInByRedirect(path)) {
      await safely('tell the next page the browser acts as someone else', async () => {
        setNextPageCookie(ctx, ACTING_AS_CHANGED_COOKIE, '1');
      });
    }
    // The browser gets the account's language and zone. A password sign-in's session may still be
    // deleted for the code step, so `afterPasswordSignIn` does it once the session stays.
    if (path !== '/sign-in/email') {
      await safely('remember the language', () => rememberLanguage(ctx, newSession.user.id));
      await safely('remember the time zone', () => rememberTimeZone(ctx, newSession.user.id));
    }
  }

  // A password sign-in's session (and a trusted device) is only settled after Better Auth's
  // two-step plugin, which runs after these reactions: see `afterPasswordSignIn`.
  if (path.startsWith('/callback/')) {
    // Whether this confirmed the new session, or why not, also decides how a step-up's session is
    // recorded and what the next page says (`recordProviderSession`).
    const provider = ctx.params?.id;
    if (!isMfaProvider(provider)) {
      return;
    }
    // The account that signed in counts only with 2FA, and once the user confirmed it.
    const checked = await refreshProviderMfa(provider, userId);
    if (newSession && checked?.enabled && checked.confirmed) {
      await markSessionVerified(newSession.session.id, provider);
      // eslint-disable-next-line no-param-reassign -- The caller reads the outcome from it.
      providerCheck.confirmedSessionId = newSession.session.id;
    } else {
      // eslint-disable-next-line no-param-reassign -- As above.
      providerCheck.outcome = stepUpOutcomeOf(checked);
    }
    return;
  }

  await reactToSignInChange(ctx, path, userId, sessionUser);
}

/**
 * Last phase of a provider callback: checks the MFA of an account that was
 * reconnected (which only updates it), and forgets the provider tokens the
 * request stored for the MFA check.
 *
 * @param ctx - The endpoint context, with its response.
 * @param request - The facts about the request.
 * @param refusedReverify - The refused re-verify, if there was one (it updated nothing).
 */
async function finishProviderCallback(
  ctx: AuthHookContext,
  request: FinishedRequest,
  refusedReverify: { userId: string; providerId: string | null } | null,
): Promise<void> {
  const { failed, userId } = request;
  await safely('finish provider callback', async () => {
    // Connecting from the Security page creates no session, so its user comes from the cookie.
    const owner = userId ?? (await signedSession(ctx))?.userId;
    if (!owner) {
      return;
    }
    // Reconnecting an account that's connected already only updates it: check its MFA now. (A
    // refused re-verify updated nothing.)
    const provider = ctx.params?.id;
    if (!userId && !failed && !refusedReverify && isMfaProvider(provider)) {
      await refreshProviderMfa(provider, owner);
    }
    // The request stored tokens for the provider's MFA check; nothing needs them now.
    await forgetProviderTokens(owner);
  });
}

/**
 * After every Better Auth request: records security changes and failed
 * sign-ins and confirmations (a wrong code on the step-up page with the user
 * as its actor; one at a password sign-in's code step without an actor, and
 * a notice once wrong codes pause signing in with a code:
 * {@link reactToRefusedSignInCode}), marks sessions verified after a step-up, a
 * first MFA setup or a provider account with 2FA, checks the MFA of
 * provider accounts after signing in with or connecting them, and forgets
 * trusted devices: every one of the user's when two-step verification is
 * turned off, the password is changed or an authenticator app is set up next
 * to email codes, and the browser's own when it signs out. A re-verify
 * ("Confirm with GitHub" on the step-up page) is recorded only once that
 * check decided whether it confirmed the new session
 * ({@link recordProviderSession}): `mfa_verified` when it did, a sign-in with
 * the provider when it didn't, and then the next page says why
 * (`PROVIDER_STEP_UP_COOKIE`). One refused for another account than the
 * user's own confirmed one ({@link checkReverify}) is recorded once as a
 * failed confirmation of the user who started it (`mfa_failed` with
 * `reason: 'different_account'`), and the provider isn't asked about it. It
 * runs before the plugins' own reactions, so password sign-ins that went
 * through are recorded by {@link afterPasswordSignIn} instead.
 *
 * It runs in phases, each its own function: {@link settleRequest},
 * {@link recordRefusedReverify}, {@link settleAttempts}, then
 * {@link reactToFailure} or {@link reactToSuccess} (and
 * {@link reactToSignInChange}), {@link recordProviderSession} and, for a
 * provider callback, {@link finishProviderCallback}.
 *
 * @param ctx - The endpoint context, with its response.
 */
export async function afterAuthRequest(ctx: AuthHookContext): Promise<void> {
  const { path } = ctx;
  if (!path) {
    return;
  }
  await settleRequest(ctx, path);
  const request = finishedRequest(ctx, path);
  const refusedReverify = await recordRefusedReverify(ctx);
  const paused = await settleAttempts(ctx, request);
  // The session a provider's 2FA confirmed, or why it didn't, for `recordProviderSession`. Until
  // the check says otherwise, it couldn't be made.
  const providerCheck: ProviderCheckResult = { confirmedSessionId: null, outcome: 'unchecked' };
  await safely(`after ${path}`, async () => {
    if (await reactToFailure(ctx, request, paused)) {
      return;
    }
    await reactToSuccess(ctx, request, providerCheck);
  });
  // A provider step-up's session waited for the check above; recorded on its own, so a failed
  // check or an early return above still records it, once, and the next page still says why.
  await safely('record provider session', () => recordProviderSession(ctx, providerCheck));
  if (path.startsWith('/callback/')) {
    await finishProviderCallback(ctx, request, refusedReverify);
  }
}
