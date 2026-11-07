/**
 * @file Integration tests for ending the sessions that don't meet the MFA a
 * new role requires (`withMfaPromotion`), on its own and in every change
 * that can make a role require MFA: staff and company role changes, adding
 * a member, accepting an invitation or invite link, reactivating a company
 * and the setup command's promotion.
 */
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, membership, session, user } from '@/db/schema';
import { defined } from '@/lib/defined';

import {
  addMember as addMembership,
  createCompany,
  createSession,
  createStaffSettings,
  createUser,
  memberActor,
  setupTestContext,
  staffActor,
  tokenFrom,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { withMfaPromotion } from './mfa-promotion';
import { setCompanyActive } from '../people/companies';
import { acceptInvitation, inviteByEmail } from '../people/invitations';
import { createInviteLink, joinWithInviteLink } from '../people/invite-links';
import { addMember, changeMemberRole } from '../people/members';
import { changeStaffRole } from '../people/staff';
import { setUpPlatform } from '../setup';

const { ctx, db, sent } = setupTestContext();

/** The staff Admin making the changes. */
let admin: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
});

/**
 * Gives a user one session of each kind: confirmed with an email code, not
 * confirmed, on a trusted device, and confirmed with a passkey and with an
 * authenticator app (the last two count for every role).
 *
 * @param userId - The user.
 * @returns The sessions' IDs by kind.
 */
async function sessionsOfEachKind(userId: string) {
  return {
    emailCode: await createSession(db, userId, { mfaMethod: 'email_code' }),
    unconfirmed: await createSession(db, userId),
    trustedDevice: await createSession(db, userId, { mfaMethod: 'trusted_device' }),
    passkey: await createSession(db, userId, { mfaMethod: 'passkey' }),
    authenticator: await createSession(db, userId, { mfaMethod: 'authenticator' }),
  };
}

/**
 * Lists a user's sessions left.
 *
 * @param userId - The user.
 * @returns Their IDs, sorted.
 */
async function sessionsLeft(userId: string): Promise<string[]> {
  const rows = await db.select({ id: session.id }).from(session).where(eq(session.userId, userId));
  return rows.map(({ id }) => id).sort();
}

/**
 * Reads the sign-outs recorded about a user.
 *
 * @param userId - The user.
 * @returns Their details, oldest first.
 */
async function signOutsOf(userId: string) {
  const rows = await db
    .select({ action: auditEvent.action, details: auditEvent.details })
    .from(auditEvent)
    .where(eq(auditEvent.targetUserId, userId))
    .orderBy(asc(auditEvent.id));
  return rows.filter(({ action }) => action === 'sessions_revoked').map(({ details }) => details);
}

describe('withMfaPromotion', () => {
  it('ends the sessions without MFA that counts once a role requires it, and records it', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await withMfaPromotion(ctx, db, [jane], () =>
      db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, jane)),
    );

    expect(await sessionsLeft(jane)).toEqual([kinds.passkey, kinds.authenticator].sort());
    expect(await signOutsOf(jane)).toEqual([{ mfaRequired: true, count: 3 }]);
  });

  it('keeps the session the user is acting with themselves', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await withMfaPromotion(
      ctx,
      db,
      [jane],
      () => db.update(user).set({ platformRole: 'platform_admin' }).where(eq(user.id, jane)),
      { keepSessionId: kinds.emailCode },
    );

    expect(await sessionsLeft(jane)).toEqual(
      [kinds.emailCode, kinds.passkey, kinds.authenticator].sort(),
    );
  });

  it('leaves users alone whose role required MFA already, or still doesn’t', async () => {
    const manager = await createUser(db, 'manager@adiutor.test');
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, manager));
    const support = await createUser(db, 'support@adiutor.test');
    const managerSessions = await sessionsOfEachKind(manager);
    const supportSessions = await sessionsOfEachKind(support);

    await withMfaPromotion(ctx, db, [manager, support], async () => {
      await db.update(user).set({ platformRole: 'platform_admin' }).where(eq(user.id, manager));
      await db.update(user).set({ platformRole: 'support' }).where(eq(user.id, support));
    });

    expect(await sessionsLeft(manager)).toEqual(Object.values(managerSessions).sort());
    expect(await sessionsLeft(support)).toEqual(Object.values(supportSessions).sort());
    expect(await signOutsOf(manager)).toEqual([]);
  });

  it('ends nothing when the change fails', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await expect(
      db.transaction((tx) =>
        withMfaPromotion(ctx, tx, [jane], async () => {
          await tx.update(user).set({ platformRole: 'manager' }).where(eq(user.id, jane));
          throw new Error('The change failed.');
        }),
      ),
    ).rejects.toThrow('The change failed.');

    expect(await sessionsLeft(jane)).toEqual(Object.values(kinds).sort());
  });
});

describe('changes that make a role require MFA', () => {
  it('a staff role change to Manager', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await changeStaffRole(ctx, admin, { userId: jane, role: 'manager' });

    expect(await sessionsLeft(jane)).toEqual([kinds.passkey, kinds.authenticator].sort());
  });

  it('a company role change to Admin, and adding a member as Admin', async () => {
    const testCompany = await createCompany(db);
    await memberActor(db, testCompany.id, 'admin', 'boss@adiutor.test');
    const jane = await createUser(db, 'jane@adiutor.test');
    const membershipId = await addMembership(db, testCompany.id, jane, 'client');
    const janeSessions = await sessionsOfEachKind(jane);
    const john = await createUser(db, 'john@adiutor.test');
    const johnSessions = await sessionsOfEachKind(john);

    await changeMemberRole(ctx, admin, { companyId: testCompany.id, membershipId, role: 'admin' });
    await addMember(ctx, admin, { companyId: testCompany.id, userId: john, role: 'admin' });

    expect(await sessionsLeft(jane)).toEqual(
      [janeSessions.passkey, janeSessions.authenticator].sort(),
    );
    expect(await sessionsLeft(john)).toEqual(
      [johnSessions.passkey, johnSessions.authenticator].sort(),
    );
  });

  it('accepting an Admin invitation, keeping the session it was accepted with', async () => {
    const testCompany = await createCompany(db);
    const email = 'jane@adiutor.test';
    await inviteByEmail(ctx, admin, { companyId: testCompany.id, email, role: 'admin' });
    const jane = await createUser(db, email);
    const kinds = await sessionsOfEachKind(jane);

    await acceptInvitation(ctx, tokenFrom(defined(sent[sent.length - 1], 'the invitation email')), {
      id: jane,
      email,
      platformRole: null,
      sessionId: kinds.unconfirmed,
    });

    expect(await sessionsLeft(jane)).toEqual(
      [kinds.unconfirmed, kinds.passkey, kinds.authenticator].sort(),
    );
  });

  it('joining as a staff Manager with an invite link, which proves no inbox, ends that session too', async () => {
    const link = await createInviteLink(ctx, admin, {
      companyId: null,
      role: 'manager',
      validDays: 7,
    });
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await expect(
      joinWithInviteLink(ctx, defined(link.url.split('/join/')[1], 'the invite link token'), {
        id: jane,
        email: 'jane@adiutor.test',
        platformRole: null,
        sessionId: kinds.emailCode,
      }),
    ).resolves.toEqual({ status: 'joined', companyId: null, signedOut: true });

    expect(await sessionsLeft(jane)).toEqual([kinds.passkey, kinds.authenticator].sort());
  });

  it('joining with an invite link from a session with a strong factor keeps it', async () => {
    const testCompany = await createCompany(db);
    const link = await createInviteLink(ctx, admin, {
      companyId: testCompany.id,
      role: 'admin',
      validDays: 7,
    });
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await expect(
      joinWithInviteLink(ctx, defined(link.url.split('/join/')[1], 'the invite link token'), {
        id: jane,
        email: 'jane@adiutor.test',
        platformRole: null,
        sessionId: kinds.passkey,
      }),
    ).resolves.toEqual({ status: 'joined', companyId: testCompany.id, signedOut: false });
    // The sign-out names the company it was about.
    const [signOut] = await db
      .select({ companyId: auditEvent.companyId })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'sessions_revoked'));
    expect(signOut).toEqual({ companyId: testCompany.id });
  });

  it('reactivating a company, for all of its Admins but not its other members', async () => {
    const testCompany = await createCompany(db, { deactivated: true });
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    await addMembership(db, testCompany.id, jane, 'admin');
    await addMembership(db, testCompany.id, john, 'client');
    const janeSessions = await sessionsOfEachKind(jane);
    const johnSessions = await sessionsOfEachKind(john);

    await setCompanyActive(ctx, admin, { companyId: testCompany.id, active: true });

    expect(await sessionsLeft(jane)).toEqual(
      [janeSessions.passkey, janeSessions.authenticator].sort(),
    );
    expect(await sessionsLeft(john)).toEqual(Object.values(johnSessions).sort());
    // Deactivating it again ends nothing more.
    await setCompanyActive(ctx, admin, { companyId: testCompany.id, active: false });
    expect(await sessionsLeft(jane)).toHaveLength(2);
    expect(await db.select().from(membership)).toHaveLength(2);
  });

  it('the setup command making an existing account the staff Admin', async () => {
    await db.delete(session);
    await db.delete(user);
    await db.execute('delete from staff_settings');
    const jane = await createUser(db, 'jane@adiutor.test');
    const kinds = await sessionsOfEachKind(jane);

    await setUpPlatform(
      db,
      { staffName: 'Adiutor Tests', name: 'Jane', email: 'jane@adiutor.test' },
      { allowExistingAccount: true },
    );

    expect(await sessionsLeft(jane)).toEqual([kinds.passkey, kinds.authenticator].sort());
  });
});
