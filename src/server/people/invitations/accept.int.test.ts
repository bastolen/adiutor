/**
 * @file Integration tests for accepting an invitation, signed in or by creating
 * an account.
 */
import { verifyPassword } from 'better-auth/crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { account, company, invitation, membership, rateLimitBucket, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { acceptInvitation, acceptInvitationWithNewAccount, getInvitationPreview } from './accept';
import { inviteByEmail } from './send';
import { db, ctx, sent } from './test-helpers';
import {
  actorFor,
  createCompany,
  createStaffSettings,
  createUser,
  inSequence,
  memberActor,
  staffActor,
  tokenFrom,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { hitRateLimit } from '../../rate-limit';
import { claimInviteLink, createInviteLink } from '../invite-links';

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
