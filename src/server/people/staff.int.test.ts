/**
 * @file Integration tests for staff: its name, its people, joining it by
 * invitation or invite link, the invitations of people taken off it, and the
 * limit on role changes, against the test database.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { auditEvent, invitation, inviteLink, staffSettings, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  actorFor,
  atTheSameMoment,
  createCompany,
  createStaffSettings,
  createUser,
  fillRateLimitBucket,
  inSequence,
  memberActor,
  rateLimitHits,
  sendQueuedEmails,
  setupTestContext,
  staffActor,
  tokenFrom,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { RATE_LIMITS } from '../rate-limit';
import {
  acceptInvitation,
  acceptInvitationWithNewAccount,
  getInvitationPreview,
  inviteByEmail,
  listPendingInvitations,
} from './invitations';
import {
  claimInviteLink,
  createInviteLink,
  getInviteLinkPreview,
  joinWithInviteLink,
} from './invite-links';
import {
  changeStaffRole,
  getStaffSettings,
  listStaff,
  removeFromStaff,
  renameStaff,
  setDefaultLocale,
} from './staff';

const { ctx, db, sent } = setupTestContext();

/** Shared fixtures, recreated before each test. */
let admin: Actor;
let manager: Actor;

beforeEach(async () => {
  await createStaffSettings(db, 'Adiutor Tests');
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
  manager = await staffActor(db, 'manager', 'manager@adiutor.test');
});

/**
 * Reads a user's platform role.
 *
 * @param userId - The user.
 * @returns Their role, or `null`.
 */
async function platformRoleOf(userId: string) {
  const [found] = await db
    .select({ role: user.platformRole })
    .from(user)
    .where(eq(user.id, userId));
  return found?.role ?? null;
}

describe('staff settings and people', () => {
  it('renames the staff, recorded in the audit log', async () => {
    await renameStaff(ctx, admin, '  Adiutor Support ');
    expect(await getStaffSettings(ctx, admin)).toEqual({
      name: 'Adiutor Support',
      defaultLocale: 'en-US',
    });
    const entry = firstRow(
      await db.select().from(auditEvent).where(eq(auditEvent.action, 'staff_renamed')),
      'the audit event',
    );
    expect(entry.details).toMatchObject({ from: 'Adiutor Tests', to: 'Adiutor Support' });
  });

  it('creates the settings again when they were lost', async () => {
    await db.delete(staffSettings);
    await renameStaff(ctx, admin, 'Adiutor Support');
    expect(await getStaffSettings(ctx, admin)).toEqual({
      name: 'Adiutor Support',
      defaultLocale: 'en-US',
    });
    const entry = firstRow(
      await db.select().from(auditEvent).where(eq(auditEvent.action, 'staff_renamed')),
      'the audit event',
    );
    expect(entry.details).toMatchObject({ from: null, to: 'Adiutor Support' });
  });

  it("sets Adiutor's default language, keeping the name", async () => {
    await expect(setDefaultLocale(ctx, admin, 'nl-NL')).resolves.toBe('nl-NL');

    expect(await getStaffSettings(ctx, admin)).toEqual({
      name: 'Adiutor Tests',
      defaultLocale: 'nl-NL',
    });
    await expect(setDefaultLocale(ctx, admin, 'fr-FR')).rejects.toThrow('validation.locale');
    expect((await getStaffSettings(ctx, admin)).defaultLocale).toBe('nl-NL');
  });

  it('creates the settings again with the default language when they were lost', async () => {
    await db.delete(staffSettings);

    await setDefaultLocale(ctx, admin, 'es-ES');

    expect(await getStaffSettings(ctx, admin)).toEqual({ name: 'Adiutor', defaultLocale: 'es-ES' });
  });

  it('lists the staff by name, with their role', async () => {
    const testCompany = await createCompany(db);
    await memberActor(db, testCompany.id, 'admin');

    const staff = (await listStaff(ctx, admin)).items;
    expect(staff.map(({ email, role }) => [email, role])).toEqual([
      ['admin@adiutor.test', 'platform_admin'],
      ['manager@adiutor.test', 'manager'],
    ]);
  });

  it('changes roles and removes people, but never the last active Admin', async () => {
    await changeStaffRole(ctx, admin, { userId: manager.id, role: 'support' });
    expect(await platformRoleOf(manager.id)).toBe('support');
    await expect(
      changeStaffRole(ctx, admin, { userId: manager.id, role: 'client' }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'validation.staffRole' })],
    });

    await expect(
      changeStaffRole(ctx, admin, { userId: admin.id, role: 'manager' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(removeFromStaff(ctx, admin, admin.id)).rejects.toMatchObject({ code: 'conflict' });

    // A deactivated second Admin doesn't count.
    const other = await staffActor(db, 'platform_admin');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, other.id));
    await expect(removeFromStaff(ctx, admin, admin.id)).rejects.toMatchObject({ code: 'conflict' });

    await removeFromStaff(ctx, admin, manager.id);
    expect(await platformRoleOf(manager.id)).toBeNull();
    expect(await db.select().from(user).where(eq(user.id, manager.id))).toHaveLength(1);
  });

  it('lets people lower their own role, but never raise it', async () => {
    // Another active Admin, so stepping down doesn't hit the last-Admin rule.
    await staffActor(db, 'platform_admin');
    await changeStaffRole(ctx, admin, { userId: admin.id, role: 'manager' });
    expect(await platformRoleOf(admin.id)).toBe('manager');

    // `admin` still carries its rights from before the demotion (a request already under way),
    // yet it can't give itself the Admin role back.
    await expect(
      changeStaffRole(ctx, admin, { userId: admin.id, role: 'platform_admin' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.staff.selfRaise',
    });
    expect(await platformRoleOf(admin.id)).toBe('manager');

    // As a Manager it can't change staff roles at all, its own included: only its row counts.
    await expect(
      changeStaffRole(ctx, admin, { userId: admin.id, role: 'support' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.forbidden',
    });
    await expect(removeFromStaff(ctx, admin, admin.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await platformRoleOf(admin.id)).toBe('manager');
  });

  it('refuses an Admin demoted while their request was under way, for anyone’s role', async () => {
    // Another active Admin, so the demotion below is allowed.
    await staffActor(db, 'platform_admin');

    const { second } = await atTheSameMoment(
      db,
      // The demotion commits only once the request below is waiting for it.
      (tx) => tx.update(user).set({ platformRole: 'manager' }).where(eq(user.id, admin.id)),
      // `admin` still carries the rights it was loaded with before the demotion.
      () => changeStaffRole(ctx, admin, { userId: manager.id, role: 'support' }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'forbidden',
        key: 'errors.forbidden',
      }),
    });
    expect(await platformRoleOf(manager.id)).toBe('manager');
    expect(await db.select().from(auditEvent).where(eq(auditEvent.action, 'role_changed'))).toEqual(
      [],
    );
  });

  it('refuses an Admin taken off the staff while their request was under way', async () => {
    // Another active Admin, so taking `admin` off the staff below is allowed.
    await staffActor(db, 'platform_admin');

    const { second } = await atTheSameMoment(
      db,
      (tx) => tx.update(user).set({ platformRole: null }).where(eq(user.id, admin.id)),
      () => removeFromStaff(ctx, admin, manager.id),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'forbidden' }),
    });
    expect(await platformRoleOf(manager.id)).toBe('manager');
  });

  it('refuses a deactivated Admin whose request was already under way', async () => {
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, admin.id));
    await expect(
      changeStaffRole(ctx, admin, { userId: manager.id, role: 'support' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await platformRoleOf(manager.id)).toBe('manager');
  });
});

describe('granting staff access', () => {
  it('makes a user staff, changes and removes the role, emailing them each time', async () => {
    const userId = await createUser(db, 'client.person@adiutor.test');

    await changeStaffRole(ctx, admin, { userId, role: 'support' });
    expect(await platformRoleOf(userId)).toBe('support');
    await changeStaffRole(ctx, admin, { userId, role: 'finance' });
    expect(await platformRoleOf(userId)).toBe('finance');
    await removeFromStaff(ctx, admin, userId);
    expect(await platformRoleOf(userId)).toBeNull();

    await sendQueuedEmails(ctx);
    expect(sent.map((email) => email.subject)).toEqual([
      'You now have staff access to Adiutor',
      'Your Adiutor staff role changed',
      'Your Adiutor staff access was removed',
    ]);
    const actions = await db
      .select({ action: auditEvent.action })
      .from(auditEvent)
      .where(eq(auditEvent.targetUserId, userId))
      .orderBy(auditEvent.at);
    expect(actions.map(({ action }) => action)).toEqual([
      'member_added',
      'role_changed',
      'member_removed',
    ]);
    await expect(removeFromStaff(ctx, admin, userId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('the limit on staff role changes', () => {
  /**
   * The bucket counting the Admin's role changes, company and staff together.
   *
   * @returns The bucket's key.
   */
  const bucket = () => `role-change:user:${admin.id}`;

  it('counts making someone staff and changing their role, not removing them', async () => {
    const userId = await createUser(db, 'client.person@adiutor.test');

    await changeStaffRole(ctx, admin, { userId, role: 'support' });
    await changeStaffRole(ctx, admin, { userId, role: 'finance' });
    await removeFromStaff(ctx, admin, userId);

    expect(await rateLimitHits(db, bucket())).toBe(2);
  });

  it('refuses making someone staff or changing a role past it, but still allows removals', async () => {
    const userId = await createUser(db, 'client.person@adiutor.test');
    await fillRateLimitBucket(db, bucket(), RATE_LIMITS.roleChangesPerUser.limit);

    await expect(changeStaffRole(ctx, admin, { userId, role: 'support' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await expect(
      changeStaffRole(ctx, admin, { userId: manager.id, role: 'support' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await platformRoleOf(userId)).toBeNull();
    expect(await platformRoleOf(manager.id)).toBe('manager');
    await sendQueuedEmails(ctx);
    expect(sent).toEqual([]);

    await removeFromStaff(ctx, admin, manager.id);
    expect(await platformRoleOf(manager.id)).toBeNull();
    await sendQueuedEmails(ctx);
    expect(sent.map((email) => email.subject)).toEqual(['Your Adiutor staff access was removed']);
  });
});

describe('joining the staff by email', () => {
  it('invites, previews with the staff name, and sets the platform role on accepting', async () => {
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'new.staff@adiutor.test',
      role: 'support',
    });
    const invitationEmail = defined(sent[0], 'the invitation email');
    expect(invitationEmail.subject).toBe('admin invited you to join Adiutor Tests on Adiutor');
    const token = tokenFrom(invitationEmail);
    expect(await getInvitationPreview(ctx, token)).toEqual({
      companyName: 'Adiutor Tests',
      role: 'support',
      fromInviteLink: false,
    });
    expect((await listPendingInvitations(ctx, admin, null)).items).toHaveLength(1);

    const result = await acceptInvitationWithNewAccount(ctx, token, {
      name: 'New Staff',
      password: 'new-staff-password',
    });
    expect(result).toMatchObject({ status: 'created', companyId: null });
    const created = firstRow(
      await db.select().from(user).where(eq(user.email, 'new.staff@adiutor.test')),
      'the new user',
    );
    expect(created.platformRole).toBe('support');
  });

  it('refuses company roles', async () => {
    await expect(
      inviteByEmail(ctx, admin, { companyId: null, email: 'x@adiutor.test', role: 'client' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('tells staff when someone is already on the staff, and keeps their role', async () => {
    const { status } = await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'manager@adiutor.test',
      role: 'support',
    });
    expect(status).toBe('already_member');
    expect(await db.select().from(invitation)).toHaveLength(0);
  });

  it('lets an existing company user join the staff with their account', async () => {
    const userId = await createUser(db, 'client.person@adiutor.test');
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'client.person@adiutor.test',
      role: 'finance',
    });
    const result = await acceptInvitation(
      ctx,
      tokenFrom(defined(sent[0], 'the invitation email')),
      {
        id: userId,
        email: 'client.person@adiutor.test',
        platformRole: null,
      },
    );
    expect(result).toEqual({ status: 'joined', companyId: null });
    expect(await platformRoleOf(userId)).toBe('finance');
    expect((await actorFor(db, userId)).platformRole).toBe('finance');
  });
});

describe('joining the staff by invite link', () => {
  it('turns a staff link into an invitation, or joins directly when signed in', async () => {
    const { url } = await createInviteLink(ctx, admin, {
      companyId: null,
      role: 'support',
      validDays: 7,
    });
    const token = defined(url.split('/').at(-1), 'the link token');
    expect(await getInviteLinkPreview(ctx, token)).toEqual({
      companyName: 'Adiutor Tests',
      role: 'support',
    });

    expect(await claimInviteLink(ctx, token, 'linked@adiutor.test')).toEqual({ status: 'sent' });
    await sendQueuedEmails(ctx);
    expect(sent.at(-1)?.to).toBe('linked@adiutor.test');

    const second = await createInviteLink(ctx, admin, {
      companyId: null,
      role: 'manager',
      validDays: 1,
    });
    const userId = await createUser(db, 'direct@adiutor.test');
    const joined = await joinWithInviteLink(
      ctx,
      defined(second.url.split('/').at(-1), 'the link token'),
      {
        id: userId,
        email: 'direct@adiutor.test',
        platformRole: null,
      },
    );
    expect(joined).toEqual({ status: 'joined', companyId: null, signedOut: false });
    expect(await platformRoleOf(userId)).toBe('manager');
  });

  it('refuses company roles on staff links', async () => {
    await expect(
      createInviteLink(ctx, admin, { companyId: null, role: 'watcher', validDays: 7 }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('losing staff rights', () => {
  it('revokes invitations and links for what a former Admin can no longer manage', async () => {
    const second = await staffActor(db, 'platform_admin', 'second@adiutor.test');
    const testCompany = await createCompany(db);
    await createInviteLink(ctx, second, { companyId: null, role: 'platform_admin', validDays: 30 });
    await inviteByEmail(ctx, second, {
      companyId: testCompany.id,
      email: 'company.admin@adiutor.test',
      role: 'admin',
    });

    // As a Manager they still manage companies, but not the staff.
    await changeStaffRole(ctx, admin, { userId: second.id, role: 'manager' });
    expect(await db.select().from(inviteLink).where(isNull(inviteLink.revokedAt))).toEqual([]);
    expect(await db.select().from(invitation).where(isNull(invitation.revokedAt))).toHaveLength(1);

    // Off the staff, they manage nothing.
    await removeFromStaff(ctx, admin, second.id);
    expect(await db.select().from(invitation).where(isNull(invitation.revokedAt))).toEqual([]);
  });

  it('revokes the open staff invitations addressed to someone taken off the staff', async () => {
    const testCompany = await createCompany(db);
    const companyAdmin = await memberActor(db, testCompany.id, 'admin');
    // Invited to the staff as Admin, then given Support directly before accepting.
    await inviteByEmail(ctx, admin, {
      companyId: null,
      email: 'erin@adiutor.test',
      role: 'platform_admin',
    });
    const token = tokenFrom(defined(sent.at(-1), 'the last email'));
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'erin@adiutor.test',
      role: 'client',
    });
    const erin = await createUser(db, 'erin@adiutor.test');
    await changeStaffRole(ctx, admin, { userId: erin, role: 'support' });
    // A role change leaves it open.
    await changeStaffRole(ctx, admin, { userId: erin, role: 'finance' });
    /**
     * Lists the targets of the open invitations addressed to Erin.
     *
     * @returns Their companies, `null` for the staff.
     */
    const openTo = async () =>
      (
        await db
          .select({ companyId: invitation.companyId })
          .from(invitation)
          .where(and(eq(invitation.email, 'erin@adiutor.test'), isNull(invitation.revokedAt)))
      ).map((row) => row.companyId);
    expect(await openTo()).toHaveLength(2);
    expect(await openTo()).toEqual(expect.arrayContaining([testCompany.id, null]));

    await removeFromStaff(ctx, admin, erin);

    // The company's invitation isn't the staff's to revoke.
    expect(await openTo()).toEqual([testCompany.id]);
    // The staff invitation can't bring them back, as Admin.
    expect(
      await acceptInvitation(ctx, token, {
        id: erin,
        email: 'erin@adiutor.test',
        platformRole: null,
      }),
    ).toEqual({ status: 'invalid' });
    expect(await platformRoleOf(erin)).toBeNull();
    const revoked = firstRow(
      await db
        .select({ details: auditEvent.details })
        .from(auditEvent)
        .where(eq(auditEvent.action, 'invitation_revoked')),
      'the audit event',
    );
    expect(revoked.details).toEqual({
      staff: true,
      automatic: true,
      reason: 'member_removed',
      email: 'erin@adiutor.test',
      invitations: 1,
    });
  });
});

describe('listStaff sorting and paging', () => {
  /**
   * Adds two staff members and sets the join date and last activity of all four (with `admin` and
   * `manager` from the shared fixtures), so that name, email, last activity and joined each
   * order them differently:
   * - by name: 'aaron' (before the Admin), 'admin', 'manager', 'Zoe';
   * - joined: manager, admin, Zoe, aaron;
   * - last active: admin, manager, Zoe, and aaron never.
   */
  async function arrangeStaff(): Promise<void> {
    const aaron = await staffActor(db, 'support', 'aaron@adiutor.test');
    const zoe = await staffActor(db, 'finance', 'zoe@adiutor.test');
    await Promise.all([
      db
        .update(user)
        .set({ createdAt: new Date('2020-04-01T00:00:00Z'), lastActiveAt: null })
        .where(eq(user.id, aaron.id)),
      db
        .update(user)
        .set({
          name: 'Zoe',
          createdAt: new Date('2020-03-01T00:00:00Z'),
          lastActiveAt: new Date('2026-04-01T00:00:00Z'),
        })
        .where(eq(user.id, zoe.id)),
      db
        .update(user)
        .set({
          createdAt: new Date('2020-02-01T00:00:00Z'),
          lastActiveAt: new Date('2026-06-01T00:00:00Z'),
        })
        .where(eq(user.id, admin.id)),
      db
        .update(user)
        .set({
          createdAt: new Date('2020-01-01T00:00:00Z'),
          lastActiveAt: new Date('2026-05-01T00:00:00Z'),
        })
        .where(eq(user.id, manager.id)),
    ]);
  }

  /**
   * Lists the staff in an order.
   *
   * @param options - Sort and page.
   * @returns The part of each staff member's email before the `@`, in order.
   */
  async function order(options: Parameters<typeof listStaff>[2] = {}): Promise<string[]> {
    const { items } = await listStaff(ctx, admin, options);
    return items.map((member) => defined(member.email.split('@')[0], 'the part before the @'));
  }

  it('sorts by name, ignoring case, no longer with the Admins first', async () => {
    await arrangeStaff();

    // 'aaron' is a Support member who comes before the Admin, and 'Zoe' sorts as 'zoe'.
    expect(await order()).toEqual(['aaron', 'admin', 'manager', 'zoe']);
    expect((await listStaff(ctx, admin)).items.map(({ role }) => role)).toEqual([
      'support',
      'platform_admin',
      'manager',
      'finance',
    ]);
    expect(await order({ sort: 'name', dir: 'desc' })).toEqual([
      'zoe',
      'manager',
      'admin',
      'aaron',
    ]);
  });

  it('sorts by email, and by last activity with never active last', async () => {
    await arrangeStaff();

    expect(await order({ sort: 'email' })).toEqual(['aaron', 'admin', 'manager', 'zoe']);
    expect(await order({ sort: 'email', dir: 'desc' })).toEqual([
      'zoe',
      'manager',
      'admin',
      'aaron',
    ]);
    expect(await order({ sort: 'last-active' })).toEqual(['admin', 'manager', 'zoe', 'aaron']);
    expect(await order({ sort: 'last-active', dir: 'asc' })).toEqual([
      'aaron',
      'zoe',
      'manager',
      'admin',
    ]);
  });

  it('sorts by when the account was created, newest first by default, and shows it', async () => {
    await arrangeStaff();

    const newestFirst = await listStaff(ctx, admin, { sort: 'joined' });
    expect(newestFirst.items.map(({ email }) => email.split('@')[0])).toEqual([
      'aaron',
      'zoe',
      'admin',
      'manager',
    ]);
    expect(newestFirst.items.map(({ createdAt }) => createdAt)).toEqual([
      new Date('2020-04-01T00:00:00Z'),
      new Date('2020-03-01T00:00:00Z'),
      new Date('2020-02-01T00:00:00Z'),
      new Date('2020-01-01T00:00:00Z'),
    ]);
    expect(await order({ sort: 'joined', dir: 'asc' })).toEqual([
      'manager',
      'admin',
      'zoe',
      'aaron',
    ]);
  });

  it('gives exactly the reverse order for the other direction of every sort', async () => {
    await arrangeStaff();

    await inSequence(['name', 'email', 'last-active', 'joined'] as const, async (sort) => {
      const ascending = await order({ sort, dir: 'asc' });
      expect(await order({ sort, dir: 'desc' })).toEqual([...ascending].reverse());
    });
  });

  it('counts and pages only the users with a staff role', async () => {
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        staffActor(db, 'support', `staff${String(index + 1).padStart(2, '0')}@adiutor.test`),
      ),
    );
    // People without a staff role don't count: plain users and a company Admin.
    await Promise.all(
      ['one', 'two', 'three'].map((name) => createUser(db, `${name}@adiutor.test`)),
    );
    const testCompany = await createCompany(db);
    await memberActor(db, testCompany.id, 'admin');

    // The two from the shared fixtures and 24 more.
    const first = await listStaff(ctx, admin);
    expect(first).toMatchObject({ total: 26, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(first.items.slice(0, 3).map(({ email }) => email)).toEqual([
      'admin@adiutor.test',
      'manager@adiutor.test',
      'staff01@adiutor.test',
    ]);

    const second = await listStaff(ctx, admin, { page: 2 });
    expect(second).toMatchObject({ total: 26, page: 2 });
    expect(second.items.map(({ email }) => email)).toEqual(['staff24@adiutor.test']);

    const past = await listStaff(ctx, admin, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map(({ userId }) => userId)).toEqual(
      second.items.map(({ userId }) => userId),
    );

    const fifty = await listStaff(ctx, admin, { size: 50 });
    expect(fifty).toMatchObject({ total: 26, size: 50 });
    expect(fifty.items).toHaveLength(26);
    expect(fifty.items.every(({ role }) => role)).toBe(true);
  });
});
