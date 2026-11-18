/**
 * @file Integration tests for accepting an invitation, signed in or by creating
 * an account, and for what the audit log records when whoever accepts it was
 * in already and keeps their role.
 */
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  account,
  auditEvent,
  company,
  invitation,
  membership,
  rateLimitBucket,
  user,
} from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  actorFor,
  addMember,
  createCompany,
  createStaffSettings,
  createUser,
  inSequence,
  memberActor,
  queuedJobKinds,
  staffActor,
  tokenFrom,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { hitRateLimit } from '../../rate-limit';
import { claimInviteLink, createInviteLink } from '../invite-links';
import { acceptInvitation, acceptInvitationWithNewAccount, getInvitationPreview } from './accept';
import { inviteByEmail } from './send';
import { db, ctx, sent } from './test-helpers';

/** Shared fixtures, recreated before each test. */
let testCompany: Awaited<ReturnType<typeof createCompany>>;
let companyAdmin: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  testCompany = await createCompany(db);
  companyAdmin = await memberActor(db, testCompany.id, 'admin');
  await staffActor(db, 'manager');
  await memberActor(db, testCompany.id, 'client', 'member@adiutor.test');
  await createUser(db, 'existing@adiutor.test');
});

describe('accepting', () => {
  /**
   * Invites an email to the company as Client and returns the token.
   *
   * @param email - The address to invite.
   * @returns The invitation token.
   */
  async function invite(email: string): Promise<string> {
    await inviteByEmail(ctx, companyAdmin, { companyId: testCompany.id, email, role: 'client' });
    return tokenFrom(defined(sent.at(-1), 'the last email'));
  }

  it('creates an account with a hashed password and joins', async () => {
    const token = await invite('new@adiutor.test');
    const result = await acceptInvitationWithNewAccount(ctx, token, {
      name: 'New Person',
      password: 'correct-horse-1',
    });
    expect(result).toEqual({
      status: 'created',
      email: 'new@adiutor.test',
      companyId: testCompany.id,
    });

    const created = firstRow(
      await db.select().from(user).where(eq(user.email, 'new@adiutor.test')),
      'the new user',
    );
    expect(created).toMatchObject({ name: 'New Person', emailVerified: true });
    const credential = firstRow(
      await db.select().from(account).where(eq(account.userId, created.id)),
      'the new password account',
    );
    expect(credential.providerId).toBe('credential');
    expect(credential.password).not.toContain('correct-horse-1');
    expect(
      await verifyPassword({
        hash: defined(credential.password, 'the stored password hash'),
        password: 'correct-horse-1',
      }),
    ).toBe(true);

    const joined = firstRow(
      await db
        .select()
        .from(membership)
        .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, created.id))),
      'the new membership',
    );
    expect(joined.role).toBe('client');

    // The link works only once.
    expect(await getInvitationPreview(ctx, token)).toBeNull();
  });

  it('lifts a pause on password sign-in for the invited address, which the invitation proves', async () => {
    const token = await invite('new@adiutor.test');
    const failed = { limit: 10, windowSeconds: 15 * 60 };
    await inSequence(Array.from({ length: 10 }), () =>
      hitRateLimit(ctx, 'sign-in-failed:email:new@adiutor.test', failed),
    );
    await hitRateLimit(ctx, 'sign-in-failed:email:other@adiutor.test', failed);

    await acceptInvitationWithNewAccount(ctx, token, {
      name: 'New Person',
      password: 'correct-horse-1',
    });

    const left = await db
      .select({ key: rateLimitBucket.key })
      .from(rateLimitBucket)
      .where(sql`${rateLimitBucket.key} like 'sign-in-failed:%'`);
    expect(left).toEqual([{ key: 'sign-in-failed:email:other@adiutor.test' }]);
  });

  it('asks existing users to sign in instead of creating an account', async () => {
    const token = await invite('existing@adiutor.test');
    expect(
      await acceptInvitationWithNewAccount(ctx, token, { name: 'X', password: 'password-123' }),
    ).toEqual({ status: 'account_exists' });
    // The invitation is still usable after signing in.
    expect(await getInvitationPreview(ctx, token)).not.toBeNull();
  });

  it('joins as the signed-in user with the invited email only', async () => {
    const token = await invite('existing@adiutor.test');
    const existing = firstRow(
      await db.select().from(user).where(eq(user.email, 'existing@adiutor.test')),
      'the existing user',
    );
    const someoneElse = await actorFor(db, await createUser(db, 'other@adiutor.test'));

    expect(await acceptInvitation(ctx, token, someoneElse)).toEqual({ status: 'wrong_account' });
    expect(await acceptInvitation(ctx, token, existing)).toEqual({
      status: 'joined',
      companyId: testCompany.id,
    });
    expect(await acceptInvitation(ctx, token, existing)).toEqual({ status: 'invalid' });
  });

  it("doesn't let Finance or Support accept an invitation that came from an invite link", async () => {
    const support = await staffActor(db, 'support', 'sam.support@adiutor.test');
    const { url } = await createInviteLink(ctx, companyAdmin, {
      companyId: testCompany.id,
      role: 'admin',
      validDays: 1,
    });
    await claimInviteLink(ctx, defined(url.split('/join/')[1], 'the link token'), support.email);
    const linkToken = tokenFrom(defined(sent[sent.length - 1], 'the last email'));
    expect(await getInvitationPreview(ctx, linkToken)).toMatchObject({ fromInviteLink: true });
    await expect(acceptInvitation(ctx, linkToken, support)).rejects.toMatchObject({
      code: 'forbidden',
      key: 'errors.inviteLinks.notAllowed',
    });

    // An invitation someone sends them by email still works.
    const direct = await invite(support.email);
    expect(await acceptInvitation(ctx, direct, support)).toEqual({
      status: 'joined',
      companyId: testCompany.id,
    });
  });

  it('rejects expired invitations and those of deactivated companies', async () => {
    const expiredToken = await invite('new@adiutor.test');
    await db
      .update(invitation)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(isNull(invitation.acceptedAt));
    expect(await getInvitationPreview(ctx, expiredToken)).toBeNull();

    const token = await invite('other@adiutor.test');
    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    expect(await getInvitationPreview(ctx, token)).toBeNull();
    expect(
      await acceptInvitationWithNewAccount(ctx, token, { name: 'X', password: 'password-123' }),
    ).toEqual({ status: 'invalid' });
  });
});

describe('accepting an invitation when already in', () => {
  /**
   * Reads the `member_joined` events, oldest first.
   *
   * @returns Who joined, where, and the details.
   */
  async function joinedEvents() {
    return db
      .select({
        actorUserId: auditEvent.actorUserId,
        targetUserId: auditEvent.targetUserId,
        companyId: auditEvent.companyId,
        details: auditEvent.details,
      })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'member_joined'))
      .orderBy(auditEvent.id);
  }

  /**
   * Finds the user the fixtures created for `existing@adiutor.test`.
   *
   * @returns Their row.
   */
  async function existingUser() {
    return firstRow(
      await db.select().from(user).where(eq(user.email, 'existing@adiutor.test')),
      'the existing user',
    );
  }

  it('records that a member kept the role they had, not that they joined as Admin', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'existing@adiutor.test',
      role: 'admin',
    });
    const token = tokenFrom(defined(sent.at(-1), 'the invitation email'));
    const existing = await existingUser();
    // They joined another way while the invitation was open.
    await addMember(db, testCompany.id, existing.id, 'watcher');

    expect(await acceptInvitation(ctx, token, existing)).toEqual({
      status: 'joined',
      companyId: testCompany.id,
    });

    const [joined] = await db
      .select({ role: membership.role })
      .from(membership)
      .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, existing.id)));
    expect(joined).toEqual({ role: 'watcher' });
    expect(await joinedEvents()).toEqual([
      {
        actorUserId: existing.id,
        targetUserId: existing.id,
        companyId: testCompany.id,
        details: { role: 'watcher', kept: true, invited: 'admin', email: 'existing@adiutor.test' },
      },
    ]);
    // The invitation is used up all the same.
    expect(await getInvitationPreview(ctx, token)).toBeNull();
  });

  it('records that someone on the staff kept their role, and tells no staff Admin of a new one', async () => {
    const staffAdmin = await staffActor(db, 'platform_admin');
    // Another staff Admin, who would be told of a new one.
    await staffActor(db, 'platform_admin', 'other.admin@adiutor.test');
    await inviteByEmail(ctx, staffAdmin, {
      companyId: null,
      email: 'existing@adiutor.test',
      role: 'platform_admin',
    });
    const token = tokenFrom(defined(sent.at(-1), 'the invitation email'));
    const existing = await existingUser();
    // Made Support while the Admin invitation was open.
    await db.update(user).set({ platformRole: 'support' }).where(eq(user.id, existing.id));

    expect(await acceptInvitation(ctx, token, { ...existing, platformRole: 'support' })).toEqual({
      status: 'joined',
      companyId: null,
    });

    expect((await existingUser()).platformRole).toBe('support');
    expect(await joinedEvents()).toEqual([
      {
        actorUserId: existing.id,
        targetUserId: existing.id,
        companyId: null,
        details: {
          staff: true,
          role: 'support',
          kept: true,
          invited: 'platform_admin',
          email: 'existing@adiutor.test',
        },
      },
    ]);
    expect(await queuedJobKinds(db)).not.toContain('staff-admin-added');
  });

  it('still records the role that was given to someone who wasn’t in yet', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'existing@adiutor.test',
      role: 'client',
    });
    const existing = await existingUser();

    await acceptInvitation(ctx, tokenFrom(defined(sent.at(-1), 'the invitation email')), existing);

    expect(await joinedEvents()).toEqual([
      {
        actorUserId: existing.id,
        targetUserId: existing.id,
        companyId: testCompany.id,
        details: { role: 'client', email: 'existing@adiutor.test' },
      },
    ]);
  });
});
