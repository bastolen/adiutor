/**
 * @file Integration tests for giving a lasting way in: any staff role (or a
 * higher one) and a company's Admin role need the giver's confirmation with
 * their second step from the last 15 minutes, in every service that gives
 * one, and nothing counts or changes when it's missing; stepping down,
 * removing someone, and the Client and Watcher roles need nothing. Also:
 * a new staff Admin is emailed to the other staff Admins.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { invitation, inviteLink, membership, rateLimitBucket, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  queuedJobKinds,
  addMember as addMemberRow,
  createCompany,
  createStaffSettings,
  createUser,
  emailLanguage,
  enableTwoFactor,
  inSequence,
  sendQueuedEmails,
  setupTestContext,
  setUserLocale,
  tokenFrom,
} from '../../../tests/integration/helpers';
import { type Actor, loadActor } from '../actor';
import { registerCompany } from './companies';
import {
  acceptInvitationWithNewAccount,
  inviteByEmail,
  inviteManyByEmail,
  resendInvitation,
} from './invitations';
import { createInviteLink, joinWithInviteLink } from './invite-links';
import { addMember, changeMemberRole } from './members';
import { changeStaffRole, removeFromStaff } from './staff';

const { ctx, db, sent } = setupTestContext();

/** What a refusal for lack of a recent confirmation looks like. */
const NEEDS_CONFIRMATION = { code: 'confirmation_required' };

let testCompany: Awaited<ReturnType<typeof createCompany>>;

beforeEach(async () => {
  await createStaffSettings(db);
  testCompany = await createCompany(db, { name: 'Adiutor Tests Client' });
});

/**
 * Signs a user in with an authenticator app, confirmed that many minutes ago.
 *
 * @param userId - The user (gets an authenticator app).
 * @param minutesAgo - How long ago the session's second step was.
 * @returns The actor.
 */
async function confirmedAgo(userId: string, minutesAgo: number): Promise<Actor> {
  await enableTwoFactor(db, userId);
  const actor = await loadActor(db, userId, {
    id: 'adiutor-tests-session',
    mfaVerified: true,
    mfaMethod: 'authenticator',
    mfaVerifiedAt: new Date(Date.now() - minutesAgo * 60_000),
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  });
  if (!actor) {
    throw new Error(`No user ${userId}`);
  }
  return actor;
}

/**
 * Creates a staff member with a role.
 *
 * @param role - Their staff role.
 * @param email - Their address.
 * @returns Their ID.
 */
async function staffMember(role: 'platform_admin' | 'manager' | 'support', email: string) {
  const id = await createUser(db, email);
  await db.update(user).set({ platformRole: role }).where(eq(user.id, id));
  return id;
}

/**
 * A staff Admin confirmed 20 minutes ago (the window has closed).
 *
 * @returns The actor.
 */
const staleAdmin = async () =>
  confirmedAgo(await staffMember('platform_admin', 'stale.admin@adiutor.test'), 20);

/**
 * A staff Admin confirmed just now.
 *
 * @returns The actor.
 */
const freshAdmin = async () =>
  confirmedAgo(await staffMember('platform_admin', 'fresh.admin@adiutor.test'), 1);

/**
 * Checks that nothing was counted or created by a refused grant.
 */
async function expectNothingDone() {
  expect(await db.select().from(invitation)).toEqual([]);
  expect(await db.select().from(inviteLink)).toEqual([]);
  expect(await db.select().from(rateLimitBucket)).toEqual([]);
  expect(sent).toEqual([]);
}

describe('staff grants', () => {
  it('refuse inviting, bulk inviting and invite links for any staff role without a recent confirmation', async () => {
    const actor = await staleAdmin();

    await inSequence(['support', 'finance', 'manager', 'platform_admin'], (role) =>
      expect(
        inviteByEmail(ctx, actor, { companyId: null, email: 'new@adiutor.test', role }),
      ).rejects.toMatchObject(NEEDS_CONFIRMATION),
    );
    await expect(
      inviteManyByEmail(ctx, actor, {
        companyId: null,
        emails: 'a@adiutor.test, b@adiutor.test',
        role: 'support',
      }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expect(
      createInviteLink(ctx, actor, { companyId: null, role: 'support', validDays: 7 }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);

    await expectNothingDone();
  });

  it('send them with a recent confirmation, and refuse resending without one', async () => {
    const fresh = await freshAdmin();
    await inviteByEmail(ctx, fresh, {
      companyId: null,
      email: 'new@adiutor.test',
      role: 'support',
    });
    await createInviteLink(ctx, fresh, { companyId: null, role: 'manager', validDays: 7 });
    const sentInvitation = firstRow(await db.select().from(invitation), 'the sent invitation');
    expect(sentInvitation).toMatchObject({ email: 'new@adiutor.test', role: 'support' });

    const stale = await staleAdmin();
    await expect(
      resendInvitation(ctx, stale, { companyId: null, invitationId: sentInvitation.id }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await resendInvitation(ctx, fresh, { companyId: null, invitationId: sentInvitation.id });
  });

  it('refuse making someone staff or raising their role, but not stepping down or removing', async () => {
    const actor = await staleAdmin();
    const outsider = await createUser(db, 'outsider@adiutor.test');
    const support = await staffMember('support', 'support@adiutor.test');
    const manager = await staffMember('manager', 'manager@adiutor.test');

    await expect(
      changeStaffRole(ctx, actor, { userId: outsider, role: 'support' }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expect(
      changeStaffRole(ctx, actor, { userId: support, role: 'manager' }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expect(
      changeStaffRole(ctx, actor, { userId: manager, role: 'platform_admin' }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);

    // Nothing changed.
    const roles = await db
      .select({ id: user.id, role: user.platformRole })
      .from(user)
      .where(eq(user.id, outsider));
    expect(roles).toEqual([{ id: outsider, role: null }]);

    await changeStaffRole(ctx, actor, { userId: manager, role: 'support' });
    await removeFromStaff(ctx, actor, support);
  });
});

describe('company Admin grants', () => {
  it('refuse the Admin role without a recent confirmation, but not Client or Watcher', async () => {
    const companyAdmin = await createUser(db, 'boss@adiutor.test');
    await addMemberRow(db, testCompany.id, companyAdmin, 'admin');
    const actor = await confirmedAgo(companyAdmin, 20);

    await expect(
      inviteByEmail(ctx, actor, {
        companyId: testCompany.id,
        email: 'new.admin@adiutor.test',
        role: 'admin',
      }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expect(
      createInviteLink(ctx, actor, { companyId: testCompany.id, role: 'admin', validDays: 7 }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expectNothingDone();

    await inviteByEmail(ctx, actor, {
      companyId: testCompany.id,
      email: 'new.client@adiutor.test',
      role: 'client',
    });
    await createInviteLink(ctx, actor, {
      companyId: testCompany.id,
      role: 'watcher',
      validDays: 7,
    });

    // Making a member the Admin needs it; stepping them down to Watcher doesn't.
    const client = await createUser(db, 'client@adiutor.test');
    const membershipId = await addMemberRow(db, testCompany.id, client, 'client');
    await expect(
      changeMemberRole(ctx, actor, { companyId: testCompany.id, membershipId, role: 'admin' }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await changeMemberRole(ctx, actor, {
      companyId: testCompany.id,
      membershipId,
      role: 'watcher',
    });
    const row = firstRow(
      await db
        .select({ role: membership.role })
        .from(membership)
        .where(eq(membership.id, membershipId)),
      'the membership',
    );
    expect(row.role).toBe('watcher');
  });

  it('need nothing to choose the Admin role for someone who already has it, which changes nothing', async () => {
    const companyAdmin = await createUser(db, 'boss@adiutor.test');
    await addMemberRow(db, testCompany.id, companyAdmin, 'admin');
    const otherAdmin = await createUser(db, 'other.boss@adiutor.test');
    const membershipId = await addMemberRow(db, testCompany.id, otherAdmin, 'admin');
    const actor = await confirmedAgo(companyAdmin, 20);

    await changeMemberRole(ctx, actor, { companyId: testCompany.id, membershipId, role: 'admin' });

    const row = firstRow(
      await db
        .select({ role: membership.role })
        .from(membership)
        .where(eq(membership.id, membershipId)),
      'the membership',
    );
    expect(row.role).toBe('admin');
    expect(sent).toEqual([]);
    expect(await queuedJobKinds(db)).toEqual([]);
  });

  it('refuse adding someone as Admin, and a company with its first Admin, without one', async () => {
    const stale = await staleAdmin();
    const someone = await createUser(db, 'someone@adiutor.test');

    await expect(
      addMember(ctx, stale, { companyId: testCompany.id, userId: someone, role: 'admin' }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expect(
      registerCompany(ctx, stale, {
        name: 'Adiutor Tests New',
        slug: 'adiutor-tests-new',
        adminEmail: 'first.admin@adiutor.test',
      }),
    ).rejects.toMatchObject(NEEDS_CONFIRMATION);
    await expectNothingDone();

    await addMember(ctx, stale, { companyId: testCompany.id, userId: someone, role: 'client' });
    const fresh = await freshAdmin();
    await registerCompany(ctx, fresh, {
      name: 'Adiutor Tests New',
      slug: 'adiutor-tests-new',
      adminEmail: 'first.admin@adiutor.test',
    });
  });
});

describe('a new staff Admin', () => {
  /**
   * The addresses that got the "new staff Admin" email, once the queued ones are sent.
   *
   * @returns The recipients, sorted.
   */
  const toldAdmins = async () => {
    await sendQueuedEmails(ctx);
    return sent
      .filter((email) => email.subject.endsWith('is now a staff Admin on Adiutor'))
      .map((email) => email.to)
      .sort();
  };

  it('is emailed to the other active staff Admins when given the role', async () => {
    const actor = await freshAdmin();
    await staffMember('platform_admin', 'other.admin@adiutor.test');
    const away = await staffMember('platform_admin', 'away.admin@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, away));
    const manager = await staffMember('manager', 'sam@adiutor.test');

    await changeStaffRole(ctx, actor, { userId: manager, role: 'platform_admin' });

    // Not the actor, who made the change, the new Admin, or a deactivated Admin.
    expect(await toldAdmins()).toEqual(['other.admin@adiutor.test']);
    const told = defined(
      sent.find((email) => email.to === 'other.admin@adiutor.test'),
      'the email to the other Admin',
    );
    // Named by their name and address, and who made the change (test users are named after their address).
    expect(told.text).toContain('fresh.admin made sam (sam@adiutor.test) a staff Admin');
  });

  it('is emailed to each staff Admin in their own language', async () => {
    const actor = await freshAdmin();
    await setUserLocale(
      db,
      await staffMember('platform_admin', 'dutch.admin@adiutor.test'),
      'nl-NL',
    );
    await staffMember('platform_admin', 'other.admin@adiutor.test');
    const manager = await staffMember('manager', 'sam@adiutor.test');

    await changeStaffRole(ctx, actor, { userId: manager, role: 'platform_admin' });

    await sendQueuedEmails(ctx);
    const told = sent
      .filter((email) => email.to.endsWith('.admin@adiutor.test'))
      .map((email) => [email.to, emailLanguage(email)])
      .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''));
    expect(told).toEqual([
      ['dutch.admin@adiutor.test', 'nl-NL'],
      ['other.admin@adiutor.test', 'en-US'],
    ]);
  });

  it('is emailed when an invitation or invite link makes someone a staff Admin', async () => {
    const actor = await freshAdmin();
    await staffMember('platform_admin', 'other.admin@adiutor.test');

    await inviteByEmail(ctx, actor, {
      companyId: null,
      email: 'invited@adiutor.test',
      role: 'platform_admin',
    });
    const token = tokenFrom(defined(sent.at(-1), 'the last email'));
    sent.length = 0;
    await acceptInvitationWithNewAccount(ctx, token, {
      name: 'Invited Admin',
      password: 'invited-admin-password',
    });
    expect(await toldAdmins()).toEqual(['other.admin@adiutor.test']);
    expect(sent.find((email) => email.to === 'other.admin@adiutor.test')?.text).toContain(
      'accepted fresh.admin’s invitation',
    );

    const { url } = await createInviteLink(ctx, actor, {
      companyId: null,
      role: 'platform_admin',
      validDays: 7,
    });
    const joinerId = await createUser(db, 'joiner@adiutor.test');
    sent.length = 0;
    await joinWithInviteLink(ctx, defined(url.split('/').at(-1), 'the link token'), {
      id: joinerId,
      email: 'joiner@adiutor.test',
      platformRole: null,
    });
    expect(await toldAdmins()).toEqual(['invited@adiutor.test', 'other.admin@adiutor.test']);
  });

  it('isn’t emailed for other staff roles', async () => {
    const actor = await freshAdmin();
    await staffMember('platform_admin', 'other.admin@adiutor.test');
    const outsider = await createUser(db, 'outsider@adiutor.test');

    await changeStaffRole(ctx, actor, { userId: outsider, role: 'manager' });

    expect(await toldAdmins()).toEqual([]);
  });
});
