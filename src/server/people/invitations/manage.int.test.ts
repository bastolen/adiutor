/**
 * @file Integration tests for the open invitations: re-inviting, resending and
 * revoking, an Admin demoted while a request was under way, and the list.
 */
import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseTransaction } from '@/db';
import { invitation, membership, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  atTheSameMoment,
  createCompany,
  createStaffSettings,
  createUser,
  emailLanguage,
  inLanguage,
  memberActor,
  setUserLocale,
  staffActor,
  tokenFrom,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { getInvitationPreview } from './accept';
import { listPendingInvitations, resendInvitation, revokeInvitation } from './manage';
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

describe('re-inviting, resending and revoking', () => {
  it('keeps only the newest link working', async () => {
    const input = { companyId: testCompany.id, email: 'new@adiutor.test', role: 'client' };
    await inviteByEmail(ctx, companyAdmin, input);
    await inviteByEmail(ctx, companyAdmin, input);
    const [first, second] = sent.map(tokenFrom);

    expect(await getInvitationPreview(ctx, defined(first, 'the first token'))).toBeNull();
    expect(await getInvitationPreview(ctx, defined(second, 'the second token'))).toEqual({
      companyName: 'Adiutor Tests',
      role: 'client',
      fromInviteLink: false,
    });
    expect((await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items).toHaveLength(1);
  });

  it('resends with a fresh link and revokes on request', async () => {
    await inviteByEmail(ctx, companyAdmin, {
      companyId: testCompany.id,
      email: 'new@adiutor.test',
      role: 'client',
    });
    const pending = firstRow(
      (await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items,
      'the pending invitation',
    );
    await resendInvitation(ctx, companyAdmin, {
      companyId: testCompany.id,
      invitationId: pending.id,
    });
    expect(
      await getInvitationPreview(ctx, tokenFrom(defined(sent[0], 'the first email'))),
    ).toBeNull();

    const resent = firstRow(
      (await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items,
      'the resent invitation',
    );
    await revokeInvitation(ctx, companyAdmin, {
      companyId: testCompany.id,
      invitationId: resent.id,
    });
    expect(
      await getInvitationPreview(ctx, tokenFrom(defined(sent[1], 'the second email'))),
    ).toBeNull();
    expect((await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items).toHaveLength(0);
  });

  it('resends in the invitation’s language, not the resender’s, unless the invitee saved one', async () => {
    const input = { companyId: testCompany.id, role: 'client', locale: 'nl-NL' } as const;
    await inviteByEmail(ctx, companyAdmin, { ...input, email: 'new@adiutor.test' });
    await inviteByEmail(ctx, companyAdmin, { ...input, email: 'existing@adiutor.test' });
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, 'existing@adiutor.test'));
    await setUserLocale(db, defined(existing, 'the existing user').id, 'es-ES');
    sent.length = 0;

    const pending = (await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items;
    await Promise.all(
      pending.map((found) =>
        resendInvitation(inLanguage(ctx, 'en-US'), companyAdmin, {
          companyId: testCompany.id,
          invitationId: found.id,
        }),
      ),
    );

    expect(
      sent
        .map((email) => [email.to, emailLanguage(email)])
        .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual([
      ['existing@adiutor.test', 'es-ES'],
      ['new@adiutor.test', 'nl-NL'],
    ]);
    const open = await db
      .select({ locale: invitation.locale })
      .from(invitation)
      .where(isNull(invitation.revokedAt));
    expect(open.map(({ locale }) => locale)).toEqual(['nl-NL', 'nl-NL']);
  });
});

describe.each([
  { target: 'a company', staff: false },
  { target: 'the staff', staff: true },
] as const)('an Admin of $target demoted while their request was under way', ({ staff }) => {
  /** The Admin whose rights are taken away, as their request loaded them. */
  let demoted: Actor;
  /** The company, or `null` for staff. */
  let companyId: string | null;
  /** An open invitation another Admin sent, to resend or revoke. */
  let invitationId: string;

  beforeEach(async () => {
    companyId = staff ? null : testCompany.id;
    // Another Admin sends the open invitation, so the demotion doesn't revoke it.
    const otherAdmin = staff ? await staffActor(db, 'platform_admin') : companyAdmin;
    demoted = staff
      ? await staffActor(db, 'platform_admin')
      : await memberActor(db, testCompany.id, 'admin');
    await inviteByEmail(ctx, otherAdmin, {
      companyId,
      email: 'open@adiutor.test',
      role: staff ? 'support' : 'client',
    });
    invitationId = firstRow(
      await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(eq(invitation.email, 'open@adiutor.test')),
      'the open invitation',
    ).id;
    sent.length = 0;
  });

  /**
   * Takes the Admin role away in a transaction that's held open: a staff
   * Admin becomes a Manager, a company Admin a Client.
   *
   * @param tx - The held transaction.
   */
  async function demote(tx: DatabaseTransaction): Promise<void> {
    if (staff) {
      await tx.update(user).set({ platformRole: 'manager' }).where(eq(user.id, demoted.id));
    } else {
      await tx
        .update(membership)
        .set({ role: 'client' })
        .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, demoted.id)));
    }
  }

  /**
   * Lists the open invitations with their links.
   *
   * @returns Their emails and token hashes.
   */
  const openInvitations = () =>
    db
      .select({ email: invitation.email, tokenHash: invitation.tokenHash })
      .from(invitation)
      .where(and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
      .orderBy(asc(invitation.email));

  it.each<[string, () => Promise<unknown>]>([
    [
      'invite',
      () =>
        inviteByEmail(ctx, demoted, {
          companyId,
          email: 'new@adiutor.test',
          role: staff ? 'platform_admin' : 'admin',
        }),
    ],
    ['resend', () => resendInvitation(ctx, demoted, { companyId, invitationId })],
    ['revoke', () => revokeInvitation(ctx, demoted, { companyId, invitationId })],
  ])("can't %s", async (_, act) => {
    const before = await openInvitations();

    // The demotion commits only once the request is waiting for it.
    const { second } = await atTheSameMoment(db, demote, act);

    expect(second).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'forbidden',
        key: 'errors.forbidden',
      }),
    });
    expect(await openInvitations()).toEqual(before);
    expect(sent).toEqual([]);
  });
});

describe('listPendingInvitations sorting and paging', () => {
  /**
   * Inserts an open invitation for the shared company with a known send time (the service
   * would stamp the current time, and its rate limits would stop a long list).
   *
   * @param email - The invited address.
   * @param createdAt - When it was sent.
   * @param values - Other columns to set, e.g. to close it or to give it to another company.
   * @returns The invitation's ID.
   */
  async function insertInvitation(
    email: string,
    createdAt: Date,
    values: Partial<typeof invitation.$inferInsert> = {},
  ): Promise<string> {
    const created = firstRow(
      await db
        .insert(invitation)
        .values({
          companyId: testCompany.id,
          email,
          role: 'client',
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt,
          ...values,
        })
        .returning({ id: invitation.id }),
      'the new invitation',
    );
    return created.id;
  }

  /**
   * Lists the shared company's open invitations in an order.
   *
   * @param options - Sort and page.
   * @returns The invited addresses, in order.
   */
  async function emails(options: Parameters<typeof listPendingInvitations>[3] = {}) {
    const { items } = await listPendingInvitations(ctx, companyAdmin, testCompany.id, options);
    return items.map((pending) => pending.email);
  }

  it('lists the newest first by default and the oldest first the other way round', async () => {
    await insertInvitation('cara@adiutor.test', new Date('2026-01-03T00:00:00Z'));
    await insertInvitation('amy@adiutor.test', new Date('2026-01-01T00:00:00Z'));
    await insertInvitation('bob@adiutor.test', new Date('2026-01-02T00:00:00Z'));

    const newestFirst = ['cara@adiutor.test', 'bob@adiutor.test', 'amy@adiutor.test'];
    expect(await emails()).toEqual(newestFirst);
    expect(await emails({ sort: 'sent' })).toEqual(newestFirst);
    expect(await emails({ sort: 'sent', dir: 'asc' })).toEqual([...newestFirst].reverse());
    const newest = firstRow(
      (await listPendingInvitations(ctx, companyAdmin, testCompany.id)).items,
      'the newest invitation',
    );
    expect(newest.createdAt).toEqual(new Date('2026-01-03T00:00:00Z'));
  });

  it('sorts by email A to Z, and gives exactly the reverse order for the other direction', async () => {
    await insertInvitation('cara@adiutor.test', new Date('2026-01-03T00:00:00Z'));
    await insertInvitation('amy@adiutor.test', new Date('2026-01-01T00:00:00Z'));
    await insertInvitation('bob@adiutor.test', new Date('2026-01-02T00:00:00Z'));

    const aToZ = ['amy@adiutor.test', 'bob@adiutor.test', 'cara@adiutor.test'];
    expect(await emails({ sort: 'email' })).toEqual(aToZ);
    expect(await emails({ sort: 'email', dir: 'asc' })).toEqual(aToZ);
    expect(await emails({ sort: 'email', dir: 'desc' })).toEqual([...aToZ].reverse());
  });

  it('counts only open invitations of the company: not accepted, revoked, or another target’s', async () => {
    await insertInvitation('open@adiutor.test', new Date('2026-01-01T00:00:00Z'));
    await insertInvitation('expired@adiutor.test', new Date('2026-01-02T00:00:00Z'), {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await insertInvitation('accepted@adiutor.test', new Date('2026-01-03T00:00:00Z'), {
      acceptedAt: new Date(),
    });
    await insertInvitation('revoked@adiutor.test', new Date('2026-01-04T00:00:00Z'), {
      revokedAt: new Date(),
    });
    // Another company's invitation, and one to join the staff.
    const other = await createCompany(db);
    await insertInvitation('elsewhere@adiutor.test', new Date('2026-01-05T00:00:00Z'), {
      companyId: other.id,
    });
    await insertInvitation('staff@adiutor.test', new Date('2026-01-06T00:00:00Z'), {
      companyId: null,
      role: 'support',
    });

    const listed = await listPendingInvitations(ctx, companyAdmin, testCompany.id);
    expect(listed.total).toBe(2);
    // Expired invitations stay in the list, so they can be sent again.
    expect(Object.fromEntries(listed.items.map(({ email, expired }) => [email, expired]))).toEqual({
      'open@adiutor.test': false,
      'expired@adiutor.test': true,
    });

    const staffAdmin = await staffActor(db, 'platform_admin');
    const staffList = await listPendingInvitations(ctx, staffAdmin, null);
    expect(staffList.total).toBe(1);
    expect(staffList.items.map(({ email }) => email)).toEqual(['staff@adiutor.test']);
  });

  it('shows 25 invitations a page, counting all of them, and the last page for one past it', async () => {
    await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        insertInvitation(
          `invitee${String(index + 1).padStart(2, '0')}@adiutor.test`,
          new Date(Date.UTC(2026, 0, index + 1)),
        ),
      ),
    );

    const first = await listPendingInvitations(ctx, companyAdmin, testCompany.id);
    expect(first).toMatchObject({ total: 26, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first invitation').email).toBe('invitee26@adiutor.test');
    expect(defined(first.items[24], 'the last invitation').email).toBe('invitee02@adiutor.test');

    const second = await listPendingInvitations(ctx, companyAdmin, testCompany.id, { page: 2 });
    expect(second).toMatchObject({ total: 26, page: 2 });
    expect(second.items.map(({ email }) => email)).toEqual(['invitee01@adiutor.test']);

    const past = await listPendingInvitations(ctx, companyAdmin, testCompany.id, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map(({ id }) => id)).toEqual(second.items.map(({ id }) => id));

    // Paging follows the sort: by email, the last address is alone on the second page.
    expect(await emails({ sort: 'email', page: 2 })).toEqual(['invitee26@adiutor.test']);
    expect(await emails({ size: 50 })).toHaveLength(26);
  });
});
