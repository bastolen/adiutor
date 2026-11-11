/**
 * @file Integration tests for what a staff Admin does to someone else's
 * account (reset two-step verification, sign out, deactivate, reactivate,
 * delete), for what happens to the invitations of people who lose access,
 * and for the user's own activity listing of those actions, against the test
 * database.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  account,
  auditEvent,
  invitation,
  inviteLink,
  passkey,
  session,
  twoFactor,
  user,
  verification,
} from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { deactivateUser, deleteUser, reactivateUser, resetUserMfa, signOutUserEverywhere } from '.';
import {
  actorFor,
  addMember,
  addPassword,
  atTheSameMoment,
  connectProvider,
  createCompany,
  createSession,
  createUser,
  emailLanguage,
  enableTwoFactor,
  inLanguage,
  inSequence,
  setUserLocale,
  staffActor,
  tokenFrom,
} from '../../../../tests/integration/helpers';
import { listOwnActivity, recordEvent } from '../../audit';
import { releaseSignInChangeLock, takeSignInChangeLock } from '../../auth/sign-in-change-lock';
import { acceptInvitationWithNewAccount, inviteByEmail } from '../invitations';
import { createInviteLink } from '../invite-links';
import {
  actionsAbout,
  adminConfirmedAt,
  admin,
  ctx,
  db,
  fromKnownDevice,
  jane,
  minutesAgo,
  sent,
  testCompany,
} from './test-helpers';

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
        key: 'errors.signIn.mfaVerificationRequired',
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
      key: 'errors.signIn.changeInProgress',
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

  it('tells a deleted user in the language they saved, read before the account went', async () => {
    await setUserLocale(db, jane, 'nl-NL');

    // The Admin's own language doesn't count: Jane saved hers.
    await deleteUser(inLanguage(ctx, 'es-ES'), admin, jane, 'jane@adiutor.test');

    expect(sent.map((email) => [email.to, emailLanguage(email), email.subject])).toEqual([
      ['jane@adiutor.test', 'nl-NL', 'Je Adiutor-account is verwijderd'],
    ]);
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
