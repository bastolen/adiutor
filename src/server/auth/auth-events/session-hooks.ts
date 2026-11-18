/**
 * @file The hooks for sessions: a replacement keeps its sign-in's MFA and age, a
 * new session is recorded as a sign-in, and a provider sign-in on the
 * step-up page is checked before it counts.
 */
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import {
  hasMfa,
  mfaMethodFromPath,
  isSessionMfaVerified,
  type SessionMfaInput,
  sessionMfaOf,
  type SignInMethod,
  signInMethodFromPath,
} from '@/lib/authz/mfa';
import {
  isMfaProvider,
  PROVIDER_STEP_UP_COOKIE,
  providerStepUpCookieValue,
  type ProviderStepUpOutcome,
} from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';
import { ACCOUNT_DEACTIVATED, REVERIFY_WRONG_ACCOUNT } from '@/lib/sign-in/sign-in-refusals';

import { recordEvent } from '../../audit';
import { CODE_PATHS } from '../auth-guards';
import { loadMfaContext } from '../mfa-state';
import {
  type PendingProviderStepUp,
  requestState,
  type SessionData,
  takeRequestState,
} from '../request-state';
import { currentReverify, type ReverifyMarker } from '../reverify-marker';
import { setNextPageCookie, expireCookieIfSent } from './cookies';
import { type AuthHookContext, withRequestInfo, safely } from './hook-context';
import { noteRefusedReverify } from './reverify';
import { ownSession, hasReverifySession } from './session-records';

/**
 * Endpoints where Better Auth replaces the signed-in session with a new one
 * for the same sign-in (turning off two-step verification, changing the
 * password with other devices signed out), which keeps the old one's
 * confirmation ({@link keptConfirmation}).
 */
const SESSION_REPLACING_PATHS = new Set(['/two-factor/disable', '/change-password']);

/**
 * Endpoints where a session Better Auth creates while one of the same user is
 * signed in replaces it for the same sign-in, and so keeps its age
 * ({@link keptAge}): {@link SESSION_REPLACING_PATHS}, a code that turns
 * two-step verification on (`CODE_PATHS`; a step-up code creates no session),
 * and `/two-factor/enable`, which replaces the session when it turns on email
 * codes (refused by the guards) or with `skipVerificationOnEnable` (off).
 */
const AGE_KEEPING_PATHS = new Set([
  ...SESSION_REPLACING_PATHS,
  ...CODE_PATHS,
  '/two-factor/enable',
]);

/**
 * Copies a session's second step, as it was, to the session that takes its
 * place: the same confirmation, which opens no new window for changing
 * sign-in methods.
 *
 * @param previous - The session being replaced.
 * @returns The new session's MFA facts.
 */
function keptConfirmation(previous: SessionMfaInput) {
  const kept = sessionMfaOf(previous);
  return { ...kept, mfaVerifiedAt: kept.mfaVerifiedAt ? new Date(kept.mfaVerifiedAt) : null };
}

/** A session's age, as stored or as Better Auth passes it to hooks. */
interface SessionAge {
  /** When it signed in (Better Auth may pass it as a string). */
  createdAt?: Date | string | null;
  /** When it ends. */
  expiresAt?: Date | string | null;
}

/**
 * Copies a session's age to the session that takes its place: its sign-in
 * time (`createdAt`, which the one-hour rule reads as `signedInAt`) and its
 * end (`expiresAt`), so replacing a session never renews it. Better Auth
 * merges what the hook returns over the new session's own (fresh) times. The
 * cookie it sets for the new session still lasts the full 7 days
 * (`setSessionCookie`); outliving its row is harmless, since the row decides.
 * A time the old session doesn't hand over (it always does) leaves Better
 * Auth's.
 *
 * @param previous - The session being replaced.
 * @returns The new session's `createdAt` and `expiresAt`.
 */
function keptAge(previous: SessionAge): { createdAt?: Date; expiresAt?: Date } {
  return {
    ...(previous.createdAt && { createdAt: new Date(previous.createdAt) }),
    ...(previous.expiresAt && { expiresAt: new Date(previous.expiresAt) }),
  };
}

/**
 * Finds the session a re-verify confirms, when the browser still has it:
 * the request's session ({@link ownSession}) is the one the re-verify was
 * started from. Not when the browser has another session (or none), or that
 * one expired meanwhile.
 *
 * @param ctx - The endpoint context.
 * @param marker - The re-verify.
 * @returns The session's MFA facts, or `null`.
 */
async function reverifiedSession(ctx: AuthHookContext | null, marker: ReverifyMarker) {
  const own = await ownSession(ctx, marker.userId);
  return own?.id === marker.sessionId ? own : null;
}

/**
 * Before a session is created: refuses deactivated accounts (for a provider
 * sign-in, {@link checkIncomingUser} refused them earlier, before anything
 * was connected or stored; this is the check for every other sign-in, and the
 * backstop for that one), and records
 * whether (and how, and when: `mfaVerifiedAt`, which starts the 15 minutes
 * for changing sign-in methods) the sign-in had a second factor. A session
 * that replaces the signed-in one for the same sign-in
 * ({@link SESSION_REPLACING_PATHS}) keeps its facts. Such a session, and one
 * a code that turns two-step verification on replaces
 * ({@link AGE_KEEPING_PATHS}), also keeps the old one's sign-in time and end
 * ({@link keptAge}), so a replacement never renews a session or makes it pass
 * for a recent sign-in; only from a session of the same user.
 *
 * A code step with a session already open means Better Auth just turned two-step
 * verification on and is replacing the session. That only counts as verified
 * when the old session was, or the account had no MFA before this step;
 * otherwise turning on email codes would get past a passkey. The method is
 * stored as it was; whether it counts is decided when the session is read,
 * with the MFA role then (an email code never counts for a role that requires
 * MFA).
 *
 * A re-verify's session ("Confirm with GitHub" on the step-up page) is only
 * ever for the user who started it: {@link checkReverify} refuses any other
 * account before, and this refuses it again as a backstop, before anything
 * about that other user (e.g. that they're deactivated) is told. It replaces
 * the browser's session, whose confirmation it keeps as it was
 * ({@link reverifiedSession}, {@link keptConfirmation}) until the provider's
 * 2FA confirms it afresh (`markSessionVerified`): an attempt that doesn't
 * count (2FA off, the provider unreachable) takes nothing away, and opens no
 * new window for changing sign-in methods either.
 *
 * @param data - The session about to be created.
 * @param ctx - The endpoint that's creating it.
 * @returns The session data with its MFA level.
 * @throws {APIError} `FORBIDDEN` with code `REVERIFY_WRONG_ACCOUNT` for a
 *   re-verify's session for another user, and with code `ACCOUNT_DEACTIVATED`
 *   for deactivated accounts.
 */
export async function beforeSessionCreate(
  data: SessionData & Record<string, unknown>,
  ctx: AuthHookContext | null,
): Promise<{ data: SessionData & Record<string, unknown> }> {
  const reverify = await currentReverify();
  if (reverify && reverify.userId !== data.userId) {
    noteRefusedReverify(ctx, reverify, ctx?.params?.id);
    throw new APIError('FORBIDDEN', { ...REVERIFY_WRONG_ACCOUNT });
  }
  const [found] = await db
    .select({ deactivatedAt: user.deactivatedAt })
    .from(user)
    .where(eq(user.id, data.userId));
  if (found?.deactivatedAt) {
    throw new APIError('FORBIDDEN', { ...ACCOUNT_DEACTIVATED });
  }
  // A re-verify replaces the session it confirms: until the provider's 2FA confirms the new one
  // (after the request), it keeps the old one's confirmation as it was.
  const reverified = reverify ? await reverifiedSession(ctx, reverify) : null;
  if (reverified) {
    return { data: { ...data, ...keptConfirmation(reverified) } };
  }
  const signedIn = ctx?.context.session;
  const previous = signedIn?.session;
  // Only a session of the same user is replaced for the same sign-in (Better Auth never replaces
  // another user's on these endpoints, but nothing of one user's session may carry over to another).
  const ownPrevious = signedIn?.user.id === data.userId ? previous : undefined;
  // A replacement keeps the old session's sign-in time and end, so it renews nothing.
  const age =
    ownPrevious && ctx?.path && AGE_KEEPING_PATHS.has(ctx.path) ? keptAge(ownPrevious) : {};
  // Better Auth replaces the session when two-step verification is turned off or the password is
  // changed; the new one is the same sign-in, so it keeps the old one's confirmation.
  if (ownPrevious && ctx?.path && SESSION_REPLACING_PATHS.has(ctx.path)) {
    return { data: { ...data, ...keptConfirmation(ownPrevious), ...age } };
  }
  let method = mfaMethodFromPath(ctx?.path);
  // Which MFA rules apply only matters when the sign-in had a second step.
  const mfa = method ? await loadMfaContext(db, data.userId) : null;
  const mfaRole = mfa?.mfaRole ?? null;
  const previousVerified =
    previous !== undefined &&
    isSessionMfaVerified(
      { mfaVerified: previous.mfaVerified ?? false, mfaMethod: previous.mfaMethod ?? null },
      mfaRole,
    );
  if (method && previous && !previousVerified) {
    const hadMfa =
      mfa !== null &&
      hasMfa(
        { ...mfa.state, twoFactorEnabled: false, authenticator: false },
        mfaRole,
        availableProviders,
      );
    if (hadMfa) {
      method = null;
    }
  }
  // The method is stored as it was; whether it counts is decided when it's read, with the MFA
  // role at that time (`isSessionMfaVerified`), e.g. an email code doesn't for a company Admin.
  return {
    data: {
      ...data,
      mfaVerified: method !== null,
      mfaMethod: method,
      mfaVerifiedAt: method !== null ? new Date() : null,
      ...age,
    },
  };
}

/**
 * Records what a new session's user did in the audit log, with the IP
 * address and browser the session was created from.
 *
 * @param created - The new session.
 * @param action - What happened: a sign-in, or a step-up that replaced the session.
 * @param method - How: the sign-in method, or the second step.
 */
async function recordSessionEvent(
  created: SessionData,
  action: 'sign_in' | 'mfa_verified',
  method: SignInMethod,
): Promise<void> {
  await recordEvent(
    withRequestInfo({ ip: created.ipAddress ?? null, userAgent: created.userAgent ?? null }),
    {
      action,
      actorUserId: created.userId,
      targetUserId: created.userId,
      details: { method },
    },
  );
}

/**
 * Records a sign-in in the audit log (see {@link recordSessionEvent}).
 *
 * @param created - The new session.
 * @param method - How the user signed in.
 */
export async function recordSignIn(created: SessionData, method: SignInMethod): Promise<void> {
  await recordSessionEvent(created, 'sign_in', method);
}

/**
 * Checks whether a new session may be a step-up with a provider that can
 * prove MFA: its sign-in was marked as a re-verify of this user's session
 * (`markReverify`, the server-side marker in the OAuth state; a plain
 * sign-in with the provider never is, even on a signed-in browser), and the
 * browser still has that session (Better Auth's callback doesn't read it, so
 * it's told from the request's signed session cookie). The account is the
 * user's own confirmed one: {@link checkReverify} refused any other.
 *
 * @param created - The new session.
 * @param ctx - The endpoint that created it.
 * @returns The facts to record it with later, or `null` when it's recorded now.
 */
async function providerStepUpOf(
  created: SessionData,
  ctx: AuthHookContext | null,
): Promise<PendingProviderStepUp | null> {
  if (!ctx) {
    return null;
  }
  const { path } = ctx;
  const providerId = ctx.params?.id;
  if (!path?.startsWith('/callback/') || !isMfaProvider(providerId)) {
    return null;
  }
  const reverify = await currentReverify();
  if (reverify?.userId !== created.userId || !(await hasReverifySession(ctx, reverify))) {
    return null;
  }
  return { created, path, providerId };
}

/**
 * After a session is created: records the sign-in and that the user is
 * active. Not for a password sign-in (`/sign-in/email`): its session may
 * still be deleted for the code step, so {@link afterPasswordSignIn} records
 * it once that's decided. Nor is a second step proven with a session a
 * sign-in (see `signInMethodFromPath`), though the user is active: a code
 * that turns on two-step verification records nothing here, and a passkey on
 * the step-up page records `mfa_verified`, like a code step-up. Better Auth
 * doesn't read the session on the passkey endpoint, so a step-up is told
 * from the request's signed session cookie ({@link ownSession}); this runs
 * before {@link replacePreviousSession} ends that session.
 *
 * A re-verify with a provider that can prove MFA ("Confirm with GitHub" on
 * the step-up page, {@link providerStepUpOf}) records nothing yet: whether
 * the provider confirmed the session is only known after
 * {@link afterAuthRequest} asked it, which records the session then
 * ({@link recordProviderSession}).
 *
 * @param created - The new session.
 * @param ctx - The endpoint that created it.
 */
export async function afterSessionCreate(
  created: SessionData,
  ctx: AuthHookContext | null,
): Promise<void> {
  if (ctx?.path === '/sign-in/email') {
    return;
  }
  await safely('record sign-in', async () => {
    await db.update(user).set({ lastActiveAt: new Date() }).where(eq(user.id, created.userId));
    const providerStepUp = await providerStepUpOf(created, ctx);
    if (providerStepUp && ctx) {
      requestState(ctx.context).pendingProviderStepUp = providerStepUp;
      return;
    }
    const passkeyStepUp =
      ctx?.path === '/passkey/verify-authentication' &&
      (await ownSession(ctx, created.userId)) !== null;
    const method = signInMethodFromPath(ctx?.path, {
      providerId: ctx?.params?.id,
      signedIn: Boolean(ctx?.context.session) || passkeyStepUp,
    });
    if (method) {
      await recordSignIn(created, method);
    } else if (passkeyStepUp) {
      await recordSessionEvent(created, 'mfa_verified', 'passkey');
    }
  });
}

/** What the provider check in {@link afterAuthRequest} decided, for {@link recordProviderSession}. */
export interface ProviderCheckResult {
  /** The session the provider's 2FA confirmed in this request, if any (see `markSessionVerified`). */
  confirmedSessionId: string | null;
  /**
   * Why it didn't confirm the session ({@link stepUpOutcomeOf}). It starts as
   * `unchecked`, so a check that never ran (a failed request) or failed
   * counts as one that couldn't be made.
   */
  outcome: ProviderStepUpOutcome;
}

/**
 * Records the session a provider callback left for later
 * ({@link afterSessionCreate}), once: as `mfa_verified` when the provider
 * confirmed it with the account's two-factor authentication, like a passkey
 * step-up, and otherwise as a sign-in with the provider (2FA off, the
 * provider unreachable), since a session really was created with it. Never
 * as a failed step-up: an outage isn't a wrong code. (A re-verify with
 * another account than the user's own confirmed one creates no session: it's
 * recorded as a failed confirmation, {@link checkReverify}.)
 *
 * The page the user lands on says why it didn't count: this sets
 * {@link PROVIDER_STEP_UP_COOKIE} to the outcome (read by
 * `ProviderStepUpNotice`, wherever that is), and removes an earlier
 * attempt's when the provider confirmed the session. First, so a failure to
 * record the event doesn't keep the user from being told. An attempt that
 * didn't count leaves the session's earlier confirmation as it was
 * ({@link beforeSessionCreate}), so the notice never has to say one ended.
 *
 * @param ctx - The endpoint context, after the request.
 * @param check - What the provider check decided.
 */
export async function recordProviderSession(
  ctx: AuthHookContext,
  check: ProviderCheckResult,
): Promise<void> {
  const pending = takeRequestState(ctx.context, 'pendingProviderStepUp');
  if (!pending) {
    return;
  }
  const { created, path, providerId } = pending;
  const providerMfa = created.id !== undefined && created.id === check.confirmedSessionId;
  if (!providerMfa) {
    setNextPageCookie(
      ctx,
      PROVIDER_STEP_UP_COOKIE,
      providerStepUpCookieValue(providerId, check.outcome),
    );
  } else {
    expireCookieIfSent(ctx, PROVIDER_STEP_UP_COOKIE);
  }
  const method = signInMethodFromPath(path, { providerId, signedIn: true, providerMfa });
  if (method) {
    await recordSignIn(created, method);
  } else {
    await recordSessionEvent(created, 'mfa_verified', providerId);
  }
}
