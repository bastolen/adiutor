/**
 * @file The signed-in devices of a user (their sessions that haven't
 * expired), as the user detail page and the Security page list them: one page
 * at a time, with each session judged against the MFA rules of the user's role
 * now.
 */
import { and, eq, gt, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { session } from '@/db/schema';
import { isSessionMfaVerified, type MfaRole } from '@/lib/authz/mfa';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { DEVICES_TABLE, type DeviceSort } from '@/lib/tables/tables';

import { orderTerms, paginate } from '../../pagination';

/** A signed-in device, on the detail page and the Security page. */
export interface UserSession {
  /** Session ID. */
  id: string;
  /** The browser's user agent, if known. */
  userAgent: string | null;
  /** IP address it signed in from, if known. */
  ipAddress: string | null;
  /** When it signed in. */
  createdAt: Date;
  /**
   * When the session row last changed, e.g. when a second step was confirmed
   * (sessions aren't extended while used: `disableSessionRefresh` in
   * `src/lib/auth.ts`).
   */
  updatedAt: Date;
  /** When it expires. */
  expiresAt: Date;
  /** Whether its sign-in was MFA verified (shown as "MFA Verified"). */
  mfaVerified: boolean;
}

/** A session row as stored, before it's judged against the MFA rules (see {@link asSeenWith}). */
export type StoredSession = Omit<UserSession, 'mfaVerified'> & {
  /** Whether a second step was recorded for it. */
  mfaVerified: boolean | null;
  /** How that second step was taken, if recorded. */
  mfaMethod: string | null;
};

/**
 * Loads a page of a user's sessions that haven't expired, as stored.
 *
 * @param db - Database client.
 * @param userId - The user.
 * @param options - Sort and page (by default most recently signed in first, the first page).
 * @returns The page of sessions.
 */
export async function loadSessionRows(
  db: Database,
  userId: string,
  options: Partial<TableState<DeviceSort>>,
): Promise<Paged<StoredSession>> {
  const state = resolveTableState(DEVICES_TABLE, options);
  const where = and(eq(session.userId, userId), gt(session.expiresAt, sql`now()`));
  return paginate(
    state,
    () => db.$count(session, where),
    (limit, offset) =>
      db
        .select({
          id: session.id,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          mfaVerified: session.mfaVerified,
          mfaMethod: session.mfaMethod,
        })
        .from(session)
        .where(where)
        .orderBy(...orderTerms(state.dir, session.createdAt, session.id))
        .limit(limit)
        .offset(offset),
  );
}

/**
 * Decides which sessions count as MFA verified for the user's MFA role now
 * (e.g. an email code doesn't count for a company Admin, but does once
 * they're a Client again).
 *
 * @param rows - The page of sessions as stored.
 * @param mfaRole - The user's MFA role, read in this request.
 * @returns The page as the user detail and Security pages show it.
 */
export function asSeenWith(
  rows: Paged<StoredSession>,
  mfaRole: MfaRole | null,
): Paged<UserSession> {
  return {
    ...rows,
    items: rows.items.map(({ mfaMethod, ...row }) => ({
      ...row,
      mfaVerified: isSessionMfaVerified(
        { mfaVerified: row.mfaVerified ?? false, mfaMethod },
        mfaRole,
      ),
    })),
  };
}

/**
 * Lists a user's signed-in devices (their sessions that haven't expired),
 * one page at a time. Callers check who may see them, and pass the user's
 * MFA role, which decides which sessions count as MFA verified: read in the
 * same request (e.g. `actor.mfaRole` for the signed-in user).
 *
 * @param db - Database client.
 * @param userId - The user.
 * @param mfaRole - The user's MFA role now (see `mfaRoleOf`).
 * @param options - Sort and page (by default most recently signed in first, the first page).
 * @returns The page of sessions.
 */
export async function listUserSessions(
  db: Database,
  userId: string,
  mfaRole: MfaRole | null,
  options: Partial<TableState<DeviceSort>> = {},
): Promise<Paged<UserSession>> {
  return asSeenWith(await loadSessionRows(db, userId, options), mfaRole);
}
