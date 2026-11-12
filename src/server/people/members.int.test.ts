/**
 * @file Integration tests for member management and staff access, also when
 * the actor's own rights change while their request is under way; the
 * invitations of removed members, the security emails members get, and the
 * limit on role changes.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseTransaction } from '@/db';
import {
  auditEvent,
  company,
  invitation,
  inviteLink,
  membership,
  session,
  user,
} from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  atTheSameMoment,
  createCompany,
  createSession,
  createStaffSettings,
  createUser,
  emailLanguage,
  fillRateLimitBucket,
  inLanguage,
  inSequence,
  memberActor,
  rateLimitHits,
  sendQueuedEmails,
  setupTestContext,
  setUserLocale,
  staffActor,
  tokenFrom,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { RATE_LIMITS } from '../rate-limit';
import { acceptInvitation, inviteByEmail } from './invitations';
import { createInviteLink } from './invite-links';
import {
  addMember,
  changeMemberRole,
  listAddableCompanies,
  listMembers,
  removeMember,
} from './members';
import { deactivateUser, deleteUser, soleAdminOf } from './user-admin';

const { ctx, db, sent } = setupTestContext();

let testCompany: Awaited<ReturnType<typeof createCompany>>;
let companyAdmin: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  testCompany = await createCompany(db);
  companyAdmin = await memberActor(db, testCompany.id, 'admin');
});

/**
 * Finds a member's membership ID by user ID.
 *
 * @param actor - Someone allowed to list members.
 * @param companyId - The company.
 * @param userId - The member's user ID.
 * @returns The membership ID.
 */
async function membershipOf(actor: Actor, companyId: string, userId: string): Promise<string> {
  const members = (await listMembers(ctx, actor, companyId)).items;
  return defined(
    members.find((member) => member.userId === userId),
    'the member',
  ).id;
}

describe('last admin guard', () => {
  it('refuses removing or demoting the only admin', async () => {
    const id = await membershipOf(companyAdmin, testCompany.id, companyAdmin.id);
    await expect(
      removeMember(ctx, companyAdmin, { companyId: testCompany.id, membershipId: id }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      changeMemberRole(ctx, companyAdmin, {
        companyId: testCompany.id,
        membershipId: id,
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets one admin go when another remains, but never both at once', async () => {
    const second = await memberActor(db, testCompany.id, 'admin');
    const firstId = await membershipOf(companyAdmin, testCompany.id, companyAdmin.id);
    const secondId = await membershipOf(companyAdmin, testCompany.id, second.id);

    const results = await Promise.allSettled([
      removeMember(ctx, companyAdmin, { companyId: testCompany.id, membershipId: secondId }),
      removeMember(ctx, second, { companyId: testCompany.id, membershipId: firstId }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const remaining = (await listMembers(ctx, await staffActor(db, 'support'), testCompany.id))
      .items;
    expect(remaining.filter((member) => member.role === 'admin')).toHaveLength(1);
  });
});

describe('last admin guard at the same moment', () => {
  /** The company's second admin. */
  let secondAdmin: Actor;
  /** A staff Admin, who may deactivate and delete accounts and manage any company's members. */
  let staffAdmin: Actor;

  beforeEach(async () => {
    secondAdmin = await memberActor(db, testCompany.id, 'admin');
    staffAdmin = await staffActor(db, 'platform_admin');
  });

  /**
   * Deactivates a user in a transaction that's held open, the way
   * `deactivateUser` does: the locking last-Admin check, then the update.
   *
   * @param tx - The held transaction.
   * @param userId - The user.
   */
  async function deactivateIn(tx: DatabaseTransaction, userId: string): Promise<void> {
    expect(await soleAdminOf(tx, userId)).toEqual({ staff: false, companies: [] });
    await tx.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));
  }

  /**
   * Lists the company's admins who can still sign in.
   *
   * @returns Their user IDs.
   */
  async function activeAdmins(): Promise<string[]> {
    const rows = await db
      .select({ userId: membership.userId })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        and(
          eq(membership.companyId, testCompany.id),
          eq(membership.role, 'admin'),
          isNull(user.deactivatedAt),
        ),
      );
    return rows.map((row) => row.userId);
  }

  /** The refusal for the last admin, from the account actions. */
  const SOLE_ADMIN = expect.objectContaining({
    code: 'conflict',
    key: 'errors.soleAdmin.user.companies',
    values: { companies: 'Adiutor Tests' },
  });

  it('refuses the second of two admins deactivated at once', async () => {
    const { second } = await atTheSameMoment(
      db,
      (tx) => deactivateIn(tx, companyAdmin.id),
      () => deactivateUser(ctx, staffAdmin, secondAdmin.id),
    );

    expect(second).toMatchObject({ status: 'rejected', reason: SOLE_ADMIN });
    expect(await activeAdmins()).toEqual([secondAdmin.id]);
  });

  it('refuses demoting or removing an admin while the other is being deactivated', async () => {
    const secondId = await membershipOf(companyAdmin, testCompany.id, secondAdmin.id);
    const lastAdmin = expect.objectContaining({
      code: 'conflict',
      key: 'errors.members.lastAdmin',
    });

    const demoted = await atTheSameMoment(
      db,
      (tx) => deactivateIn(tx, companyAdmin.id),
      () =>
        changeMemberRole(ctx, staffAdmin, {
          companyId: testCompany.id,
          membershipId: secondId,
          role: 'client',
        }),
    );
    expect(demoted.second).toMatchObject({ status: 'rejected', reason: lastAdmin });
    await expect(
      removeMember(ctx, staffAdmin, { companyId: testCompany.id, membershipId: secondId }),
    ).rejects.toEqual(lastAdmin);
    expect(await activeAdmins()).toEqual([secondAdmin.id]);
  });

  it('refuses deleting an admin while the other is being deactivated', async () => {
    const { second } = await atTheSameMoment(
      db,
      (tx) => deactivateIn(tx, secondAdmin.id),
      () => deleteUser(ctx, staffAdmin, companyAdmin.id, companyAdmin.email),
    );

    expect(second).toMatchObject({ status: 'rejected', reason: SOLE_ADMIN });
    expect(await activeAdmins()).toEqual([companyAdmin.id]);
  });

  it('refuses a change in a company deactivated while the change was under way', async () => {
    const member = await memberActor(db, testCompany.id, 'client');
    const id = await membershipOf(companyAdmin, testCompany.id, member.id);

    const { second } = await atTheSameMoment(
      db,
      (tx) =>
        tx.update(company).set({ deactivatedAt: new Date() }).where(eq(company.id, testCompany.id)),
      // It reads the company as active before it starts, then waits for the company's row.
      () =>
        changeMemberRole(ctx, staffAdmin, {
          companyId: testCompany.id,
          membershipId: id,
          role: 'watcher',
        }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'invalid',
        key: 'errors.companyDeactivated',
      }),
    });
    const unchanged = firstRow(
      await db.select({ role: membership.role }).from(membership).where(eq(membership.id, id)),
      'the membership',
    );
    expect(unchanged.role).toBe('client');
  });
});

describe('your own role', () => {
  it('can be lowered by an Admin when another Admin remains', async () => {
    await memberActor(db, testCompany.id, 'admin');
    const ownId = await membershipOf(companyAdmin, testCompany.id, companyAdmin.id);

    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: ownId,
      role: 'watcher',
    });

    const own = firstRow(
      await db.select({ role: membership.role }).from(membership).where(eq(membership.id, ownId)),
      'their membership',
    );
    expect(own.role).toBe('watcher');
    // They made the change themselves, so nobody is emailed about it.
    await sendQueuedEmails(ctx);
    expect(sent).toEqual([]);
  });

  it("can't be raised, even by staff who may manage the company's members", async () => {
    await inSequence(
      [
        ['manager', 'client', 'admin'],
        ['platform_admin', 'watcher', 'client'],
      ] as const,
      async ([staffRole, from, to]) => {
        const staff = await staffActor(db, staffRole);
        await addMember(ctx, staff, { companyId: testCompany.id, userId: staff.id, role: from });
        const ownId = await membershipOf(staff, testCompany.id, staff.id);

        await expect(
          changeMemberRole(ctx, staff, {
            companyId: testCompany.id,
            membershipId: ownId,
            role: to,
          }),
        ).rejects.toMatchObject({
          code: 'forbidden',
          key: 'errors.members.selfRaise',
        });
        const own = firstRow(
          await db
            .select({ role: membership.role })
            .from(membership)
            .where(eq(membership.id, ownId)),
          'their membership',
        );
        expect(own.role).toBe(from);
      },
    );
  });
});

describe('rights taken away while the request is under way', () => {
  /** The refusal for an actor whose rights are gone by the time the change is made. */
  const FORBIDDEN = expect.objectContaining({
    code: 'forbidden',
    key: 'errors.forbidden',
  });

  /**
   * Lists the audit actions recorded so far.
   *
   * @returns The actions, oldest first.
   */
  const auditActions = async () =>
    (
      await db.select({ action: auditEvent.action }).from(auditEvent).orderBy(asc(auditEvent.id))
    ).map((row) => row.action);

  it('refuses an Admin\'s "make me Admin" queued behind their demotion', async () => {
    await memberActor(db, testCompany.id, 'admin');
    const ownId = await membershipOf(companyAdmin, testCompany.id, companyAdmin.id);

    const { second } = await atTheSameMoment(
      db,
      // Demoted the way `changeMembership` does it: the company's row first, then the membership.
      async (tx) => {
        await tx
          .select({ id: company.id })
          .from(company)
          .where(eq(company.id, testCompany.id))
          .for('no key update');
        await tx.update(membership).set({ role: 'client' }).where(eq(membership.id, ownId));
      },
      // `companyAdmin` still carries the Admin role it was loaded with, and queues behind it.
      () =>
        changeMemberRole(ctx, companyAdmin, {
          companyId: testCompany.id,
          membershipId: ownId,
          role: 'admin',
        }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'forbidden',
        key: 'errors.members.selfRaise',
      }),
    });
    const own = firstRow(
      await db.select({ role: membership.role }).from(membership).where(eq(membership.id, ownId)),
      'their membership',
    );
    expect(own.role).toBe('client');
    expect(await auditActions()).not.toContain('role_changed');
  });

  it("refuses a Manager removed from the staff, for someone else's role", async () => {
    const manager = await staffActor(db, 'manager');
    const member = await memberActor(db, testCompany.id, 'client');
    const id = await membershipOf(companyAdmin, testCompany.id, member.id);

    const { second } = await atTheSameMoment(
      db,
      (tx) => tx.update(user).set({ platformRole: null }).where(eq(user.id, manager.id)),
      () =>
        changeMemberRole(ctx, manager, {
          companyId: testCompany.id,
          membershipId: id,
          role: 'watcher',
        }),
    );

    expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
    const unchanged = firstRow(
      await db.select({ role: membership.role }).from(membership).where(eq(membership.id, id)),
      'the membership',
    );
    expect(unchanged.role).toBe('client');
  });

  it('refuses adding someone for a Manager removed from the staff', async () => {
    const manager = await staffActor(db, 'manager');
    const jane = await createUser(db, 'jane@adiutor.test');

    const { second } = await atTheSameMoment(
      db,
      (tx) => tx.update(user).set({ platformRole: null }).where(eq(user.id, manager.id)),
      () => addMember(ctx, manager, { companyId: testCompany.id, userId: jane, role: 'admin' }),
    );

    expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
    expect(
      await db.$count(
        membership,
        and(eq(membership.companyId, testCompany.id), eq(membership.userId, jane)),
      ),
    ).toBe(0);
    expect(sent).toEqual([]);
  });

  it('refuses adding an account deactivated at that moment', async () => {
    const manager = await staffActor(db, 'manager');
    const jane = await createUser(db, 'jane@adiutor.test');

    const { second } = await atTheSameMoment(
      db,
      (tx) => tx.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, jane)),
      () => addMember(ctx, manager, { companyId: testCompany.id, userId: jane, role: 'client' }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'invalid',
        key: 'errors.members.accountDeactivated',
      }),
    });
    expect(
      await db.$count(
        membership,
        and(eq(membership.companyId, testCompany.id), eq(membership.userId, jane)),
      ),
    ).toBe(0);
  });
});

describe('staff access to companies', () => {
  it('lets Admins and Managers manage members without being one', async () => {
    const member = await memberActor(db, testCompany.id, 'client');
    const id = await membershipOf(companyAdmin, testCompany.id, member.id);
    await inSequence(['platform_admin', 'manager'] as const, async (role) => {
      const staff = await staffActor(db, role);
      await changeMemberRole(ctx, staff, {
        companyId: testCompany.id,
        membershipId: id,
        role: 'watcher',
      });
    });
    const members = (await listMembers(ctx, companyAdmin, testCompany.id)).items;
    expect(members.find((m) => m.userId === member.id)?.role).toBe('watcher');
  });
});

describe('adding existing users', () => {
  it('adds a user with a role right away, emails them, and refuses duplicates', async () => {
    const manager = await staffActor(db, 'manager');
    const jane = await createUser(db, 'jane@adiutor.test');

    expect(await listAddableCompanies(ctx, manager, jane)).toEqual([
      expect.objectContaining({ id: testCompany.id }),
    ]);
    await addMember(ctx, manager, { companyId: testCompany.id, userId: jane, role: 'watcher' });

    expect(
      (await listMembers(ctx, manager, testCompany.id)).items.find((m) => m.userId === jane)?.role,
    ).toBe('watcher');
    await sendQueuedEmails(ctx);
    expect(sent.at(-1)).toMatchObject({
      to: 'jane@adiutor.test',
      subject: expect.stringContaining('You were added to'),
    });
    expect(await listAddableCompanies(ctx, manager, jane)).toEqual([]);
    await expect(
      addMember(ctx, manager, { companyId: testCompany.id, userId: jane, role: 'client' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('tells someone added in the language they saved, not the adder’s', async () => {
    const manager = await staffActor(db, 'manager');
    const jane = await createUser(db, 'jane@adiutor.test');
    await setUserLocale(db, jane, 'es-ES');

    await addMember(inLanguage(ctx, 'nl-NL'), manager, {
      companyId: testCompany.id,
      userId: jane,
      role: 'client',
    });

    await sendQueuedEmails(ctx);
    const added = defined(sent.at(-1), 'the email to Jane');
    expect(emailLanguage(added)).toBe('es-ES');
    expect(added.subject).toBe(`Te han añadido a ${testCompany.name} en Adiutor`);
    expect(added.text).toContain('como Cliente.');
  });

  it('lets staff Admins and Managers add themselves, like anyone else', async () => {
    await inSequence(['platform_admin', 'manager'] as const, async (role) => {
      const staff = await staffActor(db, role, `self-${role}@adiutor.test`);
      // Signed in without a second step: their staff role required MFA already, so becoming a
      // company Admin as well ends none of their sessions (`withMfaPromotion`).
      const device = await createSession(db, staff.id);

      expect(await listAddableCompanies(ctx, staff, staff.id)).toEqual([
        expect.objectContaining({ id: testCompany.id }),
      ]);
      await addMember(ctx, staff, { companyId: testCompany.id, userId: staff.id, role: 'admin' });

      expect(
        await db
          .select({ role: membership.role })
          .from(membership)
          .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, staff.id))),
      ).toEqual([{ role: 'admin' }]);
      // Recorded as their own doing, and nothing else: no sign-out.
      expect(
        await db
          .select({
            action: auditEvent.action,
            actorUserId: auditEvent.actorUserId,
            companyId: auditEvent.companyId,
            details: auditEvent.details,
          })
          .from(auditEvent)
          .where(eq(auditEvent.targetUserId, staff.id))
          .orderBy(asc(auditEvent.id)),
      ).toEqual([
        {
          action: 'member_added',
          actorUserId: staff.id,
          companyId: testCompany.id,
          details: { role: 'admin' },
        },
      ]);
      expect(
        await db.select({ id: session.id }).from(session).where(eq(session.userId, staff.id)),
      ).toEqual([{ id: device }]);
      // The email still goes to their own address, so it doubles as a notice.
      await sendQueuedEmails(ctx);
      expect(sent.filter((email) => email.to === staff.email)).toEqual([
        expect.objectContaining({
          subject: `You were added to ${testCompany.name} on Adiutor`,
        }),
      ]);
      expect(await listAddableCompanies(ctx, staff, staff.id)).toEqual([]);
    });
  });

  it('refuses staff roles and deactivated companies', async () => {
    const manager = await staffActor(db, 'manager');
    const jane = await createUser(db, 'jane@adiutor.test');
    await expect(
      addMember(ctx, manager, { companyId: testCompany.id, userId: jane, role: 'manager' }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'validation.companyRole' })],
    });

    const closed = await createCompany(db, { deactivated: true });
    await expect(
      addMember(ctx, manager, { companyId: closed.id, userId: jane, role: 'client' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses deactivated accounts', async () => {
    const outsider = await createUser(db, 'outsider@adiutor.test');
    const manager = await staffActor(db, 'manager');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, outsider));
    await expect(
      addMember(ctx, manager, { companyId: testCompany.id, userId: outsider, role: 'client' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('treats a malformed user ID as unknown', async () => {
    const manager = await staffActor(db, 'manager');
    await expect(listAddableCompanies(ctx, manager, 'not-a-uuid')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('changing members safely', () => {
  it("doesn't count a deactivated admin as the company's admin", async () => {
    const second = await memberActor(db, testCompany.id, 'admin');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, second.id));
    const id = await membershipOf(companyAdmin, testCompany.id, companyAdmin.id);
    await expect(
      changeMemberRole(ctx, companyAdmin, {
        companyId: testCompany.id,
        membershipId: id,
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Removing the deactivated one is fine.
    const manager = await staffActor(db, 'manager');
    await removeMember(ctx, manager, {
      companyId: testCompany.id,
      membershipId: await membershipOf(manager, testCompany.id, second.id),
    });
  });

  it('refuses changes in a deactivated company', async () => {
    const manager = await staffActor(db, 'manager');
    const member = await memberActor(db, testCompany.id, 'client');
    const id = await membershipOf(manager, testCompany.id, member.id);
    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    await expect(
      changeMemberRole(ctx, manager, {
        companyId: testCompany.id,
        membershipId: id,
        role: 'watcher',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      removeMember(ctx, manager, { companyId: testCompany.id, membershipId: id }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it("revokes a demoted admin's open invitations and links for the company", async () => {
    const second = await memberActor(db, testCompany.id, 'admin');
    await inviteByEmail(ctx, second, {
      companyId: testCompany.id,
      email: 'later@adiutor.test',
      role: 'client',
    });
    await createInviteLink(ctx, second, {
      companyId: testCompany.id,
      role: 'admin',
      validDays: 30,
    });

    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, second.id),
      role: 'watcher',
    });

    const openInvitations = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.invitedBy, second.id), isNull(invitation.revokedAt)));
    const openLinks = await db
      .select()
      .from(inviteLink)
      .where(and(eq(inviteLink.createdBy, second.id), isNull(inviteLink.revokedAt)));
    expect(openInvitations).toEqual([]);
    expect(openLinks).toEqual([]);
  });
});

describe('removed members and their invitations', () => {
  it('revokes the open invitations to the company addressed to them, not other companies’', async () => {
    const other = await createCompany(db, { name: 'Adiutor Tests Other' });
    const otherAdmin = await memberActor(db, other.id, 'admin');
    const manager = await staffActor(db, 'manager');
    // Invited as Admin, then added directly as Watcher before accepting: the invitation stays.
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'erin@adiutor.test',
      role: 'admin',
    });
    const token = tokenFrom(defined(sent.at(-1), 'the last email'));
    await inviteByEmail(ctx, otherAdmin, {
      companyId: other.id,
      email: 'erin@adiutor.test',
      role: 'client',
    });
    const erin = await createUser(db, 'erin@adiutor.test');
    await addMember(ctx, manager, { companyId: testCompany.id, userId: erin, role: 'watcher' });

    await removeMember(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, erin),
    });

    const open = await db
      .select({ companyId: invitation.companyId })
      .from(invitation)
      .where(and(eq(invitation.email, 'erin@adiutor.test'), isNull(invitation.revokedAt)));
    expect(open).toEqual([{ companyId: other.id }]);
    // So the old invitation can't bring them back, as Admin.
    expect(
      await acceptInvitation(ctx, token, {
        id: erin,
        email: 'erin@adiutor.test',
        platformRole: null,
      }),
    ).toEqual({ status: 'invalid' });
    expect(
      await db
        .select({ companyId: auditEvent.companyId, details: auditEvent.details })
        .from(auditEvent)
        .where(eq(auditEvent.action, 'invitation_revoked')),
    ).toEqual([
      {
        companyId: testCompany.id,
        details: {
          automatic: true,
          reason: 'member_removed',
          email: 'erin@adiutor.test',
          invitations: 1,
        },
      },
    ]);
  });

  it('keeps their invitations when only their role changes', async () => {
    const erin = await memberActor(db, testCompany.id, 'client', 'erin@adiutor.test');
    await db.insert(invitation).values({
      companyId: testCompany.id,
      email: erin.email,
      role: 'admin',
      tokenHash: 'adiutor-tests-token-hash',
      invitedBy: companyAdmin.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, erin.id),
      role: 'watcher',
    });

    expect(
      await db.$count(
        invitation,
        and(eq(invitation.email, erin.email), isNull(invitation.revokedAt)),
      ),
    ).toBe(1);
  });
});

describe('security emails to members', () => {
  /** A request from a known browser and IP address: the actor's, never shown to the member. */
  const fromBrowser = {
    ...ctx,
    /**
     * Pretends the request came from a known browser and IP address.
     *
     * @returns The request info.
     */
    requestInfo: async () => ({ ip: '203.0.113.9', userAgent: 'Firefox' }),
  };

  it('tells a member their role changed, and that they were removed, without a device or IP address', async () => {
    const erin = await memberActor(db, testCompany.id, 'client', 'erin@adiutor.test');
    const id = await membershipOf(companyAdmin, testCompany.id, erin.id);

    await changeMemberRole(fromBrowser, companyAdmin, {
      companyId: testCompany.id,
      membershipId: id,
      role: 'watcher',
    });
    await removeMember(fromBrowser, companyAdmin, { companyId: testCompany.id, membershipId: id });

    await sendQueuedEmails(ctx);
    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'erin@adiutor.test', subject: 'Your role in Adiutor Tests on Adiutor changed' },
      { to: 'erin@adiutor.test', subject: 'You were removed from Adiutor Tests on Adiutor' },
    ]);
    const changed = defined(sent[0], 'the role change email');
    const removed = defined(sent[1], 'the removal email');
    expect(changed.text).toContain('Your role in Adiutor Tests on Adiutor was changed to Watcher.');
    expect(removed.text).toContain('You were removed from Adiutor Tests on Adiutor');
    sent.forEach((email) => {
      expect(email.text).not.toContain('From:');
      expect(email.text).not.toContain('203.0.113.9');
      expect(email.text).not.toContain('Firefox');
    });
  });

  it("doesn't email about a role they already have, nor someone removing themselves", async () => {
    const client = await memberActor(db, testCompany.id, 'client');
    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, client.id),
      role: 'client',
    });
    // Another Admin, so the first may leave.
    await memberActor(db, testCompany.id, 'admin');
    await removeMember(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, companyAdmin.id),
    });

    await sendQueuedEmails(ctx);
    expect(sent).toEqual([]);
  });

  it('refuses a staff role for a member, changing nothing', async () => {
    const client = await memberActor(db, testCompany.id, 'client');
    const membershipId = await membershipOf(companyAdmin, testCompany.id, client.id);

    await expect(
      changeMemberRole(ctx, companyAdmin, {
        companyId: testCompany.id,
        membershipId,
        role: 'manager',
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'validation.companyRole' })],
    });

    const row = firstRow(
      await db
        .select({ role: membership.role })
        .from(membership)
        .where(eq(membership.id, membershipId)),
      'the membership',
    );
    expect(row.role).toBe('client');
  });

  it('changes and records nothing for the role they already have', async () => {
    const client = await memberActor(db, testCompany.id, 'client');
    const otherAdmin = await memberActor(db, testCompany.id, 'admin');

    // E.g. chosen on a page opened before someone else made the change.
    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, client.id),
      role: 'client',
    });
    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, otherAdmin.id),
      role: 'admin',
    });

    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'role_changed'))).toEqual(
      [],
    );
    await sendQueuedEmails(ctx);
    expect(sent).toEqual([]);
  });

  it('sends nothing when the change is refused', async () => {
    const id = await membershipOf(companyAdmin, testCompany.id, companyAdmin.id);
    const manager = await staffActor(db, 'manager');
    // The last Admin: refused inside the transaction, once the company's row is locked.
    await expect(
      removeMember(ctx, manager, { companyId: testCompany.id, membershipId: id }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      changeMemberRole(ctx, manager, {
        companyId: testCompany.id,
        membershipId: id,
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // An actor whose rights are gone by the time the change is made.
    const client = await memberActor(db, testCompany.id, 'client');
    await db.update(user).set({ platformRole: null }).where(eq(user.id, manager.id));
    await expect(
      changeMemberRole(ctx, manager, {
        companyId: testCompany.id,
        membershipId: await membershipOf(companyAdmin, testCompany.id, client.id),
        role: 'watcher',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await sendQueuedEmails(ctx);
    expect(sent).toEqual([]);
  });
});

describe('the limit on role changes', () => {
  /**
   * The bucket counting someone's role changes.
   *
   * @param actor - Who makes them.
   * @returns The bucket's key.
   */
  const bucketOf = (actor: Actor) => `role-change:user:${actor.id}`;

  it('counts each role change against the Admin who makes it', async () => {
    const client = await memberActor(db, testCompany.id, 'client');

    await changeMemberRole(ctx, companyAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(companyAdmin, testCompany.id, client.id),
      role: 'watcher',
    });

    expect(await rateLimitHits(db, bucketOf(companyAdmin))).toBe(1);
  });

  it('refuses role changes past it, changing and emailing nothing, but still allows removals', async () => {
    const client = await memberActor(db, testCompany.id, 'client', 'erin@adiutor.test');
    const id = await membershipOf(companyAdmin, testCompany.id, client.id);
    await fillRateLimitBucket(db, bucketOf(companyAdmin), RATE_LIMITS.roleChangesPerUser.limit);

    await expect(
      changeMemberRole(ctx, companyAdmin, {
        companyId: testCompany.id,
        membershipId: id,
        role: 'watcher',
      }),
    ).rejects.toMatchObject({ code: 'rate_limited', key: 'errors.tooManyAttempts' });
    const row = firstRow(
      await db.select({ role: membership.role }).from(membership).where(eq(membership.id, id)),
      'the membership',
    );
    expect(row.role).toBe('client');
    await sendQueuedEmails(ctx);
    expect(sent).toEqual([]);

    // A removal can't be repeated without a new invitation, so it isn't limited.
    await removeMember(ctx, companyAdmin, { companyId: testCompany.id, membershipId: id });
    await sendQueuedEmails(ctx);
    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'erin@adiutor.test', subject: 'You were removed from Adiutor Tests on Adiutor' },
    ]);
  });

  it("is each Admin's own: another Admin can still change roles", async () => {
    const otherAdmin = await memberActor(db, testCompany.id, 'admin');
    const client = await memberActor(db, testCompany.id, 'client');
    await fillRateLimitBucket(db, bucketOf(companyAdmin), RATE_LIMITS.roleChangesPerUser.limit);

    await changeMemberRole(ctx, otherAdmin, {
      companyId: testCompany.id,
      membershipId: await membershipOf(otherAdmin, testCompany.id, client.id),
      role: 'watcher',
    });

    expect(await rateLimitHits(db, bucketOf(otherAdmin))).toBe(1);
  });

  it("doesn't count for someone who may not change roles", async () => {
    const watcher = await memberActor(db, testCompany.id, 'watcher');

    await expect(
      changeMemberRole(ctx, watcher, {
        companyId: testCompany.id,
        membershipId: await membershipOf(companyAdmin, testCompany.id, companyAdmin.id),
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect(await rateLimitHits(db, bucketOf(watcher))).toBeNull();
  });
});

describe('listMembers sorting and paging', () => {
  /** A company of its own, apart from the shared one, so these tests control every member. */
  let team: Awaited<ReturnType<typeof createCompany>>;
  /** Staff who may view the members of any company. */
  let viewer: Actor;

  beforeEach(async () => {
    team = await createCompany(db, { name: 'Adiutor Tests Team' });
    viewer = await staffActor(db, 'support');
  });

  /**
   * The people the sort tests add, named by the part of their email before the
   * `@`. Their names, last activity and join dates each order them differently:
   * by name 'amy' (cal), 'Bob' (dee), 'cara' (bea), then the two without a name by
   * email (eve, fay).
   */
  const people = [
    { key: 'bea', name: 'cara', lastActive: null, joined: '2020-03-01T00:00:00Z' },
    { key: 'cal', name: 'amy', lastActive: '2026-05-01T00:00:00Z', joined: '2020-01-01T00:00:00Z' },
    { key: 'dee', name: 'Bob', lastActive: '2026-06-01T00:00:00Z', joined: '2020-02-01T00:00:00Z' },
    { key: 'eve', name: '', lastActive: '2026-04-01T00:00:00Z', joined: '2020-04-01T00:00:00Z' },
    { key: 'fay', name: '   ', lastActive: null, joined: '2020-05-01T00:00:00Z' },
  ] as const;

  /**
   * Adds {@link people} to the team, one at a time (so their accounts are created in this order,
   * not the order of their join dates), with their names, last activity and join dates set.
   */
  async function addPeople(): Promise<void> {
    await inSequence(people, async (person) => {
      const member = await memberActor(db, team.id, 'client', `${person.key}@adiutor.test`);
      await db
        .update(user)
        .set({
          name: person.name,
          lastActiveAt: person.lastActive ? new Date(person.lastActive) : null,
        })
        .where(eq(user.id, member.id));
      await db
        .update(membership)
        .set({ createdAt: new Date(person.joined) })
        .where(and(eq(membership.companyId, team.id), eq(membership.userId, member.id)));
    });
  }

  /**
   * Lists the team's members in an order.
   *
   * @param options - Sort and page.
   * @returns The part of each member's email before the `@`, in order.
   */
  async function order(options: Parameters<typeof listMembers>[3] = {}): Promise<string[]> {
    const { items } = await listMembers(ctx, viewer, team.id, options);
    return items.map((member) => defined(member.email.split('@')[0], 'the part before the @'));
  }

  it('sorts by the name shown, ignoring case, with a missing name sorting by email', async () => {
    await addPeople();

    // Name A to Z is the default; 'eve' and 'fay' have no name and sort as their emails do.
    expect(await order()).toEqual(['cal', 'dee', 'bea', 'eve', 'fay']);
    expect(await order({ sort: 'name', dir: 'asc' })).toEqual(['cal', 'dee', 'bea', 'eve', 'fay']);
    expect(await order({ sort: 'name', dir: 'desc' })).toEqual(['fay', 'eve', 'bea', 'dee', 'cal']);
  });

  it('sorts by email in both directions', async () => {
    await addPeople();

    expect(await order({ sort: 'email' })).toEqual(['bea', 'cal', 'dee', 'eve', 'fay']);
    expect(await order({ sort: 'email', dir: 'desc' })).toEqual([
      'fay',
      'eve',
      'dee',
      'cal',
      'bea',
    ]);
  });

  it('sorts by last activity, most recent first by default, with never active last', async () => {
    await addPeople();

    const mostRecent = await order({ sort: 'last-active' });
    expect(mostRecent.slice(0, 3)).toEqual(['dee', 'cal', 'eve']);
    expect(mostRecent.slice(3).sort()).toEqual(['bea', 'fay']);

    // The other way round, those who never were active come first.
    const leastRecent = await order({ sort: 'last-active', dir: 'asc' });
    expect(leastRecent.slice(0, 2).sort()).toEqual(['bea', 'fay']);
    expect(leastRecent.slice(2)).toEqual(['eve', 'cal', 'dee']);
  });

  it('sorts by when they joined the company, newest first by default', async () => {
    await addPeople();

    expect(await order({ sort: 'joined' })).toEqual(['fay', 'eve', 'bea', 'dee', 'cal']);
    expect(await order({ sort: 'joined', dir: 'asc' })).toEqual([
      'cal',
      'dee',
      'bea',
      'eve',
      'fay',
    ]);
    const newest = firstRow(
      (await listMembers(ctx, viewer, team.id, { sort: 'joined' })).items,
      'the newest member',
    );
    expect(newest.createdAt).toEqual(new Date('2020-05-01T00:00:00Z'));
  });

  it('gives exactly the reverse order for the other direction of every sort', async () => {
    await addPeople();

    await inSequence(['name', 'email', 'last-active', 'joined'] as const, async (sort) => {
      const ascending = await order({ sort, dir: 'asc' });
      expect(await order({ sort, dir: 'desc' })).toEqual([...ascending].reverse());
    });
  });

  it('shows 25 members a page, counting all of them, and the last page for one past it', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        memberActor(
          db,
          team.id,
          'client',
          `member${String(index + 1).padStart(2, '0')}@adiutor.test`,
        ),
      ),
    );

    const first = await listMembers(ctx, viewer, team.id);
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first member').email).toBe('member01@adiutor.test');

    const second = await listMembers(ctx, viewer, team.id, { page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2, size: 25 });
    expect(second.items.map((member) => member.email)).toEqual([
      'member26@adiutor.test',
      'member27@adiutor.test',
      'member28@adiutor.test',
      'member29@adiutor.test',
      'member30@adiutor.test',
    ]);
    // No member is on both pages.
    expect(new Set([...first.items, ...second.items].map((member) => member.userId)).size).toBe(30);

    const past = await listMembers(ctx, viewer, team.id, { page: 99 });
    expect(past).toMatchObject({ total: 30, page: 2 });
    expect(past.items.map((member) => member.userId)).toEqual(
      second.items.map((member) => member.userId),
    );

    const fifty = await listMembers(ctx, viewer, team.id, { size: 50 });
    expect(fifty).toMatchObject({ total: 30, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(30);
  });

  it("counts only the company's own members", async () => {
    const shared = await memberActor(db, team.id, 'client', 'amy@adiutor.test');
    // The shared company's admin is in the team as well.
    await db
      .insert(membership)
      .values({ companyId: team.id, userId: companyAdmin.id, role: 'client' });

    const inTeam = await listMembers(ctx, viewer, team.id);
    expect(inTeam.total).toBe(2);
    expect(inTeam.items.map((member) => member.userId).sort()).toEqual(
      [shared.id, companyAdmin.id].sort(),
    );
    const inShared = await listMembers(ctx, viewer, testCompany.id);
    expect(inShared.total).toBe(1);
    expect(inShared.items.map((member) => member.userId)).toEqual([companyAdmin.id]);
  });
});
