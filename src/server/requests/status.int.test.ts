/**
 * @file Integration tests for changing a request's status. Which roles may
 * change it is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { request, requestEntry } from '@/db/schema';
import { REQUEST_STATUSES } from '@/lib/requests';

import {
  createCompany,
  fillRateLimitBucket,
  inSequence,
  memberActor,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import changeRequestStatus from './status';
import { ctx, db, storeRequest } from './test-helpers';

/**
 * Loads a request as it's stored.
 *
 * @param id - The request's ID.
 * @returns The row.
 */
async function stored(id: string) {
  const [found] = await db.select().from(request).where(eq(request.id, id));
  return found;
}

/**
 * The status changes in a request's history, in order.
 *
 * @param requestId - The request.
 * @returns Each change as `[from, to, side]`.
 */
async function changes(requestId: string) {
  const entries = await db
    .select()
    .from(requestEntry)
    .where(eq(requestEntry.requestId, requestId))
    .orderBy(requestEntry.id);
  return entries.map(({ kind, fromValue, toValue, authorSide }) => [
    kind,
    fromValue,
    toValue,
    authorSide,
  ]);
}

describe('changeRequestStatus: the staff', () => {
  it('move a request through every status, each change in its history', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { lastActivityAt: minutesAgo(60) });

    const results = await inSequence(['todo', 'in_progress', 'waiting', 'done'], (status) =>
      changeRequestStatus(ctx, support, { request: String(raised.number), status }),
    );

    expect(results).toEqual([
      { changed: true, reopened: false, status: 'todo' },
      { changed: true, reopened: false, status: 'in_progress' },
      { changed: true, reopened: false, status: 'waiting' },
      { changed: true, reopened: false, status: 'done' },
    ]);
    expect(await changes(raised.id)).toEqual([
      ['status', 'open', 'todo', 'staff'],
      ['status', 'todo', 'in_progress', 'staff'],
      ['status', 'in_progress', 'waiting', 'staff'],
      ['status', 'waiting', 'done', 'staff'],
    ]);
    const after = await stored(raised.id);
    expect(after).toMatchObject({ status: 'done', reopenedAt: null });
    expect(after?.lastActivityAt.getTime()).toBeGreaterThan(minutesAgo(1).getTime());
  });

  it('can set any status from any other', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id, { status: 'cancelled' });

    const moves = await inSequence(
      [...REQUEST_STATUSES].reverse(),
      async (status) =>
        (await changeRequestStatus(ctx, manager, { request: raised.id, status })).changed,
    );

    // Cancelled to cancelled changes nothing; every other move does.
    expect(moves).toEqual([false, true, true, true, true, true]);
  });

  it('reopen a request by giving a closed one a status that is worked on', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'done' });

    expect(
      await changeRequestStatus(ctx, support, { request: raised.id, status: 'in_progress' }),
    ).toEqual({ changed: true, reopened: true, status: 'in_progress' });
    const reopened = await stored(raised.id);
    expect(reopened?.reopenedAt?.getTime()).toBeGreaterThan(minutesAgo(1).getTime());

    // It stays marked while it's worked on, and loses the mark when it's closed again.
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'waiting' });
    expect((await stored(raised.id))?.reopenedAt).toEqual(reopened?.reopenedAt);
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'cancelled' });
    expect((await stored(raised.id))?.reopenedAt).toBeNull();
  });

  it('do not reopen a request by moving it from done to cancelled', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'done' });

    await changeRequestStatus(ctx, support, { request: raised.id, status: 'cancelled' });

    expect(await stored(raised.id)).toMatchObject({ status: 'cancelled', reopenedAt: null });
  });
});

describe('changeRequestStatus: the company', () => {
  it.each([
    ['open', 'done'],
    ['todo', 'done'],
    ['in_progress', 'cancelled'],
    ['waiting', 'cancelled'],
  ] as const)('closes a request that is %s as %s', async (from, to) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { status: from });

    const result = await changeRequestStatus(ctx, client, { request: raised.id, status: to });

    expect(result).toEqual({ changed: true, reopened: false, status: to });
    expect(await changes(raised.id)).toEqual([['status', from, to, 'company']]);
  });

  it.each(['done', 'cancelled'] as const)(
    'reopens a request that is %s, which makes it open again and says so',
    async (from) => {
      const company = await createCompany(db);
      const admin = await memberActor(db, company.id, 'admin');
      const raised = await storeRequest(company.id, { status: from });

      const result = await changeRequestStatus(ctx, admin, { request: raised.id, status: 'open' });

      expect(result).toEqual({ changed: true, reopened: true, status: 'open' });
      expect(await changes(raised.id)).toEqual([['status', from, 'open', 'company']]);
      const after = await stored(raised.id);
      expect(after?.status).toBe('open');
      expect(after?.reopenedAt?.getTime()).toBeGreaterThan(minutesAgo(1).getTime());
    },
  );

  it.each(['todo', 'in_progress', 'waiting'])('may not set the status to %s', async (status) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);

    await expect(
      changeRequestStatus(ctx, client, { request: raised.id, status }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await changes(raised.id)).toEqual([]);
  });

  it.each([
    ['cancel a request that is done', 'done', 'cancelled'],
    ['mark a cancelled request done', 'cancelled', 'done'],
    ['reopen a request the staff already work on again', 'todo', 'open'],
  ] as const)('is told the status changed when it tries to %s', async (_what, from, to) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { status: from });

    await expect(
      changeRequestStatus(ctx, client, { request: raised.id, status: to }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.requests.statusChanged' });
    expect(await stored(raised.id)).toMatchObject({ status: from });
  });
});

describe('changeRequestStatus: refusals and no-ops', () => {
  it('leaves a request that already has the status as it is, without a line in its history', async () => {
    const company = await createCompany(db);
    const [client, support] = [
      await memberActor(db, company.id, 'client'),
      await staffActor(db, 'support'),
    ];
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { status: 'done', lastActivityAt: at });

    // Both sides mark it done after it already was: neither is refused.
    expect(await changeRequestStatus(ctx, client, { request: raised.id, status: 'done' })).toEqual({
      changed: false,
      reopened: false,
      status: 'done',
    });
    expect(await changeRequestStatus(ctx, support, { request: raised.id, status: 'done' })).toEqual(
      {
        changed: false,
        reopened: false,
        status: 'done',
      },
    );
    expect(await changes(raised.id)).toEqual([]);
    expect((await stored(raised.id))?.lastActivityAt).toEqual(at);
  });

  it('refuses a status that does not exist', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      changeRequestStatus(ctx, support, { request: raised.id, status: 'closed' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a change to a request of a deactivated company, also from the staff', async () => {
    const company = await createCompany(db, { deactivated: true });
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);

    await expect(
      changeRequestStatus(ctx, manager, { request: raised.id, status: 'done' }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await stored(raised.id)).toMatchObject({ status: 'open' });
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
      changeRequestStatus(ctx, support, { request: raised.id, status: 'todo' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await stored(raised.id)).toMatchObject({ status: 'open' });
  });
});
