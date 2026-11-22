/**
 * @file Integration tests for the user page's loaders (`getUserDetail`,
 * `listUserCompanies` and `listUserDevices`) and `userExists`, against the
 * test database.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { membership, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';

import { getUserDetail, listUserCompanies, listUserDevices, userExists } from '.';
import {
  addMember,
  addPassword,
  connectGitHub,
  connectProvider,
  createCompany,
  createSession,
  createUser,
  inSequence,
  staffActor,
  turnOffGitHubSignIn,
} from '../../../../tests/integration/helpers';
import { admin, createSessionsOnJanuaryDays, ctx, db, jane, testCompany } from './test-helpers';

describe('getUserDetail', () => {
  it("doesn't count GitHub with 2FA as MFA while GitHub sign-in is off", async () => {
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, testCompany.id, owner, 'admin');
    await connectGitHub(db, owner);
    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'protected',
      required: true,
    });

    turnOffGitHubSignIn();

    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'required',
      required: true,
    });
  });

  it('shows the user, their companies and their devices to Admins', async () => {
    await createSession(db, jane, { userAgent: 'Firefox' });
    await createSession(db, jane, { expiresAt: new Date(Date.now() - 1000) });

    const detail = await getUserDetail(ctx, admin, jane);
    expect(detail).toMatchObject({ email: 'jane@adiutor.test', deactivatedAt: null });
    expect(detail.mfa).toMatchObject({ status: 'optional', required: false });

    const companies = await listUserCompanies(ctx, admin, jane);
    expect(companies).toMatchObject({ total: 1, page: 1 });
    expect(companies.items).toEqual([
      expect.objectContaining({ id: testCompany.id, role: 'client' }),
    ]);
    // The expired session isn't counted either.
    const devices = await listUserDevices(ctx, admin, jane);
    expect(devices).toMatchObject({ total: 1 });
    expect(devices.items).toHaveLength(1);
  });

  it('shows staff without the right to manage users the companies, not the devices', async () => {
    const support = await staffActor(db, 'support');
    await createSession(db, jane, { userAgent: 'Firefox' });
    await expect(listUserCompanies(ctx, support, jane)).resolves.toMatchObject({ total: 1 });
    await expect(listUserDevices(ctx, support, jane)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('names provider accounts at their providers for staff Admins only', async () => {
    const named = await connectProvider(db, jane, { accountName: 'adiutor-tests' });
    const unnamed = await connectProvider(db, jane, { providerId: 'google' });

    expect((await getUserDetail(ctx, admin, jane)).accountNames).toEqual({
      [named]: 'adiutor-tests',
      [unnamed]: null,
    });
    const manager = await staffActor(db, 'manager');
    expect((await getUserDetail(ctx, manager, jane)).accountNames).toBeNull();
    const support = await staffActor(db, 'support');
    expect((await getUserDetail(ctx, support, jane)).accountNames).toBeNull();
  });

  it('counts their GitHub and Google accounts, confirmed or not, but not their password', async () => {
    expect((await getUserDetail(ctx, admin, jane)).connectedAccounts).toBe(0);

    await addPassword(db, jane);
    await connectProvider(db, jane);
    await connectProvider(db, jane, { providerId: 'google', confirmed: false });
    await connectProvider(db, admin.id);

    const detail = await getUserDetail(ctx, admin, jane);
    expect(detail.connectedAccounts).toBe(2);
    // The unconfirmed one doesn't count for MFA, so it isn't among the provider accounts there.
    expect(detail.mfa.providerAccounts).toHaveLength(1);
  });

  it('is not found for unknown or malformed IDs', async () => {
    const unknown = '01890a5d-ac96-774b-bcce-b302099a8057';
    await Promise.all(
      [getUserDetail, listUserCompanies, listUserDevices].flatMap((load) =>
        ['nope', unknown].map((id) =>
          expect(load(ctx, admin, id)).rejects.toMatchObject({ code: 'not_found' }),
        ),
      ),
    );
  });
});

describe('userExists', () => {
  it('finds users, deactivated ones too', async () => {
    await expect(userExists(ctx, admin, jane)).resolves.toBe(true);

    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, jane));
    await expect(userExists(ctx, admin, jane)).resolves.toBe(true);
  });

  it("doesn't find unknown IDs or what isn't an ID", async () => {
    await expect(userExists(ctx, admin, '01890a5d-ac96-774b-bcce-b302099a8057')).resolves.toBe(
      false,
    );
    await expect(userExists(ctx, admin, 'not-an-id')).resolves.toBe(false);
  });
});

describe('listUserCompanies and listUserDevices', () => {
  /**
   * Adds a user to companies named 'Adiutor Tests 01', 'Adiutor Tests 02' and so on.
   *
   * @param userId - The user.
   * @param count - How many companies.
   * @param role - Their role in each; Client by default.
   */
  async function joinNumberedCompanies(
    userId: string,
    count: number,
    role: 'client' | 'admin' = 'client',
  ): Promise<void> {
    await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const created = await createCompany(db, {
          name: `Adiutor Tests ${String(index + 1).padStart(2, '0')}`,
        });
        await addMember(db, created.id, userId, role);
      }),
    );
  }

  it('sorts their companies by name ignoring case, or by when they joined', async () => {
    const maya = await createUser(db, 'maya@adiutor.test');
    const joined: [string, number][] = [
      ['Adiutor Tests Charlie', 1],
      ['Adiutor Tests alpha', 2],
      ['Adiutor Tests Bravo', 3],
    ];
    await inSequence(joined, async ([name, day]) => {
      const created = await createCompany(db, { name });
      const membershipId = await addMember(db, created.id, maya, 'client');
      await db
        .update(membership)
        .set({ createdAt: new Date(Date.UTC(2026, 0, day)) })
        .where(eq(membership.id, membershipId));
    });
    /**
     * Lists Maya's companies in an order.
     *
     * @param companies - Sort and page of the companies.
     * @returns The company names, in order.
     */
    const names = async (companies?: Parameters<typeof listUserCompanies>[3]) =>
      (await listUserCompanies(ctx, admin, maya, companies)).items.map((listed) => listed.name);

    // Name A to Z is the default.
    const aToZ = ['Adiutor Tests alpha', 'Adiutor Tests Bravo', 'Adiutor Tests Charlie'];
    expect(await names()).toEqual(aToZ);
    expect(await names({ sort: 'name', dir: 'desc' })).toEqual([...aToZ].reverse());
    // Newest first is the default for Joined, by the membership's date.
    const newestFirst = ['Adiutor Tests Bravo', 'Adiutor Tests alpha', 'Adiutor Tests Charlie'];
    expect(await names({ sort: 'joined' })).toEqual(newestFirst);
    expect(await names({ sort: 'joined', dir: 'asc' })).toEqual([...newestFirst].reverse());
    const newest = firstRow(
      (await listUserCompanies(ctx, admin, maya, { sort: 'joined' })).items,
      'the newest company',
    );
    expect(newest.joinedAt).toEqual(new Date(Date.UTC(2026, 0, 3)));
  });

  it('pages their companies, counting all of them, and the last page for one past it', async () => {
    const maya = await createUser(db, 'maya@adiutor.test');
    await joinNumberedCompanies(maya, 30);

    const first = await listUserCompanies(ctx, admin, maya);
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first company').name).toBe('Adiutor Tests 01');

    const second = await listUserCompanies(ctx, admin, maya, { page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items.map((listed) => listed.name)).toEqual([
      'Adiutor Tests 26',
      'Adiutor Tests 27',
      'Adiutor Tests 28',
      'Adiutor Tests 29',
      'Adiutor Tests 30',
    ]);

    const past = await listUserCompanies(ctx, admin, maya, { page: 99 });
    expect(past.page).toBe(2);
    expect(past.items.map((listed) => listed.id)).toEqual(second.items.map((listed) => listed.id));

    const fifty = await listUserCompanies(ctx, admin, maya, { size: 50 });
    expect(fifty).toMatchObject({ total: 30, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(30);
  });

  it('works out whether their role requires MFA from all their companies, not the page shown', async () => {
    const owner = await createUser(db, 'owner@adiutor.test');
    await joinNumberedCompanies(owner, 25);
    // Sorts after the other 25 by name, so it's on the second page.
    const zulu = await createCompany(db, { name: 'Adiutor Tests Zulu' });
    await addMember(db, zulu.id, owner, 'admin');

    const companies = await listUserCompanies(ctx, admin, owner);
    expect(companies).toMatchObject({ total: 26, page: 1, size: 25 });
    expect(companies.items.map((listed) => listed.name)).not.toContain('Adiutor Tests Zulu');
    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'required',
      required: true,
    });

    const second = await listUserCompanies(ctx, admin, owner, { page: 2 });
    expect(second.items).toEqual([
      expect.objectContaining({ id: zulu.id, role: 'admin', deactivated: false }),
    ]);

    // It's the Admin role that requires it: as a Client there, MFA is optional.
    await db.update(membership).set({ role: 'client' }).where(eq(membership.companyId, zulu.id));
    expect((await getUserDetail(ctx, admin, owner)).mfa).toMatchObject({
      status: 'optional',
      required: false,
    });
  });

  it('pages their devices, and refuses them without the right to manage users', async () => {
    await createSessionsOnJanuaryDays(jane, 30);

    const first = await listUserDevices(ctx, admin, jane, { size: 25 });
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the newest device').userAgent).toBe('Browser 30');

    const second = await listUserDevices(ctx, admin, jane, { size: 25, page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2 });
    expect(second.items.map((found) => found.userAgent)).toEqual([
      'Browser 05',
      'Browser 04',
      'Browser 03',
      'Browser 02',
      'Browser 01',
    ]);

    const oldestFirst = await listUserDevices(ctx, admin, jane, { dir: 'asc' });
    expect(defined(oldestFirst.items[0], 'the oldest device').userAgent).toBe('Browser 01');

    // Support can't see devices, whatever the page asks for.
    const support = await staffActor(db, 'support');
    await expect(listUserDevices(ctx, support, jane, { size: 25 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
