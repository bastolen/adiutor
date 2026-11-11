/**
 * @file Integration tests for the last-Admin rule (`soleAdminOf` and the
 * refusals of the changes that use it), against the test database.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user } from '@/db/schema';

import { deactivateUser, deleteUser, soleAdminOf } from '.';
import { addMember, createCompany, createUser } from '../../../../tests/integration/helpers';
import { admin, ctx, db, testCompany } from './test-helpers';

describe('soleAdminOf', () => {
  it('refuses to remove the last Admin of a company who can sign in', async () => {
    const companyAdmin = await createUser(db, 'boss@adiutor.test');
    await addMember(db, testCompany.id, companyAdmin, 'admin');

    await expect(deactivateUser(ctx, admin, companyAdmin)).rejects.toMatchObject({
      code: 'conflict',
      key: 'errors.soleAdmin.user.companies',
      values: { companies: 'Adiutor Tests Client' },
    });

    // A second Admin who is deactivated doesn't count.
    const other = await createUser(db, 'other@adiutor.test');
    await addMember(db, testCompany.id, other, 'admin');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, other));
    expect(await soleAdminOf(db, companyAdmin)).toEqual({
      staff: false,
      companies: ['Adiutor Tests Client'],
    });

    await db.update(user).set({ deactivatedAt: null }).where(eq(user.id, other));
    await expect(
      deleteUser(ctx, admin, companyAdmin, 'boss@adiutor.test'),
    ).resolves.toBeUndefined();
  });

  it('ignores deactivated companies for the last-Admin rule', async () => {
    const closed = await createCompany(db, { deactivated: true });
    const owner = await createUser(db, 'owner@adiutor.test');
    await addMember(db, closed.id, owner, 'admin');
    expect(await soleAdminOf(db, owner)).toEqual({ staff: false, companies: [] });
  });
});
