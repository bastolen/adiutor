/**
 * @file Integration tests for assigning requests: adding and removing staff
 * members, each as a change of its own, who can be assigned, taking someone
 * off every request when they stop working on requests, the list of staff
 * who can be assigned and the count of someone's assigned requests. Which
 * roles may assign is in the authorization matrix.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { user } from '@/db/schema';

import {
  atTheSameMoment,
  createCompany,
  fillRateLimitBucket,
  memberActor,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import {
  changeAssignees,
  countAssignedRequests,
  listAssignableStaff,
  MAX_ASSIGNEE_CHANGES,
  unassignFrom,
} from './assignees';
import {
  assigneesOf,
  assignmentsOf,
  ctx,
  db,
  deactivatedMeanwhile,
  storeAssignees,
  storeRequest,
  storedRequest,
} from './test-helpers';

/**
 * Deactivates an account directly.
 *
 * @param userId - The account.
 */
async function deactivateAccount(userId: string): Promise<void> {
  await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));
}

describe('changeAssignees', () => {
  it('assigns staff members, each with a line in the history, and moves the last activity', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id, { lastActivityAt: minutesAgo(60) });

    const result = await changeAssignees(ctx, support, {
      request: String(raised.number),
      add: [support.id, manager.id],
      remove: [],
    });

    expect(result).toEqual({ added: 2, removed: 0 });
    expect(await assigneesOf(raised.id)).toEqual([support.id, manager.id].sort());
    expect(await assignmentsOf(raised.id)).toEqual([
      ['assigned', support.id, support.id],
      ['assigned', manager.id, support.id],
    ]);
    expect((await storedRequest(raised.id))?.lastActivityAt.getTime()).toBeGreaterThan(
      minutesAgo(1).getTime(),
    );
  });

  it('adds and removes in one change, and leaves everyone else on the request', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);
    await storeAssignees(raised.id, [support.id, manager.id]);

    const result = await changeAssignees(ctx, admin, {
      request: raised.id,
      add: [admin.id],
      remove: [support.id],
    });

    expect(result).toEqual({ added: 1, removed: 1 });
    expect(await assigneesOf(raised.id)).toEqual([admin.id, manager.id].sort());
    expect(await assignmentsOf(raised.id)).toEqual([
      ['assigned', admin.id, admin.id],
      ['unassigned', support.id, admin.id],
    ]);
  });

  it('changes nothing for someone already on it, or already off it: a colleague did the same', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { lastActivityAt: at });
    await storeAssignees(raised.id, [manager.id]);

    const result = await changeAssignees(ctx, support, {
      request: raised.id,
      add: [manager.id],
      remove: [support.id],
    });

    expect(result).toEqual({ added: 0, removed: 0 });
    expect(await assigneesOf(raised.id)).toEqual([manager.id]);
    expect(await assignmentsOf(raised.id)).toEqual([]);
    expect((await storedRequest(raised.id))?.lastActivityAt).toEqual(at);
  });

  it('adds someone who is in both lists, once', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    const result = await changeAssignees(ctx, support, {
      request: raised.id,
      add: [support.id, support.id],
      remove: [support.id],
    });

    expect(result).toEqual({ added: 1, removed: 0 });
    expect(await assigneesOf(raised.id)).toEqual([support.id]);
  });

  it.each([
    ['Finance, who only read requests', async () => (await staffActor(db, 'finance')).id],
    [
      'a deactivated staff member',
      async () => {
        const { id } = await staffActor(db, 'support');
        await deactivateAccount(id);
        return id;
      },
    ],
    [
      "someone at the request's company",
      async (companyId: string) => (await memberActor(db, companyId, 'admin')).id,
    ],
    ['an account that does not exist', async () => randomUUID()],
  ])('refuses to assign %s, and assigns nobody else either', async (_who, someone) => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const id = await someone(company.id);

    await expect(
      changeAssignees(ctx, support, { request: raised.id, add: [support.id, id], remove: [] }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.requests.notAssignable' });
    expect(await assigneesOf(raised.id)).toEqual([]);
    expect(await assignmentsOf(raised.id)).toEqual([]);
  });

  it('refuses someone whose role lost request work while they were being assigned', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    // A role change holds the account's row; the assignment waits for it and then sees Finance.
    const { second } = await atTheSameMoment(
      db,
      (tx) => tx.select({ id: user.id }).from(user).where(eq(user.id, support.id)).for('update'),
      () => changeAssignees(ctx, manager, { request: raised.id, add: [support.id], remove: [] }),
      async (tx) => {
        await tx.update(user).set({ platformRole: 'finance' }).where(eq(user.id, support.id));
      },
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: { code: 'invalid', key: 'errors.requests.notAssignable' },
    });
    expect(await assigneesOf(raised.id)).toEqual([]);
  });

  it('removes someone who can no longer be assigned', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance');
    const raised = await storeRequest(company.id);
    await storeAssignees(raised.id, [finance.id]);

    await changeAssignees(ctx, support, { request: raised.id, add: [], remove: [finance.id] });

    expect(await assigneesOf(raised.id)).toEqual([]);
  });

  it('refuses a change to a request of a deactivated company, also from the staff', async () => {
    const company = await createCompany(db, { deactivated: true });
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);

    await expect(
      changeAssignees(ctx, manager, { request: raised.id, add: [manager.id], remove: [] }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await assigneesOf(raised.id)).toEqual([]);
  });

  it('refuses a change when the company was deactivated while it was under way', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);

    const ended = await deactivatedMeanwhile(manager.id, company.id, () =>
      changeAssignees(ctx, manager, { request: raised.id, add: [manager.id], remove: [] }),
    );

    expect(ended).toMatchObject({
      status: 'rejected',
      reason: { code: 'invalid', key: 'errors.companyDeactivated' },
    });
    expect(await assigneesOf(raised.id)).toEqual([]);
  });

  it('refuses what is not a user ID, and more people than one change can hold', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      changeAssignees(ctx, support, { request: raised.id, add: ['someone'], remove: [] }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      changeAssignees(ctx, support, {
        request: raised.id,
        add: [],
        remove: Array.from({ length: MAX_ASSIGNEE_CHANGES + 1 }, () => randomUUID()),
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('stops at the limit of changes one person makes', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await fillRateLimitBucket(
      db,
      `request-change:user:${support.id}`,
      RATE_LIMITS.requestChangesPerUser.limit,
    );

    await expect(
      changeAssignees(ctx, support, { request: raised.id, add: [support.id], remove: [] }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await assigneesOf(raised.id)).toEqual([]);
  });
});

describe('unassignFrom', () => {
  it('takes someone off every request, each with a line by nobody, and leaves the others', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const first = await storeRequest(company.id, { lastActivityAt: minutesAgo(60) });
    const second = await storeRequest(company.id);
    const untouched = await storeRequest(company.id);
    await storeAssignees(first.id, [support.id, manager.id]);
    await storeAssignees(second.id, [support.id]);
    await storeAssignees(untouched.id, [manager.id]);

    const removed = await db.transaction((tx) => unassignFrom(tx, support.id));

    expect(removed).toBe(2);
    expect(await assigneesOf(first.id)).toEqual([manager.id]);
    expect(await assigneesOf(second.id)).toEqual([]);
    expect(await assigneesOf(untouched.id)).toEqual([manager.id]);
    expect(await assignmentsOf(first.id)).toEqual([['unassigned', support.id, null]]);
    expect(await assignmentsOf(untouched.id)).toEqual([]);
    expect((await storedRequest(first.id))?.lastActivityAt.getTime()).toBeGreaterThan(
      minutesAgo(1).getTime(),
    );
  });

  it('does nothing for someone on no request', async () => {
    const support = await staffActor(db, 'support');

    expect(await db.transaction((tx) => unassignFrom(tx, support.id))).toBe(0);
  });
});

describe('listAssignableStaff', () => {
  it('lists the active staff who work on requests, by name, with nothing but their names', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const admin = await staffActor(db, 'platform_admin');
    const finance = await staffActor(db, 'finance');
    const gone = await staffActor(db, 'manager');
    await deactivateAccount(gone.id);
    const member = await memberActor(db, company.id, 'admin');
    await db.update(user).set({ name: 'Zoe Support' }).where(eq(user.id, support.id));
    await db.update(user).set({ name: 'Ada Admin' }).where(eq(user.id, admin.id));

    const staff = await listAssignableStaff(ctx, finance);

    const ids = staff.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([support.id, admin.id]));
    expect(ids).not.toContain(finance.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(member.id);
    expect(ids.indexOf(admin.id)).toBeLessThan(ids.indexOf(support.id));
    expect(staff.find(({ id }) => id === admin.id)).toEqual({ id: admin.id, name: 'Ada Admin' });
  });

  it('is only for the staff', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    await expect(listAssignableStaff(ctx, client)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('countAssignedRequests', () => {
  it("counts the actor's requests that still need something, in active companies", async () => {
    const company = await createCompany(db);
    const deactivated = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const open = await storeRequest(company.id);
    const waiting = await storeRequest(company.id, { status: 'waiting' });
    const done = await storeRequest(company.id, { status: 'done' });
    const elsewhere = await storeRequest(deactivated.id);
    const theirs = await storeRequest(company.id);
    await Promise.all(
      [open, waiting, done, elsewhere].map(({ id }) => storeAssignees(id, [support.id])),
    );
    await storeAssignees(theirs.id, [manager.id]);

    expect(await countAssignedRequests(ctx, support)).toBe(2);
    expect(await countAssignedRequests(ctx, manager)).toBe(1);
  });
});
