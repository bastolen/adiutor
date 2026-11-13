/**
 * @file Integration tests for the queued emails about people joining,
 * against the test database: "you were added to a company" is skipped once
 * the membership is gone and names the staff when the adder's account is,
 * and "someone became a staff Admin" goes to each other staff Admin as a job
 * of its own, skipped for one who stepped down meanwhile.
 */
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { membership, queuedJob, user } from '@/db/schema';

import {
  addMember,
  createCompany,
  createUser,
  setupTestContext,
  staffActor,
} from '../../../../tests/integration/helpers';
import notifyStaffAdminAdded from '../../people/staff-admin-notice';
import { queueJob } from '../../queue';
import { runQueue } from '../run-queue';
import addedToCompanyJob from './added-to-company';
import staffAdminAddedJob from './staff-admin-added';

const { ctx, db, sent } = setupTestContext();

/**
 * Runs the queue with the two kinds.
 *
 * @returns The runs.
 */
async function sendQueued() {
  const { runs } = await runQueue(ctx, {
    trigger: 'tick',
    deadline: new Date(Date.now() + 60_000),
    startedAt: new Date(),
    kinds: [addedToCompanyJob, staffAdminAddedJob],
  });
  return runs;
}

describe('the added-to-company job', () => {
  it('is skipped when the member was removed before it went out', async () => {
    const { id: companyId } = await createCompany(db, { name: 'Adiutor Tests Client' });
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await staffActor(db, 'manager', 'sam@adiutor.test');
    await addMember(db, companyId, jane, 'client');
    await queueJob(db, addedToCompanyJob, {
      userId: jane,
      companyId,
      role: 'client',
      addedBy: sam.id,
    });
    await db
      .delete(membership)
      .where(and(eq(membership.userId, jane), eq(membership.companyId, companyId)));

    const runs = await sendQueued();

    expect(sent).toEqual([]);
    expect(runs).toEqual([
      expect.objectContaining({ summary: expect.objectContaining({ skipped: 1 }) }),
    ]);
  });

  it('names the staff when the account of whoever added them is gone', async () => {
    const { id: companyId } = await createCompany(db, { name: 'Adiutor Tests Client' });
    const jane = await createUser(db, 'jane@adiutor.test');
    const sam = await staffActor(db, 'manager', 'sam@adiutor.test');
    await addMember(db, companyId, jane, 'client');
    await queueJob(db, addedToCompanyJob, {
      userId: jane,
      companyId,
      role: 'client',
      addedBy: sam.id,
    });
    await db.execute(sql`delete from "user" where id = ${sam.id}`);

    await sendQueued();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('jane@adiutor.test');
    expect(sent[0]?.text).not.toContain('sam');
  });
});

describe('the staff-admin-added job', () => {
  it('is one job per other staff Admin, skipped for one who stepped down meanwhile', async () => {
    const actor = await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    const blake = await staffActor(db, 'platform_admin', 'blake@adiutor.test');
    await staffActor(db, 'platform_admin', 'casey@adiutor.test');
    const sam = await staffActor(db, 'platform_admin', 'sam@adiutor.test');

    await expect(
      notifyStaffAdminAdded(ctx, { newAdminId: sam.id, how: 'role', byUserId: actor.id }),
    ).resolves.toBe(2);
    expect(await db.select().from(queuedJob)).toHaveLength(2);
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, blake.id));

    await sendQueued();

    expect(sent.map((email) => email.to)).toEqual(['casey@adiutor.test']);
  });
});
