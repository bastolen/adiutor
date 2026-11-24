/**
 * @file Integration tests for the signed-in devices of a user
 * (`listUserSessions`, and `listOwnSessions` for the user's own, which a
 * staff member signed in as them sees only as a staff Admin) and for which
 * sessions count as MFA verified, against the test database.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { company, session } from '@/db/schema';
import type { Permission } from '@/lib/authz/permissions';
import type { Paged } from '@/lib/tables/table-state';

import { listOwnSessions, listUserDevices, listUserSessions, type UserSession } from '.';
import {
  actorFor,
  addMember,
  createSession,
  createUser,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { admin, createSessionsOnJanuaryDays, ctx, db, jane, testCompany } from './test-helpers';

describe('which sessions count as MFA verified', () => {
  /** Anna, the Admin of an active company, signed in by email code and by passkey. */
  let anna: string;

  beforeEach(async () => {
    anna = await createUser(db, 'anna@adiutor.test');
    await addMember(db, testCompany.id, anna, 'admin');
    const viaEmail = await createSession(db, anna, { userAgent: 'Firefox' });
    await db
      .update(session)
      .set({ mfaVerified: true, mfaMethod: 'email_code' })
      .where(eq(session.id, viaEmail));
    const viaPasskey = await createSession(db, anna, { userAgent: 'Safari' });
    await db
      .update(session)
      .set({ mfaVerified: true, mfaMethod: 'passkey' })
      .where(eq(session.id, viaPasskey));
  });

  /**
   * Maps sessions to whether each counts, by browser.
   *
   * @param sessions - The page of sessions.
   * @returns Whether each counts as MFA verified, by user agent.
   */
  const byBrowser = (sessions: Paged<UserSession> | null) =>
    Object.fromEntries(
      (sessions?.items ?? []).map((found) => [found.userAgent, found.mfaVerified]),
    );

  it('decides it with the MFA role listUserSessions is given', async () => {
    // An email code doesn't count for the Admin of an active company, but does without a role.
    expect(byBrowser(await listUserSessions({ db }, anna, 'company_admin'))).toEqual({
      Firefox: false,
      Safari: true,
    });
    expect(byBrowser(await listUserSessions({ db }, anna, null))).toEqual({
      Firefox: true,
      Safari: true,
    });
  });

  it('decides it with the user’s role now on their page (listUserDevices)', async () => {
    expect(byBrowser(await listUserDevices(ctx, admin, anna))).toEqual({
      Firefox: false,
      Safari: true,
    });

    await db
      .update(company)
      .set({ deactivatedAt: new Date() })
      .where(eq(company.id, testCompany.id));
    expect(byBrowser(await listUserDevices(ctx, admin, anna))).toEqual({
      Firefox: true,
      Safari: true,
    });
  });
});

describe('listOwnSessions', () => {
  it('lists the user’s own devices, and to a staff member signed in as them only for a staff Admin', async () => {
    await createSession(db, jane, { userAgent: 'Firefox' });
    const own = await actorFor(db, jane);
    /**
     * Jane as the actor while a staff member with these permissions is signed in as her.
     *
     * @param staffPermissions - The staff member's own global permissions.
     * @returns The actor.
     */
    const signedInAsBy = (staffPermissions: Permission[]) => ({
      ...own,
      signedInAs: {
        staffId: admin.id,
        staffName: admin.name,
        endsAt: new Date(Date.now() + 30 * 60_000),
        returnTo: '/dashboard',
        staffPermissions,
      },
    });
    /**
     * The browsers of the devices an actor gets.
     *
     * @param actor - Who reads them.
     * @returns The user agents, or `null` when the devices aren't shown.
     */
    const browsersFor = async (actor: Actor) =>
      (await listOwnSessions({ db }, actor))?.items.map(({ userAgent }) => userAgent) ?? null;

    expect(await browsersFor(own)).toEqual(['Firefox']);
    expect(await browsersFor(signedInAsBy(['users:view', 'users:manage']))).toEqual(['Firefox']);
    // Support and Managers don't see a user's devices on their page either.
    expect(await browsersFor(signedInAsBy(['users:view', 'audit:view']))).toBeNull();
  });
});

describe('listUserSessions sorting and paging', () => {
  it('leaves expired sessions out of the list and the total', async () => {
    await createSessionsOnJanuaryDays(jane, 3);
    // Signed in most recently of all, so it would come first if it counted.
    const expired = await createSession(db, jane, {
      userAgent: 'Browser expired',
      expiresAt: new Date(Date.now() - 1000),
    });
    await db
      .update(session)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 31)) })
      .where(eq(session.id, expired));
    // Another user's session isn't theirs.
    await createSession(db, await createUser(db, 'other@adiutor.test'), {
      userAgent: 'Browser other',
    });

    const listed = await listUserSessions({ db }, jane, null);

    expect(listed).toMatchObject({ total: 3, page: 1, size: 25 });
    expect(listed.items.map((found) => found.userAgent)).toEqual([
      'Browser 03',
      'Browser 02',
      'Browser 01',
    ]);
  });

  it('lists the newest first by default and the oldest first the other way round', async () => {
    await createSessionsOnJanuaryDays(jane, 4);
    /**
     * Lists Jane's sessions in an order.
     *
     * @param options - Sort and page.
     * @returns The browsers, in order.
     */
    const agents = async (options?: Parameters<typeof listUserSessions>[3]) =>
      (await listUserSessions({ db }, jane, null, options)).items.map((found) => found.userAgent);

    const newestFirst = ['Browser 04', 'Browser 03', 'Browser 02', 'Browser 01'];
    expect(await agents()).toEqual(newestFirst);
    expect(await agents({ sort: 'signed-in' })).toEqual(newestFirst);
    expect(await agents({ sort: 'signed-in', dir: 'desc' })).toEqual(newestFirst);
    expect(await agents({ dir: 'asc' })).toEqual([...newestFirst].reverse());
  });

  it('shows 25 sessions a page, counting all of them, and the last page for one past it', async () => {
    await createSessionsOnJanuaryDays(jane, 30);
    await createSession(db, jane, {
      userAgent: 'Browser expired',
      expiresAt: new Date(Date.now() - 1000),
    });

    const first = await listUserSessions({ db }, jane, null);
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items.map((found) => found.userAgent)).toEqual(
      Array.from({ length: 25 }, (_, index) => `Browser ${String(30 - index).padStart(2, '0')}`),
    );

    const second = await listUserSessions({ db }, jane, null, { page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items.map((found) => found.userAgent)).toEqual([
      'Browser 05',
      'Browser 04',
      'Browser 03',
      'Browser 02',
      'Browser 01',
    ]);

    const past = await listUserSessions({ db }, jane, null, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map((found) => found.id)).toEqual(second.items.map((found) => found.id));

    const fifty = await listUserSessions({ db }, jane, null, { size: 50 });
    expect(fifty).toMatchObject({ total: 30, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(30);
  });
});
