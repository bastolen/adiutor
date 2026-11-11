/**
 * @file The fixtures shared by the integration tests of user administration:
 * the test database context, a staff Admin (`admin`), a company Client
 * (`jane`) and the company (`testCompany`), created again before each test,
 * and helpers to sign in as a user, read the audit log and create sessions.
 */
import { eq } from 'drizzle-orm';
import { beforeEach } from 'vitest';

import { auditEvent, session, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  addMember,
  createCompany,
  createSession,
  createStaffSettings,
  createUser,
  enableTwoFactor,
  minutesAgo,
  setupTestContext,
  staffActor,
} from '../../../../tests/integration/helpers';
import { type Actor, loadActor } from '../../actor';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks.
 */
export const { ctx, db, sent } = setupTestContext();

/** The company the tests' users belong to. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let testCompany: Awaited<ReturnType<typeof createCompany>>;
/** The staff Admin who acts in the tests. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let admin: Actor;
/** The ID of the Client of {@link testCompany} the Admin acts on. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let jane: string;

beforeEach(async () => {
  await createStaffSettings(db);
  testCompany = await createCompany(db, { name: 'Adiutor Tests Client' });
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
  jane = await createUser(db, 'jane@adiutor.test');
  await addMember(db, testCompany.id, jane, 'client');
});

/**
 * Lists the audit actions recorded about a user.
 *
 * @param userId - The user.
 * @returns The actions, oldest first.
 */
export async function actionsAbout(userId: string) {
  const rows = await db
    .select({ action: auditEvent.action })
    .from(auditEvent)
    .where(eq(auditEvent.targetUserId, userId))
    .orderBy(auditEvent.at);
  return rows.map(({ action }) => action);
}

/**
 * Loads a user as the actor of their own session.
 *
 * @param userId - The user.
 * @param session - The session.
 * @param session.signedInAt - When it signed in; defaults to now.
 * @param session.confirmedAt - When it was confirmed with the authenticator app, if it was.
 * @returns The actor.
 */
export async function signedIn(
  userId: string,
  {
    signedInAt = new Date(),
    confirmedAt = null,
  }: { signedInAt?: Date | null; confirmedAt?: Date | null } = {},
): Promise<Actor> {
  const actor = await loadActor(db, userId, {
    id: 'adiutor-tests-session',
    mfaVerified: confirmedAt !== null,
    mfaMethod: confirmedAt ? 'authenticator' : null,
    mfaVerifiedAt: confirmedAt,
    createdAt: signedInAt,
  });
  if (!actor) {
    throw new Error(`No user ${userId}`);
  }
  return actor;
}

/** A time a number of minutes ago (shared with the other integration tests). */
export { minutesAgo };

/** A request from a known browser and IP address, for the security emails' device line. */
export const fromKnownDevice = {
  ...ctx,
  /**
   * Pretends the request came from Firefox on Windows at a known IP address.
   *
   * @returns The request info.
   */
  requestInfo: async () => ({
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  }),
};

/**
 * The staff Admin with an authenticator app (as their role requires), signed
 * in on a session confirmed with it at a given time.
 *
 * @param confirmedAt - When the session was confirmed; defaults to now (recently enough for an
 *   MFA reset), `null` for never.
 * @returns The Admin as the actor.
 */
export async function adminConfirmedAt(confirmedAt: Date | null = new Date()): Promise<Actor> {
  const found = firstRow(
    await db
      .select({ twoFactorEnabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, admin.id)),
    'the Admin',
  );
  if (!found.twoFactorEnabled) {
    await enableTwoFactor(db, admin.id);
  }
  return signedIn(admin.id, { confirmedAt });
}

/**
 * Creates sessions for a user that signed in on consecutive days of January 2026, so they sort in
 * a known order (created in one go, they'd all have the time of the test).
 *
 * @param userId - The user.
 * @param count - How many; the first signed in on January 1, each next one a day later.
 * @returns Their IDs, the oldest first. Their browsers are 'Browser 01', 'Browser 02' and so on.
 */
export async function createSessionsOnJanuaryDays(
  userId: string,
  count: number,
): Promise<string[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const id = await createSession(db, userId, {
        userAgent: `Browser ${String(index + 1).padStart(2, '0')}`,
      });
      await db
        .update(session)
        .set({ createdAt: new Date(Date.UTC(2026, 0, index + 1)) })
        .where(eq(session.id, id));
      return id;
    }),
  );
}
