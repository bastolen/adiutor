/**
 * @file The acting user: who they are and which roles they have where.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { company, membership, user } from '@/db/schema';
import {
  canConfirmSessions,
  hasMfa,
  isSessionMfaVerified,
  mfaConfirmedUntil,
  type MfaRole,
  mfaRoleOf,
  type MfaState,
  requiresMfa,
  type SessionMfaInput,
  sessionMfaOf,
} from '@/lib/authz/mfa';
import { COMPANY_ADMIN_ROLE, type CompanyRole, type PlatformRole } from '@/lib/authz/roles';
import { availableProviders } from '@/lib/sign-in/providers';

import { loadMfaStates } from './auth/mfa-state';

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
   * Until when the current session may change how the user signs in (15
   * minutes after its last confirmation with a second step that counts; with
   * a provider such as GitHub only when the account has no passkey or
   * authenticator app), or `null` (see `mfaConfirmedUntil`).
   */
  mfaConfirmedUntil: Date | null;
  /**
   * When the current session signed in (`session.createdAt`), or `null`
   * outside a request (see `needsFreshSignIn`).
   */
  signedInAt: Date | null;
  /** The current session's ID, or `null` outside a request. */
  sessionId: string | null;
  /** When the account was deactivated, or `null` while it's active. */
  deactivatedAt: Date | null;
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
    // A provider's confirmation is judged by the setup (`hasStrongerStepThanProvider`); without one
    // there's no second step to have confirmed with.
    mfaConfirmedUntil: mfaState ? mfaConfirmedUntil(sessionMfa, mfaRole, mfaState) : null,
    signedInAt: session.createdAt ? new Date(session.createdAt) : null,
    sessionId: session.id ?? null,
  };
}

/**
 * Records that a user was active now, at most once a minute: the update only
 * matches when the last recorded activity is older, so busy users don't cause
 * a write per request. Pages run it after the response (`getOptionalActor`),
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
