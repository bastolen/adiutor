/**
 * @file Integration tests for user administration and self-deactivation
 * (a recent confirmation or sign-in, the last-Admin refusal before the
 * password, and the limit on wrong passwords), and for what happens to the
 * invitations of people who lose access, against the test database.
 */
import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  account,
  auditEvent,
  company,
  invitation,
  inviteLink,
  membership,
  passkey,
  rateLimitBucket,
  session,
  twoFactor,
  user,
  verification,
} from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import {
  MFA_VERIFICATION_REQUIRED,
  SESSION_NOT_FRESH,
  SIGN_IN_CHANGE_IN_PROGRESS,
} from '@/lib/sign-in/sign-in-refusals';
import type { Paged } from '@/lib/tables/table-state';

import {
  actorFor,
  addMember,
  atTheSameMoment,
  addPassword,
  connectGitHub,
  connectProvider,
  createCompany,
  createSession,
  createStaffSettings,
  createUser,
  enableTwoFactor,
  inSequence,
  setupTestContext,
  staffActor,
  tokenFrom,
  turnOffGitHubSignIn,
} from '../../../tests/integration/helpers';
import { type Actor, loadActor } from '../actor';
import { listOwnActivity, recordEvent } from '../audit';
import { acceptInvitationWithNewAccount, inviteByEmail } from './invitations';
import { createInviteLink } from './invite-links';
import {
  deactivateOwnAccount,
  deactivateUser,
  deleteUser,
  getUserDetail,
  listUserSessions,
  reactivateUser,
  resetUserMfa,
  signOutUserEverywhere,
  soleAdminOf,
  type UserDetailOptions,
  userExists,
  type UserSession,
} from './user-admin';
import { releaseSignInChangeLock, takeSignInChangeLock } from '../auth/sign-in-change-lock';

const { ctx, db, sent } = setupTestContext();

let testCompany: Awaited<ReturnType<typeof createCompany>>;
let admin: Actor;
let jane: string;

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
async function actionsAbout(userId: string) {
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
async function signedIn(
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

/**
 * A time a number of minutes ago.
 *
 * @param minutes - How long ago.
 * @returns The time.
 */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/** A request from a known browser and IP address, for the security emails' device line. */
const fromKnownDevice = {
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
async function adminConfirmedAt(confirmedAt: Date | null = new Date()): Promise<Actor> {
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

describe('getUserDetail', () => {
  it("doesn't count GitHub with 2FA as MFA while GitHub sign-in is off", async () => {
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, testCompany.id, owner, 'admin');
    await connectGitHub(db, owner);
    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'protected',
      required: true,
    });

    turnOffGitHubSignIn();

    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'required',
      required: true,
    });
  });

  it('shows companies, sessions and activity to Admins', async () => {
    await createSession(db, jane, { userAgent: 'Firefox' });
    await createSession(db, jane, { expiresAt: new Date(Date.now() - 1000) });

    const detail = await getUserDetail(ctx, admin, jane);

    expect(detail).toMatchObject({ email: 'jane@adiutor.test', deactivatedAt: null });
    expect(detail.companies).toMatchObject({ total: 1, page: 1 });
    expect(detail.companies.items).toEqual([
      expect.objectContaining({ id: testCompany.id, role: 'client' }),
    ]);
    // The expired session isn't counted either.
    expect(detail.sessions).toMatchObject({ total: 1 });
    expect(detail.sessions?.items).toHaveLength(1);
    expect(detail.mfa).toMatchObject({ status: 'optional', required: false });
    expect(detail.activity).toEqual([]);
  });

  it('hides activity and devices from staff without the rights', async () => {
    const support = await staffActor(db, 'support');
    await createSession(db, jane, { userAgent: 'Firefox' });
    await expect(getUserDetail(ctx, support, jane)).resolves.toMatchObject({
      activity: null,
      sessions: null,
    });
  });

  it('names provider accounts at their providers for staff Admins only', async () => {
    const named = await connectProvider(db, jane, { accountName: 'adiutor-tests' });
    const unnamed = await connectProvider(db, jane, { providerId: 'google' });

    expect((await getUserDetail(ctx, admin, jane)).accountNames).toEqual({
      [named]: 'adiutor-tests',
      [unnamed]: null,
    });
    const manager = await staffActor(db, 'manager');
    expect((await getUserDetail(ctx, manager, jane)).accountNames).toBeNull();
    const support = await staffActor(db, 'support');
    expect((await getUserDetail(ctx, support, jane)).accountNames).toBeNull();
  });

  it('counts their GitHub and Google accounts, confirmed or not, but not their password', async () => {
    expect((await getUserDetail(ctx, admin, jane)).connectedAccounts).toBe(0);

    await addPassword(db, jane);
    await connectProvider(db, jane);
    await connectProvider(db, jane, { providerId: 'google', confirmed: false });
    await connectProvider(db, admin.id);

    const detail = await getUserDetail(ctx, admin, jane);
    expect(detail.connectedAccounts).toBe(2);
    // The unconfirmed one doesn't count for MFA, so it isn't among the provider accounts there.
    expect(detail.mfa.providerAccounts).toHaveLength(1);
  });

  it('is not found for unknown or malformed IDs', async () => {
    await expect(getUserDetail(ctx, admin, 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('userExists', () => {
  it('finds users, deactivated ones too', async () => {
    await expect(userExists(ctx, admin, jane)).resolves.toBe(true);

    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, jane));
    await expect(userExists(ctx, admin, jane)).resolves.toBe(true);
  });

  it("doesn't find unknown IDs or what isn't an ID", async () => {
    await expect(userExists(ctx, admin, '01890a5d-ac96-774b-bcce-b302099a8057')).resolves.toBe(
      false,
    );
    await expect(userExists(ctx, admin, 'not-an-id')).resolves.toBe(false);
  });
});

describe('which sessions count as MFA verified', () => {
  /** Anna, the Admin of an active company, signed in by email code and by passkey. */
  let anna: string;

  beforeEach(async () => {
    anna = await createUser(db, 'anna@adiutor.test');
    await addMember(db, testCompany.id, anna, 'admin');
    const viaEmail = await createSession(db, anna, { userAgent: 'Firefox' });
    await db
      .update(session)
      .set({ mfaVerified: true, mfaMethod: 'email_code' })
      .where(eq(session.id, viaEmail));
    const viaPasskey = await createSession(db, anna, { userAgent: 'Safari' });
    await db
      .update(session)
      .set({ mfaVerified: true, mfaMethod: 'passkey' })
      .where(eq(session.id, viaPasskey));
  });

  /**
   * Maps sessions to whether each counts, by browser.
   *
   * @param sessions - The page of sessions.
   * @returns Whether each counts as MFA verified, by user agent.
   */
  const byBrowser = (sessions: Paged<UserSession> | null) =>
    Object.fromEntries(
      (sessions?.items ?? []).map((found) => [found.userAgent, found.mfaVerified]),
    );

  it('decides it with the MFA role listUserSessions is given', async () => {
    // An email code doesn't count for the Admin of an active company, but does without a role.
    expect(byBrowser(await listUserSessions(db, anna, 'company_admin'))).toEqual({
      Firefox: false,
      Safari: true,
    });
    expect(byBrowser(await listUserSessions(db, anna, null))).toEqual({
      Firefox: true,
      Safari: true,
    });
  });

  it('decides it with the user’s role now on the user detail page', async () => {
    expect(byBrowser((await getUserDetail(ctx, admin, anna)).sessions)).toEqual({
      Firefox: false,
      Safari: true,
    });

    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    expect(byBrowser((await getUserDetail(ctx, admin, anna)).sessions)).toEqual({
      Firefox: true,
      Safari: true,
    });
  });
});

describe('admin actions', () => {
  it('resets two-step verification and optionally passkeys, signs out and forgets trusted devices', async () => {
    await createSession(db, jane);
    await db.insert(verification).values([
      { identifier: 'trust-device-lost-phone', value: jane, expiresAt: new Date(Date.now() + 1e6) },
      {
        identifier: 'trust-device-someone-else',
        value: admin.id,
        expiresAt: new Date(Date.now() + 1e6),
      },
    ]);
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, jane));
    await db.insert(twoFactor).values({ userId: jane, secret: 'x', backupCodes: 'y' });
    await db.insert(passkey).values({
      userId: jane,
      publicKey: 'key',
      credentialID: 'credential',
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: true,
    });

    await resetUserMfa(ctx, await adminConfirmedAt(), jane, { removePasskeys: true });

    const found = firstRow(await db.select().from(user).where(eq(user.id, jane)), 'the user');
    expect(found.twoFactorEnabled).toBe(false);
    // Only hers: the Admin's own authenticator app stays.
    expect(await db.select({ userId: twoFactor.userId }).from(twoFactor)).toEqual([
      { userId: admin.id },
    ]);
    expect(await db.select().from(passkey)).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, jane))).toEqual([]);
    expect((await db.select().from(verification)).map((row) => row.identifier)).toEqual([
      'trust-device-someone-else',
    ]);
    expect(await actionsAbout(jane)).toEqual(['mfa_reset']);
    expect(sent.map((email) => email.subject)).toEqual([
      'Your Adiutor two-step verification was reset',
    ]);
  });

  /**
   * Lists a user's sign-in accounts by provider.
   *
   * @param userId - The user.
   * @returns Their accounts' providers, `credential` for the password, oldest first.
   */
  async function providersOf(userId: string): Promise<string[]> {
    const rows = await db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId))
      .orderBy(asc(account.createdAt), asc(account.id));
    return rows.map(({ providerId }) => providerId);
  }

  it('disconnects their GitHub and Google accounts, confirmed or not, and names the providers in the audit log', async () => {
    const john = await createUser(db, 'john@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    // Her own, and one that someone else connected when they signed in with her address.
    await connectProvider(db, jane);
    await connectProvider(db, jane, { mfaVerified: false });
    await connectProvider(db, jane, { providerId: 'google', confirmed: false });
    await connectProvider(db, john);

    await resetUserMfa(ctx, await adminConfirmedAt(), jane);

    expect(await providersOf(jane)).toEqual(['credential']);
    // Nobody else's.
    expect(await providersOf(john)).toEqual(['github']);
    const [event] = await db
      .select({ actorUserId: auditEvent.actorUserId, details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'mfa_reset'));
    expect(event).toEqual({
      actorUserId: admin.id,
      details: { removePasskeys: false, disconnectedProviders: ['github', 'google'] },
    });
    expect(sent.map((email) => email.subject)).toEqual([
      'Your Adiutor two-step verification was reset',
    ]);
  });

  it('records that it disconnected nothing when there was nothing to disconnect', async () => {
    await enableTwoFactor(db, jane);

    await resetUserMfa(ctx, await adminConfirmedAt(), jane);

    const event = firstRow(
      await db
        .select({ details: auditEvent.details })
        .from(auditEvent)
        .where(eq(auditEvent.action, 'mfa_reset')),
      'the audit event',
    );
    expect(event.details).toEqual({ removePasskeys: false, disconnectedProviders: [] });
  });

  it("needs the Admin's confirmation with their second step from the last 15 minutes", async () => {
    await enableTwoFactor(db, jane);
    await connectProvider(db, jane);
    await createSession(db, jane);

    // Not confirmed, or confirmed too long ago.
    await inSequence([null, minutesAgo(16)], async (confirmedAt) =>
      expect(resetUserMfa(ctx, await adminConfirmedAt(confirmedAt), jane)).rejects.toMatchObject({
        code: 'forbidden',
        message: MFA_VERIFICATION_REQUIRED.message,
      }),
    );

    // Nothing was reset, recorded or sent.
    const found = firstRow(
      await db
        .select({ twoFactorEnabled: user.twoFactorEnabled })
        .from(user)
        .where(eq(user.id, jane)),
      'the user',
    );
    expect(found.twoFactorEnabled).toBe(true);
    expect(await providersOf(jane)).toEqual(['github']);
    expect(await db.select().from(session).where(eq(session.userId, jane))).toHaveLength(1);
    expect(await actionsAbout(jane)).toEqual([]);
    expect(sent).toEqual([]);

    // Confirmed 14 minutes ago, it goes ahead.
    await resetUserMfa(ctx, await adminConfirmedAt(minutesAgo(14)), jane);
    expect(await providersOf(jane)).toEqual([]);
    expect(await actionsAbout(jane)).toEqual(['mfa_reset']);
  });

  it('gives a conflict while another change to how the user signs in holds their lock, and refuses yourself before taking it', async () => {
    await enableTwoFactor(db, jane);
    await connectProvider(db, jane);
    const actor = await adminConfirmedAt();
    const held = await takeSignInChangeLock({ db }, jane);

    await expect(resetUserMfa(ctx, actor, jane)).rejects.toMatchObject({
      code: 'conflict',
      message: SIGN_IN_CHANGE_IN_PROGRESS.message,
    });
    expect(await providersOf(jane)).toEqual(['github']);
    expect(await actionsAbout(jane)).toEqual([]);

    // Yourself is refused before the lock is even tried.
    const ownLock = await takeSignInChangeLock({ db }, admin.id);
    await expect(resetUserMfa(ctx, actor, admin.id)).rejects.toMatchObject({ code: 'invalid' });
    await releaseSignInChangeLock({ db }, defined(ownLock, 'the lock of the Admin'));

    // Once the other change is done, it goes ahead, and gives the lock back.
    await releaseSignInChangeLock({ db }, defined(held, 'the lock the other change holds'));
    await resetUserMfa(ctx, actor, jane);
    expect(await providersOf(jane)).toEqual([]);
    const again = await takeSignInChangeLock({ db }, jane);
    expect(again).not.toBeNull();
    await releaseSignInChangeLock({ db }, defined(again, 'the lock given back'));
  });

  it('signs a user out everywhere and forgets their trusted devices', async () => {
    await createSession(db, jane);
    await createSession(db, jane);
    await db.insert(verification).values([
      { identifier: 'trust-device-stolen', value: jane, expiresAt: new Date(Date.now() + 1e6) },
      {
        identifier: 'trust-device-someone-else',
        value: admin.id,
        expiresAt: new Date(Date.now() + 1e6),
      },
    ]);

    await signOutUserEverywhere(ctx, admin, jane);

    expect(await db.select().from(session).where(eq(session.userId, jane))).toEqual([]);
    expect((await db.select().from(verification)).map((row) => row.identifier)).toEqual([
      'trust-device-someone-else',
    ]);
    expect(await actionsAbout(jane)).toEqual(['sessions_revoked']);
  });

  it('deactivates (ending sessions and forgetting trusted devices) and reactivates an account', async () => {
    await createSession(db, jane);
    await db.insert(verification).values([
      { identifier: 'trust-device-stolen', value: jane, expiresAt: new Date(Date.now() + 1e6) },
      {
        identifier: 'trust-device-someone-else',
        value: admin.id,
        expiresAt: new Date(Date.now() + 1e6),
      },
    ]);

    await deactivateUser(ctx, admin, jane);
    const deactivated = firstRow(
      await db.select().from(user).where(eq(user.id, jane)),
      'the deactivated user',
    );
    expect(deactivated.deactivatedAt).toBeInstanceOf(Date);
    expect(await db.select().from(session).where(eq(session.userId, jane))).toEqual([]);
    // A stolen browser that was trusted can't skip the code step after a reactivation.
    expect((await db.select().from(verification)).map((row) => row.identifier)).toEqual([
      'trust-device-someone-else',
    ]);
    await expect(deactivateUser(ctx, admin, jane)).rejects.toMatchObject({ code: 'conflict' });

    await reactivateUser(ctx, admin, jane);
    const reactivated = firstRow(
      await db.select().from(user).where(eq(user.id, jane)),
      'the reactivated user',
    );
    expect(reactivated.deactivatedAt).toBeNull();
    expect(await actionsAbout(jane)).toEqual(['account_deactivated', 'account_reactivated']);
    expect(sent.map((email) => email.subject)).toEqual([
      'Your Adiutor account was deactivated',
      'Your Adiutor account was reactivated',
    ]);
  });

  it("never names the Admin's device or IP address in the user's security emails", async () => {
    await resetUserMfa(fromKnownDevice, await adminConfirmedAt(), jane);
    await signOutUserEverywhere(fromKnownDevice, admin, jane);
    await deactivateUser(fromKnownDevice, admin, jane);
    await reactivateUser(fromKnownDevice, admin, jane);
    await deleteUser(fromKnownDevice, admin, jane, 'jane@adiutor.test');

    expect(sent).toHaveLength(5);
    sent.forEach((email) => {
      expect(email.text).not.toContain('From:');
      expect(email.text).not.toContain('203.0.113.9');
      expect(email.text).not.toContain('Firefox');
    });
  });

  it('refuses actions on yourself', async () => {
    await expect(deactivateUser(ctx, admin, admin.id)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('deletes a user after the email is typed, keeping the audit entry', async () => {
    await expect(deleteUser(ctx, admin, jane, 'someone@adiutor.test')).rejects.toMatchObject({
      code: 'invalid',
    });

    await deleteUser(ctx, admin, jane, ' Jane@Adiutor.test ');

    expect(await db.select().from(user).where(eq(user.id, jane))).toEqual([]);
    const [entry] = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.action, 'account_deleted'));
    expect(entry).toMatchObject({
      actorUserId: admin.id,
      details: { email: 'jane@adiutor.test' },
    });
  });

  it('refuses to remove the last Admin of a company who can sign in', async () => {
    const companyAdmin = await createUser(db, 'boss@adiutor.test');
    await addMember(db, testCompany.id, companyAdmin, 'admin');

    await expect(deactivateUser(ctx, admin, companyAdmin)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('Adiutor Tests Client'),
    });

    // A second Admin who is deactivated doesn't count.
    const other = await createUser(db, 'other@adiutor.test');
    await addMember(db, testCompany.id, other, 'admin');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, other));
    expect(await soleAdminOf(db, companyAdmin)).toEqual({
      staff: false,
      companies: ['Adiutor Tests Client'],
    });

    await db.update(user).set({ deactivatedAt: null }).where(eq(user.id, other));
    await expect(
      deleteUser(ctx, admin, companyAdmin, 'boss@adiutor.test'),
    ).resolves.toBeUndefined();
  });

  it('ignores deactivated companies for the last-Admin rule', async () => {
    const closed = await createCompany(db, { deactivated: true });
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, closed.id, owner, 'admin');
    expect(await soleAdminOf(db, owner)).toEqual({ staff: false, companies: [] });
  });
});

describe('deactivateOwnAccount', () => {
  /** Jane's password in these tests. */
  const PASSWORD = 'correct horse battery';

  /**
   * Gives a user a password, as Better Auth stores it.
   *
   * @param userId - The user.
   */
  async function givePassword(userId: string): Promise<void> {
    await db.insert(account).values({
      userId,
      accountId: userId,
      providerId: 'credential',
      password: await hashPassword(PASSWORD),
    });
  }

  /**
   * Reads when a user was deactivated.
   *
   * @param userId - The user.
   * @returns The time, or `null` while they're active.
   */
  async function deactivatedAt(userId: string): Promise<Date | null> {
    const found = firstRow(
      await db.select({ deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, userId)),
      'the user',
    );
    return found.deactivatedAt;
  }

  /**
   * Tries to deactivate a number of times, one after another.
   *
   * @param times - How many times.
   * @param actor - The signed-in user.
   * @param password - The password typed each time.
   * @returns How each ended: `deactivated` or the service error's code.
   */
  async function attempts(times: number, actor: Actor, password: string): Promise<string[]> {
    return inSequence(Array.from({ length: times }), () =>
      deactivateOwnAccount(ctx, actor, password).then(
        () => 'deactivated',
        (error: { code: string }) => error.code,
      ),
    );
  }

  it('checks the password, then deactivates, signs out and forgets trusted devices', async () => {
    await givePassword(jane);
    await createSession(db, jane);
    await db.insert(verification).values([
      { identifier: 'trust-device-own', value: jane, expiresAt: new Date(Date.now() + 1e6) },
      {
        identifier: 'trust-device-someone-else',
        value: admin.id,
        expiresAt: new Date(Date.now() + 1e6),
      },
    ]);
    // With a password, the sign-in may be of any age.
    const actor = await signedIn(jane, { signedInAt: minutesAgo(3 * 24 * 60) });

    await expect(deactivateOwnAccount(ctx, actor, 'wrong')).rejects.toMatchObject({
      code: 'invalid',
      message: 'That password is incorrect.',
    });
    expect(await deactivatedAt(jane)).toBeNull();
    await deactivateOwnAccount(ctx, actor, PASSWORD);

    expect(await deactivatedAt(jane)).toBeInstanceOf(Date);
    expect(await db.select().from(session).where(eq(session.userId, jane))).toEqual([]);
    expect((await db.select().from(verification)).map((row) => row.identifier)).toEqual([
      'trust-device-someone-else',
    ]);
    expect(sent.map((email) => email.subject)).toEqual(['Your Adiutor account was deactivated']);
    expect(await actionsAbout(jane)).toEqual(['password_check_failed', 'account_deactivated']);
    const [wrong] = await db
      .select({ actorUserId: auditEvent.actorUserId, details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'password_check_failed'));
    expect(wrong).toEqual({ actorUserId: jane, details: { purpose: 'deactivate' } });
  });

  it('names the device and IP address in the email: it was their own change', async () => {
    await givePassword(jane);
    await deactivateOwnAccount(fromKnownDevice, await signedIn(jane), PASSWORD);

    expect(sent).toHaveLength(1);
    const notice = defined(sent[0], 'the notice email');
    expect(notice.text).toContain('Firefox on Windows');
    expect(notice.text).toContain('203.0.113.9');
  });

  it('refuses the only staff Admin', async () => {
    await expect(deactivateOwnAccount(ctx, admin, '')).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('You are the only staff Admin.'),
    });
  });

  it("refuses a company's only Admin the same way with a right or a wrong password", async () => {
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, testCompany.id, owner, 'admin');
    await givePassword(owner);
    const actor = await signedIn(owner);

    const refusals = await inSequence([PASSWORD, 'wrong', PASSWORD], (password) =>
      deactivateOwnAccount(ctx, actor, password).catch((error: unknown) => error),
    );

    expect(refusals).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          code: 'conflict',
          message:
            'You are the only Admin of Adiutor Tests Client. Make someone else an Admin first.',
        }),
      ),
    );
    // The password was never checked: nothing counted or recorded, and the account stays.
    expect(await db.select().from(rateLimitBucket)).toEqual([]);
    expect(await actionsAbout(owner)).toEqual([]);
    expect(await deactivatedAt(owner)).toBeNull();
  });

  it('limits wrong passwords per user, refusing even a right one after five', async () => {
    await givePassword(jane);
    const actor = await signedIn(jane);

    expect(await attempts(5, actor, 'wrong')).toEqual(Array.from({ length: 5 }, () => 'invalid'));
    await expect(deactivateOwnAccount(ctx, actor, PASSWORD)).rejects.toMatchObject({
      code: 'rate_limited',
      message: expect.stringMatching(/^Too many attempts\. Try again in \d+ minutes?\.$/),
    });

    expect(await deactivatedAt(jane)).toBeNull();
    expect(await actionsAbout(jane)).toEqual(
      Array.from({ length: 5 }, () => 'password_check_failed'),
    );
  });

  it('needs a recent confirmation when the account has a second step', async () => {
    await enableTwoFactor(db, jane);

    // Not confirmed, or confirmed too long ago.
    await inSequence([null, minutesAgo(16)], async (confirmedAt) =>
      expect(
        deactivateOwnAccount(ctx, await signedIn(jane, { confirmedAt }), ''),
      ).rejects.toMatchObject({ code: 'forbidden', message: MFA_VERIFICATION_REQUIRED.message }),
    );
    expect(await deactivatedAt(jane)).toBeNull();

    // Confirmed just now, it goes ahead without a password, whenever the session signed in.
    await deactivateOwnAccount(
      ctx,
      await signedIn(jane, { confirmedAt: new Date(), signedInAt: minutesAgo(3 * 60) }),
      '',
    );
    expect(await deactivatedAt(jane)).toBeInstanceOf(Date);
  });

  it('needs a sign-in from the last hour without a password or a second step', async () => {
    // Signed in too long ago, or at an unknown time.
    await inSequence([minutesAgo(61), null], async (signedInAt) =>
      expect(
        deactivateOwnAccount(ctx, await signedIn(jane, { signedInAt }), ''),
      ).rejects.toMatchObject({ code: 'forbidden', message: SESSION_NOT_FRESH.message }),
    );
    expect(await deactivatedAt(jane)).toBeNull();

    await deactivateOwnAccount(ctx, await signedIn(jane, { signedInAt: minutesAgo(59) }), '');
    expect(await deactivatedAt(jane)).toBeInstanceOf(Date);
    expect(await actionsAbout(jane)).toEqual(['account_deactivated']);
  });
});

describe('invitations of people who lose access', () => {
  it("are revoked when an account is deactivated or deleted, so they can't be used later", async () => {
    const leaving = await staffActor(db, 'platform_admin', 'leaving@adiutor.test');
    await inviteByEmail(ctx, leaving, {
      companyId: null,
      email: 'friend@adiutor.test',
      role: 'platform_admin',
    });
    await createInviteLink(ctx, leaving, {
      companyId: null,
      role: 'platform_admin',
      validDays: 30,
    });

    await deactivateUser(ctx, admin, leaving.id);

    const open = firstRow(
      await db
        .select({ revokedAt: invitation.revokedAt })
        .from(invitation)
        .where(eq(invitation.invitedBy, leaving.id)),
      'the invitation',
    );
    const link = firstRow(
      await db
        .select({ revokedAt: inviteLink.revokedAt })
        .from(inviteLink)
        .where(eq(inviteLink.createdBy, leaving.id)),
      'the invite link',
    );
    expect(open.revokedAt).toBeInstanceOf(Date);
    expect(link.revokedAt).toBeInstanceOf(Date);

    const other = await staffActor(db, 'platform_admin', 'other@adiutor.test');
    await createInviteLink(ctx, other, { companyId: testCompany.id, role: 'admin', validDays: 7 });
    await deleteUser(ctx, admin, other.id, 'other@adiutor.test');
    const links = await db.select({ revokedAt: inviteLink.revokedAt }).from(inviteLink);
    expect(links.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('addressed to them are revoked when their account is deleted, and they get an email', async () => {
    const other = await createCompany(db, { name: 'Adiutor Tests Other' });
    const otherAdmin = await createUser(db, 'other.admin@adiutor.test');
    await addMember(db, other.id, otherAdmin, 'admin');
    await inviteByEmail(ctx, await actorFor(db, otherAdmin), {
      companyId: other.id,
      email: 'jane@adiutor.test',
      role: 'admin',
    });
    const token = tokenFrom(defined(sent.at(-1), 'the last email'));
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'jane@adiutor.test',
      role: 'manager',
    });
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'friend@adiutor.test',
      role: 'support',
    });
    sent.length = 0;
    const fromBrowser = {
      ...ctx,
      /**
       * Pretends the Admin's request came from a known browser and IP address.
       *
       * @returns The request info.
       */
      requestInfo: async () => ({ ip: '203.0.113.9', userAgent: 'Firefox' }),
    };

    await deleteUser(fromBrowser, admin, jane, 'jane@adiutor.test');

    // Every invitation to their address is revoked, someone else's stays.
    expect(
      await db
        .select({ email: invitation.email })
        .from(invitation)
        .where(and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt))),
    ).toEqual([{ email: 'friend@adiutor.test' }]);
    // So nobody can create a new account for the address with one.
    expect(
      await acceptInvitationWithNewAccount(ctx, token, {
        name: 'Jane Again',
        password: 'jane-again-password',
      }),
    ).toEqual({ status: 'invalid' });
    const [revoked] = await db
      .select({ companyId: auditEvent.companyId, details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'invitation_revoked'));
    expect(revoked).toEqual({
      companyId: null,
      details: {
        automatic: true,
        reason: 'account_closed',
        email: 'jane@adiutor.test',
        invitations: 2,
      },
    });
    // The address the account had is told, without the Admin's device or IP address.
    expect(sent).toEqual([
      expect.objectContaining({
        to: 'jane@adiutor.test',
        subject: 'Your Adiutor account was deleted',
      }),
    ]);
    const notice = defined(sent[0], 'the notice email');
    expect(notice.text).not.toContain('From:');
    expect(notice.text).not.toContain('203.0.113.9');
  });

  it('are left alone and nobody is emailed when the deletion is refused', async () => {
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'jane@adiutor.test',
      role: 'support',
    });
    const companyAdmin = await createUser(db, 'boss@adiutor.test');
    await addMember(db, testCompany.id, companyAdmin, 'admin');
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'boss@adiutor.test',
      role: 'support',
    });
    sent.length = 0;

    await expect(deleteUser(ctx, admin, jane, 'someone@adiutor.test')).rejects.toMatchObject({
      code: 'invalid',
    });
    // The last Admin of a company: refused inside the transaction, once the locks are held.
    await expect(deleteUser(ctx, admin, companyAdmin, 'boss@adiutor.test')).rejects.toMatchObject({
      code: 'conflict',
    });

    expect(
      await db.$count(invitation, and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt))),
    ).toBe(2);
    expect(sent).toEqual([]);
  });

  it('are revoked when created while the account is being deleted: deletion locks it before revoking', async () => {
    const leaving = await staffActor(db, 'platform_admin', 'leaving@adiutor.test');

    const { second } = await atTheSameMoment(
      db,
      // Their request inserts a link, which locks their row as its creator. It commits only once
      // the deletion is waiting for that row, which it locks before revoking anything.
      (tx) =>
        tx.insert(inviteLink).values({
          companyId: null,
          role: 'platform_admin',
          tokenHash: 'adiutor-tests-token-hash',
          createdBy: leaving.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
      () => deleteUser(ctx, admin, leaving.id, 'leaving@adiutor.test'),
    );

    expect(second.status).toBe('fulfilled');
    expect(await db.select().from(user).where(eq(user.id, leaving.id))).toEqual([]);
    expect(
      await db
        .select({
          createdBy: inviteLink.createdBy,
          usedAt: inviteLink.usedAt,
          revokedAt: inviteLink.revokedAt,
        })
        .from(inviteLink),
    ).toEqual([{ createdBy: null, usedAt: null, revokedAt: expect.any(Date) }]);
  });
});

describe('own activity', () => {
  it("shows the IP address and browser of the user's own actions only", async () => {
    const fromBrowser = {
      ...ctx,
      /**
       * Pretends the request came from a known browser and IP address.
       *
       * @returns The request info.
       */
      requestInfo: async () => ({ ip: '203.0.113.9', userAgent: 'Firefox' }),
    };
    await resetUserMfa(fromBrowser, await adminConfirmedAt(), jane);
    await recordEvent(fromBrowser, {
      action: 'password_changed',
      actorUserId: jane,
      targetUserId: jane,
    });

    const [own, byAdmin] = await listOwnActivity(ctx, await actorFor(db, jane));
    expect(own).toMatchObject({
      action: 'password_changed',
      ip: '203.0.113.9',
      userAgent: 'Firefox',
    });
    expect(byAdmin).toMatchObject({ action: 'mfa_reset', ip: null, userAgent: null });
  });
});

/**
 * Creates sessions for a user that signed in on consecutive days of January 2026, so they sort in
 * a known order (created in one go, they'd all have the time of the test).
 *
 * @param userId - The user.
 * @param count - How many; the first signed in on January 1, each next one a day later.
 * @returns Their IDs, the oldest first. Their browsers are 'Browser 01', 'Browser 02' and so on.
 */
async function createSessionsOnJanuaryDays(userId: string, count: number): Promise<string[]> {
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

describe('listUserSessions sorting and paging', () => {
  it('leaves expired sessions out of the list and the total', async () => {
    await createSessionsOnJanuaryDays(jane, 3);
    // Signed in most recently of all, so it would come first if it counted.
    const expired = await createSession(db, jane, {
      userAgent: 'Browser expired',
      expiresAt: new Date(Date.now() - 1000),
    });
    await db
      .update(session)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 31)) })
      .where(eq(session.id, expired));
    // Another user's session isn't theirs.
    await createSession(db, await createUser(db, 'other@adiutor.test'), {
      userAgent: 'Browser other',
    });

    const listed = await listUserSessions(db, jane, null);

    expect(listed).toMatchObject({ total: 3, page: 1, size: 25 });
    expect(listed.items.map((found) => found.userAgent)).toEqual([
      'Browser 03',
      'Browser 02',
      'Browser 01',
    ]);
  });

  it('lists the newest first by default and the oldest first the other way round', async () => {
    await createSessionsOnJanuaryDays(jane, 4);
    /**
     * Lists Jane's sessions in an order.
     *
     * @param options - Sort and page.
     * @returns The browsers, in order.
     */
    const agents = async (options?: Parameters<typeof listUserSessions>[3]) =>
      (await listUserSessions(db, jane, null, options)).items.map((found) => found.userAgent);

    const newestFirst = ['Browser 04', 'Browser 03', 'Browser 02', 'Browser 01'];
    expect(await agents()).toEqual(newestFirst);
    expect(await agents({ sort: 'signed-in' })).toEqual(newestFirst);
    expect(await agents({ sort: 'signed-in', dir: 'desc' })).toEqual(newestFirst);
    expect(await agents({ dir: 'asc' })).toEqual([...newestFirst].reverse());
  });

  it('shows 25 sessions a page, counting all of them, and the last page for one past it', async () => {
    await createSessionsOnJanuaryDays(jane, 30);
    await createSession(db, jane, {
      userAgent: 'Browser expired',
      expiresAt: new Date(Date.now() - 1000),
    });

    const first = await listUserSessions(db, jane, null);
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items.map((found) => found.userAgent)).toEqual(
      Array.from({ length: 25 }, (_, index) => `Browser ${String(30 - index).padStart(2, '0')}`),
    );

    const second = await listUserSessions(db, jane, null, { page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items.map((found) => found.userAgent)).toEqual([
      'Browser 05',
      'Browser 04',
      'Browser 03',
      'Browser 02',
      'Browser 01',
    ]);

    const past = await listUserSessions(db, jane, null, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map((found) => found.id)).toEqual(second.items.map((found) => found.id));

    const fifty = await listUserSessions(db, jane, null, { size: 50 });
    expect(fifty).toMatchObject({ total: 30, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(30);
  });
});

describe('getUserDetail companies and devices', () => {
  /**
   * Adds a user to companies named 'Adiutor Tests 01', 'Adiutor Tests 02' and so on.
   *
   * @param userId - The user.
   * @param count - How many companies.
   * @param role - Their role in each; Client by default.
   */
  async function joinNumberedCompanies(
    userId: string,
    count: number,
    role: 'client' | 'admin' = 'client',
  ): Promise<void> {
    await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const created = await createCompany(db, {
          name: `Adiutor Tests ${String(index + 1).padStart(2, '0')}`,
        });
        await addMember(db, created.id, userId, role);
      }),
    );
  }

  it('sorts their companies by name ignoring case, or by when they joined', async () => {
    const maya = await createUser(db, 'maya@adiutor.test');
    const joined: [string, number][] = [
      ['Adiutor Tests Charlie', 1],
      ['Adiutor Tests alpha', 2],
      ['Adiutor Tests Bravo', 3],
    ];
    await inSequence(joined, async ([name, day]) => {
      const created = await createCompany(db, { name });
      const membershipId = await addMember(db, created.id, maya, 'client');
      await db
        .update(membership)
        .set({ createdAt: new Date(Date.UTC(2026, 0, day)) })
        .where(eq(membership.id, membershipId));
    });
    /**
     * Lists Maya's companies in an order.
     *
     * @param companies - Sort and page of the companies.
     * @returns The company names, in order.
     */
    const names = async (companies?: UserDetailOptions['companies']) =>
      (await getUserDetail(ctx, admin, maya, { companies })).companies.items.map(
        (listed) => listed.name,
      );

    // Name A to Z is the default.
    const aToZ = ['Adiutor Tests alpha', 'Adiutor Tests Bravo', 'Adiutor Tests Charlie'];
    expect(await names()).toEqual(aToZ);
    expect(await names({ sort: 'name', dir: 'desc' })).toEqual([...aToZ].reverse());
    // Newest first is the default for Joined, by the membership's date.
    const newestFirst = ['Adiutor Tests Bravo', 'Adiutor Tests alpha', 'Adiutor Tests Charlie'];
    expect(await names({ sort: 'joined' })).toEqual(newestFirst);
    expect(await names({ sort: 'joined', dir: 'asc' })).toEqual([...newestFirst].reverse());
    const newest = firstRow(
      (await getUserDetail(ctx, admin, maya, { companies: { sort: 'joined' } })).companies.items,
      'the newest company',
    );
    expect(newest.joinedAt).toEqual(new Date(Date.UTC(2026, 0, 3)));
  });

  it('pages their companies, counting all of them, and the last page for one past it', async () => {
    const maya = await createUser(db, 'maya@adiutor.test');
    await joinNumberedCompanies(maya, 30);

    const first = (await getUserDetail(ctx, admin, maya)).companies;
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first company').name).toBe('Adiutor Tests 01');

    const second = (await getUserDetail(ctx, admin, maya, { companies: { page: 2 } })).companies;
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items.map((listed) => listed.name)).toEqual([
      'Adiutor Tests 26',
      'Adiutor Tests 27',
      'Adiutor Tests 28',
      'Adiutor Tests 29',
      'Adiutor Tests 30',
    ]);

    const past = (await getUserDetail(ctx, admin, maya, { companies: { page: 99 } })).companies;
    expect(past.page).toBe(2);
    expect(past.items.map((listed) => listed.id)).toEqual(second.items.map((listed) => listed.id));

    const fifty = (await getUserDetail(ctx, admin, maya, { companies: { size: 50 } })).companies;
    expect(fifty).toMatchObject({ total: 30, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(30);
  });

  it('works out whether their role requires MFA from all their companies, not the page shown', async () => {
    const owner = await createUser(db, 'owner@adiutor.test');
    await joinNumberedCompanies(owner, 25);
    // Sorts after the other 25 by name, so it's on the second page.
    const zulu = await createCompany(db, { name: 'Adiutor Tests Zulu' });
    await addMember(db, zulu.id, owner, 'admin');

    const detail = await getUserDetail(ctx, admin, owner);

    expect(detail.companies).toMatchObject({ total: 26, page: 1, size: 25 });
    expect(detail.companies.items.map((listed) => listed.name)).not.toContain('Adiutor Tests Zulu');
    expect(detail.mfa).toMatchObject({ status: 'required', required: true });

    const second = await getUserDetail(ctx, admin, owner, { companies: { page: 2 } });
    expect(second.companies.items).toEqual([
      expect.objectContaining({ id: zulu.id, role: 'admin', deactivated: false }),
    ]);
    expect(second.mfa).toMatchObject({ status: 'required', required: true });

    // It's the Admin role that requires it: as a Client there, MFA is optional.
    await db.update(membership).set({ role: 'client' }).where(eq(membership.companyId, zulu.id));
    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'optional',
      required: false,
    });
  });

  it('pages their devices, and shows none without the right to manage users', async () => {
    await createSessionsOnJanuaryDays(jane, 30);

    const first = await getUserDetail(ctx, admin, jane, { sessions: { size: 25 } });
    expect(first.sessions).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.sessions?.items).toHaveLength(25);
    expect(defined(first.sessions?.items[0], 'the newest device').userAgent).toBe('Browser 30');

    const second = await getUserDetail(ctx, admin, jane, { sessions: { size: 25, page: 2 } });
    expect(second.sessions).toMatchObject({ total: 30, page: 2 });
    expect(second.sessions?.items.map((found) => found.userAgent)).toEqual([
      'Browser 05',
      'Browser 04',
      'Browser 03',
      'Browser 02',
      'Browser 01',
    ]);
    // The tables are paged on their own: the companies stay on their first page.
    expect(second.companies).toMatchObject({ total: 1, page: 1, size: 25 });

    const oldestFirst = await getUserDetail(ctx, admin, jane, { sessions: { dir: 'asc' } });
    expect(defined(oldestFirst.sessions?.items[0], 'the oldest device').userAgent).toBe(
      'Browser 01',
    );

    // Support can't see devices, whatever the page asks for; the companies still show.
    const support = await staffActor(db, 'support');
    const hidden = await getUserDetail(ctx, support, jane, { sessions: { size: 25 } });
    expect(hidden.sessions).toBeNull();
    expect(hidden.companies).toMatchObject({ total: 1, page: 1, size: 25 });
  });
});
