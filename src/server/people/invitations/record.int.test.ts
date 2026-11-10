/**
 * @file Integration tests for invitations created or closed at the same moment.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { invitation } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  atTheSameMoment,
  createCompany,
  createStaffSettings,
  createUser,
  memberActor,
  staffActor,
  tokenFrom,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { getInvitationPreview } from './accept';
import { revokeInvitation } from './manage';
import { createSentInvitation } from './record';
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

describe.each([
  { target: 'a company', staff: false, role: 'client' },
  { target: 'the staff', staff: true, role: 'support' },
] as const)('invitations to $target at the same moment', ({ staff, role }) => {
  it.each([
    { before: 'nothing was open', earlier: false },
    { before: 'an earlier invitation was open', earlier: true },
  ])('keep one open invitation, the newest, when $before', async ({ earlier }) => {
    const inviter = staff ? await staffActor(db, 'platform_admin') : companyAdmin;
    const companyId = staff ? null : testCompany.id;
    const email = 'new@adiutor.test';
    if (earlier) {
      await inviteByEmail(ctx, inviter, { companyId, email, role });
      sent.length = 0;
    }

    const { first, second } = await atTheSameMoment(
      db,
      (tx) =>
        createSentInvitation(ctx, tx, inviter, {
          target: { companyId, name: 'Adiutor Tests' },
          email,
          role,
        }),
      () => inviteByEmail(ctx, inviter, { companyId, email, role }),
    );
    // The first request renders and sends its email once its transaction has committed.
    const firstEmail = await first.renderEmail();
    await ctx.sendEmail(firstEmail);

    // Both succeed and both emails go out, but only the second request's link works.
    expect(second).toEqual({ status: 'fulfilled', value: { status: 'sent' } });
    expect(sent).toHaveLength(2);
    const newest = defined(sent[0], 'the newest email');
    const replaced = defined(sent[1], 'the replaced email');
    expect(replaced).toBe(firstEmail);
    expect(newest.to).toBe(email);
    const open = await db
      .select({ tokenHash: invitation.tokenHash })
      .from(invitation)
      .where(and(eq(invitation.email, email), isNull(invitation.revokedAt)));
    expect(open).toEqual([{ tokenHash: hashToken(tokenFrom(newest)) }]);
    expect(await getInvitationPreview(ctx, tokenFrom(replaced))).toBeNull();
    expect(await db.$count(invitation, eq(invitation.email, email))).toBe(earlier ? 3 : 2);
  });
});

describe('closing an invitation at the same moment', () => {
  it('lets a revoke wait for a resend, then find the invitation already replaced', async () => {
    const email = 'new@adiutor.test';
    await inviteByEmail(ctx, companyAdmin, { companyId: testCompany.id, email, role: 'client' });
    const original = firstRow(
      await db.select({ id: invitation.id }).from(invitation).where(eq(invitation.email, email)),
      'the original invitation',
    );

    const { second } = await atTheSameMoment(
      db,
      // The resend's work in its transaction: it replaces the invitation with a new one.
      (tx) =>
        createSentInvitation(ctx, tx, companyAdmin, {
          target: { companyId: testCompany.id, name: testCompany.name },
          email,
          role: 'client',
          resent: true,
        }),
      () =>
        revokeInvitation(ctx, companyAdmin, {
          companyId: testCompany.id,
          invitationId: original.id,
        }),
    );

    // As one after another: the revoke finds the invitation it meant already replaced, and the
    // resent one stays open (the admin sees it in the list and can revoke that).
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'not_found' } });
    const open = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(and(eq(invitation.email, email), isNull(invitation.revokedAt)));
    expect(open).toHaveLength(1);
    expect(defined(open[0], 'the open invitation').id).not.toBe(original.id);
  });
});
