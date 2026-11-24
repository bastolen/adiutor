/**
 * @file The acting user: who they are and which roles they have where.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { company, membership, user } from '@/db/schema';
import {
  canConfirmSessions,
  hasMfa,
  hasStrongMfa,
  isSessionMfaVerified,
  signedInAtOf,
  mfaConfirmedUntil,
  type MfaRole,
  mfaRoleOf,
  type MfaState,
  requiresMfa,
  type SessionMfaInput,
  sessionMfaOf,
  strongMfaConfirmedUntil,
} from '@/lib/authz/mfa';
import type { Permission } from '@/lib/authz/permissions';
import { COMPANY_ADMIN_ROLE, type CompanyRole, type PlatformRole } from '@/lib/authz/roles';
import { isTimeZone } from '@/lib/i18n/time-zones';
import { availableProviders } from '@/lib/sign-in/providers';

import { loadMfaStates } from './auth/mfa-state';

/**
 * A staff member signed in as the user ("Sign in as", see
 * docs/decisions/0017-staff-sign-in-as-users.md): the session is the staff
 * member's, and the app acts as the user while it lasts, refusing changes
 * (`assertNotSignedInAs`).
 */
export interface SignedInAs {
  /** The staff member's user ID. */
  staffId: string;
  /** The staff member's name (or email address, without one). */
  staffName: string;
  /** When it ends by itself. */
  endsAt: Date;
  /** The page of the app the staff member goes back to afterwards. */
  returnTo: string;
  /**
   * The staff member's own global permissions, so the user's account pages
   * show only what the staff member sees on the user's page
   * (`personalDataShown`).
   */
  staffPermissions: Permission[];
}

/**
 * A signed-in user with their roles. Plain data, so it can be passed to
 * Client Components.
 */
export interface Actor {
  /** User ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Email address. */
  email: string;
  /**
   * Whether the email address is verified (by its link, a password reset, or
   * a GitHub or Google sign-in with the same verified address).
   */
  emailVerified: boolean;
  /** Their staff role (staff), or `null` for company users. */
  platformRole: PlatformRole | null;
  /** Role per company ID, for every company the user belongs to. */
  memberships: Record<string, CompanyRole>;
  /**
   * Whether their account is protected with MFA (an authenticator app, a
   * passkey, provider MFA, or email codes except for roles that require MFA).
   */
  mfaEnabled: boolean;
  /**
   * Which MFA rules apply to them: their staff role, or `company_admin` as
   * Admin of an active company (see `mfaRoleOf`).
   */
  mfaRole: MfaRole | null;
  /**
   * Their sign-in setup as the MFA rules see it, loaded with the actor (for
   * display, e.g. the Security page), or `null` if the user disappeared
   * meanwhile. A change that depends on it reads it again under its lock
   * (`withSignInChangeLock`), never from here.
   */
  mfaState: MfaState | null;
  /** Whether their role requires MFA before they can use the app. */
  mfaRequired: boolean;
  /**
   * Whether a session can be confirmed with a second step that can be used on
   * this server, even one that doesn't count as their MFA (see
   * `canConfirmSessions`).
   */
  canConfirmSessions: boolean;
  /**
   * Whether the current session had a second factor that counts for this
   * user (see `isSessionMfaVerified`).
   */
  sessionMfaVerified: boolean;
  /**
   * Whether the link in an email about a request started the current session
   * (decision 0036): it isn't sent to the step-up page (`mustStepUp`), but it
   * never opens the window for changing sign-in methods or counts as a fresh
   * sign-in.
   */
  fromRequestLink: boolean;
  /**
   * Until when the current session may change how the user signs in (15
   * minutes after its last confirmation with a second step that counts; with
   * a provider such as GitHub only when the account has no passkey or
   * authenticator app), or `null` (see `mfaConfirmedUntil`).
   */
  mfaConfirmedUntil: Date | null;
  /**
   * Whether their account has strong MFA whatever their role (an
   * authenticator app, a passkey or provider MFA, never email codes; see
   * `hasStrongMfa`), which signing in as someone else needs.
   */
  strongMfa: boolean;
  /**
   * Until when the current session counts as recently confirmed with a strong
   * second step whatever their role (see `strongMfaConfirmedUntil`), or
   * `null`: signing in as someone else needs it.
   */
  strongMfaConfirmedUntil: Date | null;
  /**
   * When the current session signed in (`session.createdAt`), or `null`
   * outside a request and for a session the link in an email about a request
   * started, which never counts as a fresh sign-in (see `needsFreshSignIn`,
   * `signedInAtOf`).
   */
  signedInAt: Date | null;
  /**
   * The current session's ID, or `null` outside a request and while a staff
   * member is signed in as the user (the session is theirs, not the user's).
   */
  sessionId: string | null;
  /** When the account was deactivated, or `null` while it's active. */
  deactivatedAt: Date | null;
  /**
   * Whether staff may sign in as the user (`user.allow_staff_sign_in`): on
   * unless they turned it off on their Security page.
   */
  allowStaffSignIn: boolean;
  /**
   * Their saved time zone (`user.time_zone`), e.g. `Europe/Amsterdam`, or
   * `null` until their browser saved one on their first visit. Pages read the
   * reader's zone from next-intl instead (the cookie that mirrors this); this
   * is for services, such as an invitation keeping its sender's zone.
   */
  timeZone: string | null;
  /**
   * The staff member signed in as this user in the current session, or
   * `null` when the user signed in themselves. While it's set, every change
   * is refused (`assertNotSignedInAs`), and the session facts above
   * (`sessionMfaVerified`, `mfaConfirmedUntil`, `signedInAt`, `sessionId`)
   * are empty: the session isn't the user's.
   */
  signedInAs: SignedInAs | null;
}

/**
 * Loads a user, their roles and their MFA state. Every page and server action
 * loads the signed-in user this way, so its queries (which need only the user
 * ID) run at once rather than one after another. That's why it takes the pool
 * and never a transaction, which can't run several queries at once.
 *
 * @param db - Database client (the pool, not a transaction).
 * @param userId - The user's ID.
 * @param session - The current session, if any.
 * @param session.id - Its ID.
 * @param session.mfaVerified - Whether its sign-in, or a later step-up, had a second factor.
 * @param session.mfaMethod - Which second factor, if known.
 * @param session.mfaVerifiedAt - When it was proven, if known.
 * @param session.fromRequestLink - Whether the link in an email about a request started it.
 * @param session.createdAt - When it signed in, if known.
 * @returns The actor, or `null` if the user doesn't exist.
 */
export async function loadActor(
  db: Database,
  userId: string,
  session: SessionMfaInput & {
    id?: string;
    createdAt?: Date | string | null;
  } = {},
): Promise<Actor | null> {
  const [[found], mfaStates, rows] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        deactivatedAt: user.deactivatedAt,
        platformRole: user.platformRole,
        allowStaffSignIn: user.allowStaffSignIn,
        timeZone: user.timeZone,
      })
      .from(user)
      .where(eq(user.id, userId)),
    loadMfaStates(db, [userId]),
    db
      .select({
        companyId: membership.companyId,
        role: membership.role,
        deactivatedAt: company.deactivatedAt,
      })
      .from(membership)
      .innerJoin(company, eq(company.id, membership.companyId))
      .where(eq(membership.userId, userId)),
  ]);
  if (!found) {
    return null;
  }
  const mfaState = mfaStates.get(userId) ?? null;

  const platformRole = found.platformRole ?? null;
  const adminOfActiveCompany = rows.some(
    (row) => row.role === COMPANY_ADMIN_ROLE && row.deactivatedAt === null,
  );
  const mfaRole = mfaRoleOf(platformRole, adminOfActiveCompany);
  const sessionMfa = sessionMfaOf(session);
  return {
    ...found,
    // Only a zone the runtime still knows (one can be renamed or dropped from its data).
    timeZone: isTimeZone(found.timeZone) ? found.timeZone : null,
    platformRole,
    memberships: Object.fromEntries(rows.map((row) => [row.companyId, row.role])),
    mfaRole,
    mfaState,
    mfaEnabled: mfaState ? hasMfa(mfaState, mfaRole, availableProviders) : false,
    mfaRequired: requiresMfa(mfaRole),
    canConfirmSessions: mfaState
      ? canConfirmSessions(mfaState, mfaRole, availableProviders)
      : false,
    sessionMfaVerified: isSessionMfaVerified(sessionMfa, mfaRole),
    fromRequestLink: sessionMfa.fromRequestLink,
    // A provider's confirmation is judged by the setup (`hasStrongerStepThanProvider`); without one
    // there's no second step to have confirmed with.
    mfaConfirmedUntil: mfaState ? mfaConfirmedUntil(sessionMfa, mfaRole, mfaState) : null,
    strongMfa: mfaState ? hasStrongMfa(mfaState, availableProviders) : false,
    strongMfaConfirmedUntil: mfaState ? strongMfaConfirmedUntil(sessionMfa, mfaState) : null,
    signedInAt: signedInAtOf({ ...session, fromRequestLink: sessionMfa.fromRequestLink }),
    sessionId: session.id ?? null,
    // Set by `getOptionalActor` when the session belongs to a staff member signed in as the user.
    signedInAs: null,
  };
}

/**
 * Records that a user was active now, at most once a minute: the update only
 * matches when the last recorded activity is older, so busy users don't cause
 * a write per request. Pages start it in the background (`getOptionalActor`),
 * so they never wait on it or on a lock on the user's row.
 *
 * @param db - Database client.
 * @param userId - The user's ID.
 */
export async function touchLastActive(db: Database, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ lastActiveAt: sql`now()` })
    .where(
      and(
        eq(user.id, userId),
        or(isNull(user.lastActiveAt), lt(user.lastActiveAt, sql`now() - interval '1 minute'`)),
      ),
    );
}
