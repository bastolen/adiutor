/**
 * @file Loads what the MFA rules in `src/lib/authz/mfa/` need: users'
 * sign-in setup (two-step verification and whether it has an authenticator
 * app, passkeys, password and provider accounts) and which rules apply to
 * them (their staff role, or Admin of an active company), in a fixed number of
 * queries for any number of users.
 */
import { and, count, eq, inArray, isNull } from 'drizzle-orm';

import type { Database, DatabaseOrTransaction } from '@/db';
import { account, company, membership, passkey, twoFactor, user } from '@/db/schema';
import { type MfaRole, mfaRoleOf, type MfaState } from '@/lib/authz/mfa';
import { COMPANY_ADMIN_ROLE, type PlatformRole } from '@/lib/authz/roles';

/** Users' sign-in setup, and their staff roles read in the same query. */
interface LoadedSetup {
  /** Their setup by user ID; users that don't exist are missing. */
  states: Map<string, MfaState>;
  /** Their staff role by user ID (`null` for none), for {@link loadMfaContext}. */
  platformRoles: Map<string, PlatformRole | null>;
}

/**
 * Loads the sign-in setup of several users, reading each user's row once
 * (with their staff role).
 *
 * @param db - Database client.
 * @param userIds - The users (at least one).
 * @returns Their setup and staff roles.
 */
async function loadSetup(db: Database, userIds: readonly string[]): Promise<LoadedSetup> {
  const ids = [...userIds];
  const [users, passkeys, accounts, authenticators] = await Promise.all([
    db
      .select({
        id: user.id,
        twoFactorEnabled: user.twoFactorEnabled,
        platformRole: user.platformRole,
      })
      .from(user)
      .where(inArray(user.id, ids)),
    db
      .select({ userId: passkey.userId, total: count() })
      .from(passkey)
      .where(inArray(passkey.userId, ids))
      .groupBy(passkey.userId),
    db
      .select({
        id: account.id,
        userId: account.userId,
        providerId: account.providerId,
        password: account.password,
        mfaVerified: account.mfaVerified,
        confirmed: account.confirmed,
      })
      .from(account)
      .where(inArray(account.userId, ids)),
    db
      .select({ userId: twoFactor.userId, verified: twoFactor.verified })
      .from(twoFactor)
      .where(inArray(twoFactor.userId, ids)),
  ]);

  const states = new Map(
    users.map((found) => {
      const own = accounts.filter((row) => row.userId === found.id);
      return [
        found.id,
        {
          twoFactorEnabled: found.twoFactorEnabled ?? false,
          // A row with an unverified secret is an authenticator setup that was never finished.
          authenticator:
            (found.twoFactorEnabled ?? false) &&
            authenticators.some((row) => row.userId === found.id && row.verified !== false),
          passkeyCount: passkeys.find((row) => row.userId === found.id)?.total ?? 0,
          hasPassword: own.some((row) => row.providerId === 'credential' && Boolean(row.password)),
          // A provider account connected at sign-in and not confirmed yet doesn't count either way.
          providerAccounts: own
            .filter((row) => row.providerId !== 'credential' && row.confirmed !== false)
            .map((row) => ({
              id: row.id,
              providerId: row.providerId,
              mfaVerified: row.mfaVerified ?? false,
            })),
        },
      ];
    }),
  );
  return {
    states,
    platformRoles: new Map(users.map((found) => [found.id, found.platformRole ?? null])),
  };
}

/**
 * Loads the sign-in setup of several users.
 *
 * @param db - Database client.
 * @param userIds - The users.
 * @returns Their setup by user ID; users that don't exist are missing.
 */
export async function loadMfaStates(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, MfaState>> {
  if (userIds.length === 0) {
    return new Map();
  }
  return (await loadSetup(db, userIds)).states;
}

/**
 * Finds which of these users are Admin of an active (not deactivated)
 * company, for {@link mfaRoleOf}.
 *
 * @param db - Database client.
 * @param userIds - The users.
 * @returns The IDs of those who are.
 */
export async function loadActiveCompanyAdminIds(
  db: DatabaseOrTransaction,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectDistinct({ userId: membership.userId })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(
      and(
        inArray(membership.userId, [...userIds]),
        eq(membership.role, COMPANY_ADMIN_ROLE),
        isNull(company.deactivatedAt),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/**
 * Loads which MFA rules apply to several users ({@link mfaRoleOf}): their
 * staff role, or Admin of an active company.
 *
 * @param db - Database client or transaction (to see a change it just made).
 * @param userIds - The users.
 * @returns Their MFA role by user ID (`null` for none); users that don't exist are missing.
 */
export async function loadMfaRoles(
  db: DatabaseOrTransaction,
  userIds: readonly string[],
): Promise<Map<string, MfaRole | null>> {
  if (userIds.length === 0) {
    return new Map();
  }
  // One query at a time: `db` may be a transaction, whose one connection can't run them in parallel.
  const users = await db
    .select({ id: user.id, platformRole: user.platformRole })
    .from(user)
    .where(inArray(user.id, [...userIds]));
  const admins = await loadActiveCompanyAdminIds(db, userIds);
  return new Map(
    users.map((found) => [found.id, mfaRoleOf(found.platformRole ?? null, admins.has(found.id))]),
  );
}

/** What the MFA rules need about one user. */
export interface MfaContext {
  /** Which MFA rules apply to them (see `mfaRoleOf`), or `null`. */
  mfaRole: MfaRole | null;
  /** Their sign-in setup. */
  state: MfaState;
}

/**
 * Loads which MFA rules apply to a user and their sign-in setup.
 *
 * @param db - Database client.
 * @param userId - The user.
 * @returns Their MFA role and setup, or `null` for unknown users.
 */
export async function loadMfaContext(db: Database, userId: string): Promise<MfaContext | null> {
  const [{ states, platformRoles }, admins] = await Promise.all([
    loadSetup(db, [userId]),
    loadActiveCompanyAdminIds(db, [userId]),
  ]);
  const state = states.get(userId);
  if (!state) {
    return null;
  }
  return { mfaRole: mfaRoleOf(platformRoles.get(userId) ?? null, admins.has(userId)), state };
}
