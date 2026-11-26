/**
 * @file Integration tests for who the staff can raise a request for. Which
 * roles may list them is in the authorization matrix; raising one for
 * someone is in `raise.int.test.ts`.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { user } from '@/db/schema';

import {
  addMember,
  createCompany,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import mentionKey from './mention-key';
import { listRaisableFor } from './raise-for';
import { ctx, db } from './test-helpers';

/**
 * Gives a user a name.
 *
 * @param userId - The user.
 * @param name - Their name.
 */
async function rename(userId: string, name: string): Promise<void> {
  await db.update(user).set({ name }).where(eq(user.id, userId));
}

describe('listRaisableFor', () => {
  it('lists the company’s active Admins and Clients with a name, by name and with their key', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const admin = await memberActor(db, company.id, 'admin');
    const client = await memberActor(db, company.id, 'client');
    await rename(admin.id, 'Bea Adiutor');
    await rename(client.id, 'Ann Adiutor');
    // Left out: a Watcher, a deactivated account, someone without a name, someone elsewhere, and
    // a staff member who works on requests and is a Client too, whose own request is the staff's.
    await memberActor(db, company.id, 'watcher');
    const gone = await memberActor(db, company.id, 'client');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, gone.id));
    const nameless = await memberActor(db, company.id, 'client');
    await rename(nameless.id, ' ');
    await memberActor(db, (await createCompany(db)).id, 'client');
    const manager = await staffActor(db, 'manager');
    await addMember(db, company.id, manager.id, 'client');

    expect(await listRaisableFor(ctx, support, company.slug)).toEqual([
      { key: mentionKey(company.id, client.id), name: 'Ann Adiutor' },
      { key: mentionKey(company.id, admin.id), name: 'Bea Adiutor' },
    ]);
  });

  it('lists a staff member who doesn’t work on requests but is a Client there', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance');
    await addMember(db, company.id, finance.id, 'client');

    expect(await listRaisableFor(ctx, support, company.id)).toEqual([
      { key: mentionKey(company.id, finance.id), name: finance.name },
    ]);
  });

  it('lists nobody in a deactivated company', async () => {
    const company = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');
    await memberActor(db, company.id, 'client');

    expect(await listRaisableFor(ctx, support, company.id)).toEqual([]);
  });

  it('refuses the company’s own people, even its Admin', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');

    await expect(listRaisableFor(ctx, admin, company.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
