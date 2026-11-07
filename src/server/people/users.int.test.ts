/**
 * @file Integration tests for the users list and staff access, against the
 * test database.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { user } from '@/db/schema';
import { defined } from '@/lib/defined';

import {
  addMember,
  addPasskey,
  connectGitHub,
  createCompany,
  createStaffSettings,
  createUser,
  enableTwoFactor,
  inSequence,
  setupTestContext,
  staffActor,
  turnOffGitHubSignIn,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { getProviderMfaWarning, type ListUsersOptions, listUsers } from './users';

const { ctx, db } = setupTestContext();

let clientA: Awaited<ReturnType<typeof createCompany>>;
let clientB: Awaited<ReturnType<typeof createCompany>>;
let admin: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  clientA = await createCompany(db, { name: 'Adiutor Tests A' });
  clientB = await createCompany(db, { name: 'Adiutor Tests B' });
  admin = await staffActor(db, 'platform_admin', 'zed-admin@adiutor.test');
});

describe('listUsers', () => {
  it('lists everyone by name, with their staff role and companies', async () => {
    const amy = await createUser(db, 'amy@adiutor.test');
    await addMember(db, clientB.id, amy, 'client');
    await addMember(db, clientA.id, amy, 'watcher');
    await createUser(db, 'loner@adiutor.test');

    const users = await listUsers(ctx, admin);

    expect(users.items.map(({ email }) => email)).toEqual([
      'amy@adiutor.test',
      'loner@adiutor.test',
      'zed-admin@adiutor.test',
    ]);
    expect(users).toMatchObject({ total: 3, page: 1, size: 25 });
    expect(users.items[0]).toMatchObject({
      staffRole: null,
      companies: [
        { id: clientA.id, name: 'Adiutor Tests A' },
        { id: clientB.id, name: 'Adiutor Tests B' },
      ],
    });
    expect(users.items[1]).toMatchObject({ staffRole: null, companies: [] });
    expect(users.items[2]).toMatchObject({ staffRole: 'platform_admin', companies: [] });
  });

  it('searches names and email addresses, case-insensitively and literally', async () => {
    await createUser(db, 'amy@adiutor.test');
    await createUser(db, 'bob_100%@adiutor.test');

    expect(
      (await listUsers(ctx, admin, { search: 'AMY' })).items.map(({ email }) => email),
    ).toEqual(['amy@adiutor.test']);
    expect(
      (await listUsers(ctx, admin, { search: '100%' })).items.map(({ email }) => email),
    ).toEqual(['bob_100%@adiutor.test']);
    expect((await listUsers(ctx, admin, { search: 'nobody' })).items).toEqual([]);

    // LIKE wildcards and SQL metacharacters are treated as literal text, never as a pattern or
    // injection: `%` and `_` match only the address that literally contains them, and a SQL
    // fragment matches nobody instead of returning every row.
    const onlyBob = ['bob_100%@adiutor.test'];
    expect((await listUsers(ctx, admin, { search: '%' })).items.map(({ email }) => email)).toEqual(
      onlyBob,
    );
    expect((await listUsers(ctx, admin, { search: '_' })).items.map(({ email }) => email)).toEqual(
      onlyBob,
    );
    expect((await listUsers(ctx, admin, { search: "' OR '1'='1" })).items).toEqual([]);
    expect((await listUsers(ctx, admin, { search: '\'; drop table "user"; --' })).items).toEqual(
      [],
    );
  });

  it('filters to the staff or to everyone else', async () => {
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    await addMember(db, clientA.id, support.id, 'client');
    await createUser(db, 'amy@adiutor.test');

    expect(
      (await listUsers(ctx, admin, { filter: 'staff' })).items.map(({ email }) => email),
    ).toEqual(['sam@adiutor.test', 'zed-admin@adiutor.test']);
    expect(
      (await listUsers(ctx, admin, { filter: 'not_staff' })).items.map(({ email }) => email),
    ).toEqual(['amy@adiutor.test']);
  });
});

describe('listUsers account state', () => {
  it('returns MFA status, verification and activity, with filters for both', async () => {
    const amy = await createUser(db, 'amy@adiutor.test');
    await addMember(db, clientA.id, amy, 'client');
    const gone = await createUser(db, 'gone@adiutor.test');
    await db
      .update(user)
      .set({ deactivatedAt: new Date(), emailVerified: false })
      .where(eq(user.id, gone));
    await enableTwoFactor(db, admin.id);
    const manager = await staffActor(db, 'manager', 'max@adiutor.test');
    await db
      .update(user)
      .set({ lastActiveAt: new Date('2026-10-23T12:00:00Z') })
      .where(eq(user.id, manager.id));

    const users = (await listUsers(ctx, admin)).items;
    const byEmail = Object.fromEntries(users.map((listed) => [listed.email, listed]));
    expect(byEmail['zed-admin@adiutor.test']).toMatchObject({ mfa: 'protected' });
    expect(byEmail['max@adiutor.test']).toMatchObject({
      mfa: 'required',
      lastActiveAt: new Date('2026-10-23T12:00:00Z'),
    });
    expect(byEmail['amy@adiutor.test']).toMatchObject({ mfa: 'optional', lastActiveAt: null });

    // Company Admins need MFA too, while their company is active.
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, clientA.id, owner, 'admin');
    const pastOwner = await createUser(db, 'past.owner@adiutor.test');
    const closed = await createCompany(db, { name: 'Adiutor Tests Closed', deactivated: true });
    await addMember(db, closed.id, pastOwner, 'admin');
    const withAdmins = Object.fromEntries(
      (await listUsers(ctx, admin)).items.map((listed) => [listed.email, listed.mfa]),
    );
    expect(withAdmins['owner@adiutor.test']).toBe('required');
    expect(withAdmins['past.owner@adiutor.test']).toBe('optional');
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(user).where(eq(user.id, pastOwner));
    expect(byEmail['gone@adiutor.test']).toMatchObject({ emailVerified: false });
    expect(
      defined(byEmail['gone@adiutor.test'], 'the deactivated user').deactivatedAt,
    ).toBeInstanceOf(Date);

    const withoutMfa = await listUsers(ctx, admin, { filter: 'without_mfa' });
    expect(withoutMfa.items.map(({ email }) => email)).toEqual([
      'amy@adiutor.test',
      'gone@adiutor.test',
      'max@adiutor.test',
    ]);
    expect(withoutMfa.total).toBe(3);
    const deactivated = await listUsers(ctx, admin, { filter: 'deactivated' });
    expect(deactivated.items.map(({ email }) => email)).toEqual(['gone@adiutor.test']);
  });

  it('shows staff who sign in only with GitHub with 2FA as without MFA while GitHub sign-in is off', async () => {
    const manager = await staffActor(db, 'manager', 'max@adiutor.test');
    await connectGitHub(db, manager.id);
    /**
     * Lists the users without MFA.
     *
     * @returns Their email addresses and MFA status.
     */
    const withoutMfa = async () =>
      (await listUsers(ctx, admin, { filter: 'without_mfa' })).items.map(({ email, mfa }) => [
        email,
        mfa,
      ]);

    expect(await withoutMfa()).toEqual([['zed-admin@adiutor.test', 'required']]);
    turnOffGitHubSignIn();
    expect(await withoutMfa()).toEqual([
      ['max@adiutor.test', 'required'],
      ['zed-admin@adiutor.test', 'required'],
    ]);
  });
});

describe('getProviderMfaWarning', () => {
  /**
   * Creates a user who signs in only with GitHub, with 2FA on.
   *
   * @param email - Their address.
   * @returns Their ID.
   */
  async function githubOnly(email: string): Promise<string> {
    const id = await createUser(db, email);
    await connectGitHub(db, id);
    return id;
  }

  it('says nothing while every provider that can prove MFA is configured', async () => {
    const manager = await githubOnly('manager@adiutor.test');
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, manager));

    expect(await getProviderMfaWarning(ctx, admin)).toBeNull();
  });

  it('counts the active users whose role requires MFA and who had it only through it', async () => {
    const manager = await githubOnly('manager@adiutor.test');
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, manager));
    const companyAdmin = await githubOnly('owner@adiutor.test');
    await addMember(db, clientA.id, companyAdmin, 'admin');
    // Not counted: MFA another way, a role that doesn't require it, deactivated, or no 2FA at GitHub.
    const withPasskey = await githubOnly('passkey@adiutor.test');
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, withPasskey));
    await addPasskey(db, withPasskey);
    await githubOnly('client@adiutor.test');
    const leaver = await githubOnly('leaver@adiutor.test');
    await db
      .update(user)
      .set({ platformRole: 'platform_admin', deactivatedAt: new Date() })
      .where(eq(user.id, leaver));
    const without2fa = await createUser(db, 'no2fa@adiutor.test');
    await connectGitHub(db, without2fa, false);
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, without2fa));

    turnOffGitHubSignIn();

    expect(await getProviderMfaWarning(ctx, admin)).toEqual({ count: 2, providers: ['github'] });
  });

  it('is only for staff Admins', async () => {
    const manager = await githubOnly('manager@adiutor.test');
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, manager));
    turnOffGitHubSignIn();

    expect(await getProviderMfaWarning(ctx, await staffActor(db, 'manager'))).toBeNull();
    expect(await getProviderMfaWarning(ctx, admin)).not.toBeNull();
  });
});

describe('listUsers sorting and paging', () => {
  /**
   * The people the sort tests add, named by the part of their email before the `@`. With
   * `zed-admin` from the fixtures (never active, created just now), their names, last activity
   * and join dates each order them differently: by name 'amy' (cal), 'Bob' (dee), 'cara' (bea),
   * then eve and fay, who have no name and sort as their emails do, and 'zed-admin'.
   */
  const people = [
    { key: 'bea', name: 'cara', lastActive: null, joined: '2020-03-01T00:00:00Z' },
    { key: 'cal', name: 'amy', lastActive: '2026-05-01T00:00:00Z', joined: '2020-01-01T00:00:00Z' },
    { key: 'dee', name: 'Bob', lastActive: '2026-06-01T00:00:00Z', joined: '2020-02-01T00:00:00Z' },
    { key: 'eve', name: '', lastActive: '2026-04-01T00:00:00Z', joined: '2020-04-01T00:00:00Z' },
    { key: 'fay', name: '   ', lastActive: null, joined: '2020-05-01T00:00:00Z' },
  ] as const;

  /**
   * Adds {@link people}, one at a time (so their accounts get IDs in this order), with their
   * names, last activity and creation dates set.
   */
  async function addPeople(): Promise<void> {
    await inSequence(people, async (person) => {
      const id = await createUser(db, `${person.key}@adiutor.test`);
      await db
        .update(user)
        .set({
          name: person.name,
          lastActiveAt: person.lastActive ? new Date(person.lastActive) : null,
          createdAt: new Date(person.joined),
        })
        .where(eq(user.id, id));
    });
  }

  /**
   * Lists the users in an order.
   *
   * @param options - Search, filter, sort and page.
   * @returns The part of each user's email before the `@`, in order.
   */
  async function order(options: ListUsersOptions = {}): Promise<string[]> {
    const { items } = await listUsers(ctx, admin, options);
    return items.map(({ email }) => defined(email.split('@')[0], 'the part before the @'));
  }

  it('sorts by the name shown, ignoring case, with a missing name sorting by email', async () => {
    await addPeople();

    // Name A to Z is the default.
    const aToZ = ['cal', 'dee', 'bea', 'eve', 'fay', 'zed-admin'];
    expect(await order()).toEqual(aToZ);
    expect(await order({ sort: 'name', dir: 'asc' })).toEqual(aToZ);
    expect(await order({ sort: 'name', dir: 'desc' })).toEqual([...aToZ].reverse());
  });

  it('sorts by email in both directions', async () => {
    await addPeople();

    const aToZ = ['bea', 'cal', 'dee', 'eve', 'fay', 'zed-admin'];
    expect(await order({ sort: 'email' })).toEqual(aToZ);
    expect(await order({ sort: 'email', dir: 'desc' })).toEqual([...aToZ].reverse());
  });

  it('sorts by last activity, most recent first by default, with never active last', async () => {
    await addPeople();

    // bea, fay and zed-admin were never active.
    const mostRecent = await order({ sort: 'last-active' });
    expect(mostRecent.slice(0, 3)).toEqual(['dee', 'cal', 'eve']);
    expect(mostRecent.slice(3).sort()).toEqual(['bea', 'fay', 'zed-admin']);
    expect(await order({ sort: 'last-active', dir: 'desc' })).toEqual(mostRecent);

    // The other way round, those never active come first.
    const leastRecent = await order({ sort: 'last-active', dir: 'asc' });
    expect(leastRecent.slice(0, 3).sort()).toEqual(['bea', 'fay', 'zed-admin']);
    expect(leastRecent.slice(3)).toEqual(['eve', 'cal', 'dee']);
  });

  it('sorts by when the account was created, newest first by default', async () => {
    await addPeople();

    // zed-admin was created just now, the others in 2020.
    const newestFirst = ['zed-admin', 'fay', 'eve', 'bea', 'dee', 'cal'];
    expect(await order({ sort: 'joined' })).toEqual(newestFirst);
    expect(await order({ sort: 'joined', dir: 'asc' })).toEqual([...newestFirst].reverse());
  });

  it('gives exactly the reverse order for the other direction of every sort', async () => {
    await addPeople();

    await inSequence(['name', 'email', 'last-active', 'joined'] as const, async (sort) => {
      const ascending = await order({ sort, dir: 'asc' });
      expect(await order({ sort, dir: 'desc' })).toEqual([...ascending].reverse());
    });
  });

  it('shows 25 users a page, counting all of them, and the last page for one past it', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        createUser(db, `user${String(index + 1).padStart(2, '0')}@adiutor.test`),
      ),
    );

    // The 30 users and zed-admin, who sorts last.
    const first = await listUsers(ctx, admin);
    expect(first).toMatchObject({ total: 31, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    expect(defined(first.items[0], 'the first user').email).toBe('user01@adiutor.test');
    expect(defined(first.items[24], 'the last user on the page').email).toBe('user25@adiutor.test');

    const second = await listUsers(ctx, admin, { page: 2 });
    expect(second).toMatchObject({ total: 31, page: 2, size: 25 });
    expect(second.items.map(({ email }) => email)).toEqual([
      'user26@adiutor.test',
      'user27@adiutor.test',
      'user28@adiutor.test',
      'user29@adiutor.test',
      'user30@adiutor.test',
      'zed-admin@adiutor.test',
    ]);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(31);

    const past = await listUsers(ctx, admin, { page: 99 });
    expect(past).toMatchObject({ total: 31, page: 2 });
    expect(past.items.map(({ id }) => id)).toEqual(second.items.map(({ id }) => id));

    const fifty = await listUsers(ctx, admin, { size: 50 });
    expect(fifty).toMatchObject({ total: 31, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(31);
  });

  it('pages the users without MFA, counting only them, with the companies of the page', async () => {
    /**
     * The address of one of the 40 users.
     *
     * @param number - Their number, from 1.
     * @returns Their email address.
     */
    const emailOf = (number: number) => `user${String(number).padStart(2, '0')}@adiutor.test`;
    const created = await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        const number = index + 1;
        const id = await createUser(db, emailOf(number));
        // Every fourth user has an authenticator app, so they're protected.
        if (number % 4 === 0) {
          await enableTwoFactor(db, id);
        }
        return { number, id };
      }),
    );
    // So does zed-admin, who sorts last: leaving only users 1 to 40 who aren't multiples of 4.
    await enableTwoFactor(db, admin.id);
    /**
     * Finds one of the 40 users.
     *
     * @param number - Their number, from 1.
     * @returns Their user ID.
     */
    const idOf = (number: number) =>
      defined(
        created.find((found) => found.number === number),
        `user ${number}`,
      ).id;
    await addMember(db, clientA.id, idOf(2), 'client');
    await addMember(db, clientB.id, idOf(2), 'watcher');
    // User 38 is on the second page, 4 is protected (and so never listed), 10 must have MFA as Admin.
    await addMember(db, clientB.id, idOf(38), 'client');
    await addMember(db, clientA.id, idOf(4), 'client');
    await addMember(db, clientA.id, idOf(10), 'admin');

    const expected = created.map(({ number }) => number).filter((number) => number % 4 !== 0);
    expect(expected).toHaveLength(30);
    const filter = 'without_mfa';

    const first = await listUsers(ctx, admin, { filter });
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items.map(({ email }) => email)).toEqual(expected.slice(0, 25).map(emailOf));
    const second = await listUsers(ctx, admin, { filter, page: 2 });
    expect(second).toMatchObject({ total: 30, page: 2, size: 25 });
    expect(second.items.map(({ email }) => email)).toEqual(expected.slice(25).map(emailOf));
    expect(second.items).toHaveLength(5);
    // No one is on both pages, and no protected user is on either.
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(30);
    expect([...first.items, ...second.items].map(({ mfa }) => mfa)).not.toContain('protected');

    // Users without a role are optional, an Admin of an active company is required.
    expect(first.items.filter(({ mfa }) => mfa === 'required').map(({ email }) => email)).toEqual([
      emailOf(10),
    ]);
    expect(second.items.every(({ mfa }) => mfa === 'optional')).toBe(true);

    /**
     * Finds the companies shown for one of the users on a page.
     *
     * @param page - The page of users.
     * @param number - The user's number, from 1.
     * @returns Their companies, or `undefined` when they aren't on the page.
     */
    const companiesOf = (page: typeof first, number: number) =>
      page.items.find(({ email }) => email === emailOf(number))?.companies;
    // With the URL name their links use.
    const a = { id: clientA.id, name: 'Adiutor Tests A', slug: clientA.slug };
    const b = { id: clientB.id, name: 'Adiutor Tests B', slug: clientB.slug };
    expect(companiesOf(first, 2)).toEqual([a, b]);
    expect(companiesOf(first, 10)).toEqual([a]);
    expect(companiesOf(first, 1)).toEqual([]);
    expect(companiesOf(second, 38)).toEqual([b]);

    const past = await listUsers(ctx, admin, { filter, page: 99 });
    expect(past).toMatchObject({ total: 30, page: 2 });
    expect(past.items.map(({ id }) => id)).toEqual(second.items.map(({ id }) => id));

    const fifty = await listUsers(ctx, admin, { filter, size: 50 });
    expect(fifty).toMatchObject({ total: 30, page: 1, size: 50 });
    expect(fifty.items).toHaveLength(30);

    // Both pages follow the sort, which can be reversed or by another column.
    const reversed = [...expected].reverse().map(emailOf);
    const lastFirst = await listUsers(ctx, admin, { filter, sort: 'name', dir: 'desc' });
    expect(lastFirst.items.map(({ email }) => email)).toEqual(reversed.slice(0, 25));
    const lastSecond = await listUsers(ctx, admin, { filter, sort: 'email', dir: 'desc', page: 2 });
    expect(lastSecond).toMatchObject({ total: 30, page: 2 });
    expect(lastSecond.items.map(({ email }) => email)).toEqual(reversed.slice(25));
  });

  it('combines a search with a filter, a sort and a page', async () => {
    // A Support member, a user with an authenticator app, a deactivated user and two others.
    await staffActor(db, 'support', 'ann.two@adiutor.test');
    const one = await createUser(db, 'ann.one@adiutor.test');
    await enableTwoFactor(db, one);
    await createUser(db, 'ann.three@adiutor.test');
    await createUser(db, 'bob@adiutor.test');
    const four = await createUser(db, 'ann.four@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, four));

    // Everyone matching the search, by name.
    expect(await order({ search: 'ANN' })).toEqual(['ann.four', 'ann.one', 'ann.three', 'ann.two']);
    expect(await order({ search: 'ANN', filter: 'not_staff' })).toEqual([
      'ann.four',
      'ann.one',
      'ann.three',
    ]);
    // Sorted by email, last first.
    const notStaff = await listUsers(ctx, admin, {
      search: 'ANN',
      filter: 'not_staff',
      sort: 'email',
      dir: 'desc',
      page: 99,
    });
    expect(notStaff).toMatchObject({ total: 3, page: 1 });
    expect(notStaff.items.map(({ email }) => email.split('@')[0])).toEqual([
      'ann.three',
      'ann.one',
      'ann.four',
    ]);
    expect(await order({ search: 'ann', filter: 'staff' })).toEqual(['ann.two']);
    expect(await order({ search: 'ann', filter: 'deactivated' })).toEqual(['ann.four']);

    // Without MFA leaves out ann.one, who has an authenticator app; it follows the sort too.
    const withoutMfa = await listUsers(ctx, admin, {
      search: 'ann',
      filter: 'without_mfa',
      sort: 'name',
      dir: 'desc',
    });
    expect(withoutMfa.total).toBe(3);
    expect(withoutMfa.items.map(({ email }) => email.split('@')[0])).toEqual([
      'ann.two',
      'ann.three',
      'ann.four',
    ]);
  });
});
