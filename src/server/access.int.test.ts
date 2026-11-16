/**
 * @file Integration tests for reading a user's permissions as they are now
 * (`currentPermissionsOf`), after a change to their own roles that their
 * actor, loaded before it, doesn't know about, and for finding a company by
 * what its address names it with (`getCompanyAccess`): its ID or URL name,
 * and "not found" for anything that can be neither.
 */
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { membership, user } from '@/db/schema';

import {
  createCompany,
  createUser,
  memberActor,
  setupTestContext,
  staffActor,
} from '../../tests/integration/helpers';
import { currentPermissionsOf, getCompanyAccess } from './access';

const { db } = setupTestContext();

let testCompany: Awaited<ReturnType<typeof createCompany>>;

beforeEach(async () => {
  testCompany = await createCompany(db, { name: 'Adiutor Tests' });
});

describe('currentPermissionsOf', () => {
  it('sees a company Admin stepping down after their actor was loaded', async () => {
    const admin = await memberActor(db, testCompany.id, 'admin', 'boss@adiutor.test');
    expect((await currentPermissionsOf(db, admin.id, testCompany.id)).has('members:view')).toBe(
      true,
    );

    await db
      .update(membership)
      .set({ role: 'watcher' })
      .where(and(eq(membership.userId, admin.id), eq(membership.companyId, testCompany.id)));

    const now = await currentPermissionsOf(db, admin.id, testCompany.id);
    expect(now.has('members:view')).toBe(false);
    expect(now.has('company:view')).toBe(true);
    // The actor loaded before still has the old role: that's why this reads them again.
    expect(admin.memberships[testCompany.id]).toBe('admin');
  });

  it('is empty once they left the company, or for a company that is not theirs', async () => {
    const admin = await memberActor(db, testCompany.id, 'admin', 'boss@adiutor.test');
    const other = await createCompany(db, { name: 'Adiutor Tests Other' });

    await db.delete(membership).where(eq(membership.userId, admin.id));

    expect([...(await currentPermissionsOf(db, admin.id, testCompany.id))]).toEqual([]);
    expect([...(await currentPermissionsOf(db, admin.id, other.id))]).toEqual([]);
    expect([...(await currentPermissionsOf(db, admin.id, 'not-an-id'))]).toEqual([]);
  });

  it('sees a staff Admin stepping down, in the permissions that are not about a company', async () => {
    const staffAdmin = await staffActor(db, 'platform_admin', 'staff-boss@adiutor.test');
    expect((await currentPermissionsOf(db, staffAdmin.id, null)).has('staff:manage')).toBe(true);

    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, staffAdmin.id));

    const now = await currentPermissionsOf(db, staffAdmin.id, null);
    expect(now.has('staff:manage')).toBe(false);
    expect(now.has('users:view')).toBe(true);
    // Staff Managers keep their rights in every company.
    expect(
      (await currentPermissionsOf(db, staffAdmin.id, testCompany.id)).has('members:view'),
    ).toBe(true);
  });

  it('is empty for a deactivated or unknown user', async () => {
    const staffAdmin = await staffActor(db, 'platform_admin', 'staff-boss@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, staffAdmin.id));
    const nobody = await createUser(db, 'gone@adiutor.test');
    await db.delete(user).where(eq(user.id, nobody));

    expect([...(await currentPermissionsOf(db, staffAdmin.id, null))]).toEqual([]);
    expect([...(await currentPermissionsOf(db, nobody, null))]).toEqual([]);
  });
});

describe('getCompanyAccess', () => {
  it('finds a company by its URL name, in any case, as it does by its ID', async () => {
    const companyAdmin = await memberActor(db, testCompany.id, 'admin');

    const byId = await getCompanyAccess(db, companyAdmin, testCompany.id);
    const byName = await getCompanyAccess(db, companyAdmin, testCompany.slug);
    const byShouting = await getCompanyAccess(db, companyAdmin, testCompany.slug.toUpperCase());

    expect(byName.company.id).toBe(testCompany.id);
    expect(byShouting.company.id).toBe(testCompany.id);
    expect([...byName.permissions].sort()).toEqual([...byId.permissions].sort());
  });

  it('gives the same not found for an unknown URL name and for a company the user can’t see', async () => {
    const outsider = await memberActor(db, (await createCompany(db)).id, 'admin');

    await expect(getCompanyAccess(db, outsider, 'adiutor-tests-unknown')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(getCompanyAccess(db, outsider, testCompany.slug)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it.each([
    ['a NUL character, which Postgres refuses in a query', '\u0000'],
    ['a URL name with a NUL character in it', 'adiutor\u0000tests'],
    ['a line break', 'adiutor\ntests'],
    ['characters a URL name never has', 'Adiutor Tests!'],
    ['nothing', ''],
  ])('answers not found, without an error, for %s', async (_name, reference) => {
    const staff = await staffActor(db, 'platform_admin');

    await expect(getCompanyAccess(db, staff, reference)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('finds a company by its ID in any case, and with spaces around either', async () => {
    const staff = await staffActor(db, 'platform_admin');

    const found = await Promise.all(
      [testCompany.id.toUpperCase(), ` ${testCompany.id} `, ` ${testCompany.slug} `].map(
        (reference) => getCompanyAccess(db, staff, reference),
      ),
    );

    expect(found.map((access) => access.company.id)).toEqual([
      testCompany.id,
      testCompany.id,
      testCompany.id,
    ]);
  });
});
