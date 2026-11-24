/**
 * @file Integration tests for creating, listing and revoking invite links:
 * which roles and validity periods they can be created for, creating and
 * revoking them while their creator loses their rights, and how the list
 * sorts and pages.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { DatabaseTransaction } from '@/db';
import { inviteLink, membership, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import {
  atTheSameMoment,
  createCompany,
  memberActor,
  staffActor,
} from '../../../../tests/integration/helpers';
import { revokeInvitesWithoutManager } from '../invitations';
import { createInviteLink, listInviteLinks, revokeInviteLink } from './manage';
import { admin, ctx, db, testCompany } from './test-helpers';

describe('invite links', () => {
  describe('created by someone losing their rights at that moment', () => {
    /** The refusal for an actor whose rights are gone by the time the change is made. */
    const FORBIDDEN = expect.objectContaining({
      code: 'forbidden',
      key: 'errors.forbidden',
    });

    /**
     * Lists the links that can still be used.
     *
     * @returns Their IDs.
     */
    const usableLinks = async () =>
      db
        .select({ id: inviteLink.id })
        .from(inviteLink)
        .where(and(isNull(inviteLink.usedAt), isNull(inviteLink.revokedAt)));

    it('refuses a staff link from an Admin removed from the staff', async () => {
      const staffAdmin = await staffActor(db, 'platform_admin');
      // Another Admin, so the staff keeps one.
      await staffActor(db, 'platform_admin');

      const { second } = await atTheSameMoment(
        db,
        // Taken off the staff the way `setStaffRole` does: the role goes, then what they sent.
        async (tx) => {
          await tx.update(user).set({ platformRole: null }).where(eq(user.id, staffAdmin.id));
          await revokeInvitesWithoutManager(ctx, tx, staffAdmin.id);
        },
        // `staffAdmin` still carries the rights it was loaded with before the removal.
        () =>
          createInviteLink(ctx, staffAdmin, {
            companyId: null,
            role: 'platform_admin',
            validDays: 30,
          }),
      );

      expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
      expect(await usableLinks()).toEqual([]);
    });

    it.each([
      [
        'demoted',
        async (tx: DatabaseTransaction) => {
          await tx
            .update(membership)
            .set({ role: 'client' })
            .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, admin.id)));
          await revokeInvitesWithoutManager(ctx, tx, admin.id);
        },
      ],
      [
        'deactivated',
        async (tx: DatabaseTransaction) => {
          await tx.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, admin.id));
          await revokeInvitesWithoutManager(ctx, tx, admin.id, { all: true });
        },
      ],
    ])('refuses a link from a company Admin %s', async (_, takeAway) => {
      // Another admin, so the company keeps one.
      await memberActor(db, testCompany.id, 'admin');

      const { second } = await atTheSameMoment(
        db,
        (tx) => takeAway(tx),
        () =>
          createInviteLink(ctx, admin, { companyId: testCompany.id, role: 'admin', validDays: 30 }),
      );

      expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
      expect(await usableLinks()).toEqual([]);
    });

    it('refuses revoking a link for a company Admin demoted', async () => {
      const otherAdmin = await memberActor(db, testCompany.id, 'admin');
      await createInviteLink(ctx, otherAdmin, {
        companyId: testCompany.id,
        role: 'client',
        validDays: 7,
      });
      const link = firstRow(await usableLinks(), 'the usable link');

      const { second } = await atTheSameMoment(
        db,
        (tx) =>
          tx
            .update(membership)
            .set({ role: 'client' })
            .where(and(eq(membership.companyId, testCompany.id), eq(membership.userId, admin.id))),
        () => revokeInviteLink(ctx, admin, { companyId: testCompany.id, linkId: link.id }),
      );

      expect(second).toMatchObject({ status: 'rejected', reason: FORBIDDEN });
      expect(await usableLinks()).toEqual([link]);
    });
  });

  it('can only be created for fitting roles and validity periods', async () => {
    await expect(
      createInviteLink(ctx, admin, { companyId: testCompany.id, role: 'support', validDays: 7 }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      createInviteLink(ctx, admin, { companyId: testCompany.id, role: 'client', validDays: 365 }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('listInviteLinks sorting and paging', () => {
  /**
   * Inserts an unused link for the shared company with a known creation time (creating them
   * through the service would stamp the current time).
   *
   * @param createdAt - When it was created.
   * @param values - Other columns to set, e.g. to use it up, revoke it or give it to another company.
   * @returns The link's ID.
   */
  async function insertLink(
    createdAt: Date,
    values: Partial<typeof inviteLink.$inferInsert> = {},
  ): Promise<string> {
    const created = firstRow(
      await db
        .insert(inviteLink)
        .values({
          companyId: testCompany.id,
          role: 'client',
          tokenHash: randomUUID(),
          createdBy: admin.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt,
          ...values,
        })
        .returning({ id: inviteLink.id }),
      'the new link',
    );
    return created.id;
  }

  /**
   * The start of a day in January 2026, in UTC.
   *
   * @param day - The day of the month.
   * @returns The date.
   */
  const january = (day: number) => new Date(Date.UTC(2026, 0, day));

  it('lists the newest first by default and the oldest first the other way round', async () => {
    const oldest = await insertLink(january(1), { role: 'client' });
    const middle = await insertLink(january(2), { role: 'watcher' });
    const newest = await insertLink(january(3), { role: 'admin' });

    /**
     * Lists the shared company's links in an order.
     *
     * @param options - Sort and page.
     * @returns The links' IDs, in order.
     */
    const ids = async (options: Parameters<typeof listInviteLinks>[3] = {}) =>
      (await listInviteLinks(ctx, admin, testCompany.id, options)).items.map((link) => link.id);

    expect(await ids()).toEqual([newest, middle, oldest]);
    expect(await ids({ sort: 'created' })).toEqual([newest, middle, oldest]);
    expect(await ids({ dir: 'asc' })).toEqual([oldest, middle, newest]);
    expect(await ids({ sort: 'created', dir: 'desc' })).toEqual([newest, middle, oldest]);
  });

  it('works out the status of each link on the page', async () => {
    const past = new Date(Date.now() - 60_000);
    await insertLink(january(1));
    await insertLink(january(2), { expiresAt: past });
    await insertLink(january(3), { usedAt: new Date(), usedByEmail: 'used@adiutor.test' });
    await insertLink(january(4), { revokedAt: new Date() });
    // Revoking counts before everything else, and using a link up before it expires.
    await insertLink(january(5), { expiresAt: past, revokedAt: new Date() });
    await insertLink(january(6), {
      expiresAt: past,
      usedAt: new Date(),
      usedByEmail: 'late@adiutor.test',
    });

    const { items } = await listInviteLinks(ctx, admin, testCompany.id, { dir: 'asc' });

    expect(items.map((link) => link.status)).toEqual([
      'active',
      'expired',
      'used',
      'revoked',
      'revoked',
      'used',
    ]);
    expect(items.map((link) => link.usedByEmail)).toEqual([
      null,
      null,
      'used@adiutor.test',
      null,
      null,
      'late@adiutor.test',
    ]);
  });

  it('shows 25 links a page, counting all of them, and the last page for one past it', async () => {
    await Promise.all(Array.from({ length: 26 }, (_, index) => insertLink(january(index + 1))));
    // Another company's link and a staff link aren't this company's.
    const other = await createCompany(db);
    await insertLink(january(27), { companyId: other.id });
    await insertLink(january(28), { companyId: null, role: 'support' });

    const first = await listInviteLinks(ctx, admin, testCompany.id);
    expect(first).toMatchObject({ total: 26, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first link').createdAt).toEqual(january(26));
    expect(defined(first.items[24], 'the last link').createdAt).toEqual(january(2));

    const second = await listInviteLinks(ctx, admin, testCompany.id, { page: 2 });
    expect(second).toMatchObject({ total: 26, page: 2 });
    expect(second.items.map((link) => link.createdAt)).toEqual([january(1)]);

    const past = await listInviteLinks(ctx, admin, testCompany.id, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map((link) => link.id)).toEqual(second.items.map((link) => link.id));

    // Oldest first, the newest link is alone on the second page.
    const oldestFirst = await listInviteLinks(ctx, admin, testCompany.id, { dir: 'asc', page: 2 });
    expect(oldestFirst.items.map((link) => link.createdAt)).toEqual([january(26)]);

    const fifty = await listInviteLinks(ctx, admin, testCompany.id, { size: 50 });
    expect(fifty).toMatchObject({ total: 26, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(26);

    const staffAdmin = await staffActor(db, 'platform_admin');
    expect((await listInviteLinks(ctx, staffAdmin, null)).total).toBe(1);
  });
});
