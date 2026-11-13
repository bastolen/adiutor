/**
 * @file Integration tests for changing a request's title, type and priority.
 * Which roles may change them is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { request, requestEntry } from '@/db/schema';

import {
  createCompany,
  fillRateLimitBucket,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import updateRequestDetails from './details';
import { ctx, db, storeRequest } from './test-helpers';

/** The details of a stored request as a form would send them back unchanged. */
const SAME = { title: 'The printer is broken', type: 'bug', priority: 'normal' } as const;

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
 * The changes in a request's history, in order.
 *
 * @param requestId - The request.
 * @returns Each change as `[kind, from, to, side]`.
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

describe('updateRequestDetails', () => {
  it('changes the title, type and priority, each with a line in the history', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, {
      title: 'Help',
      lastActivityAt: minutesAgo(60),
    });

    const result = await updateRequestDetails(ctx, support, {
      request: String(raised.number),
      title: '  The printer on floor 2 is broken ',
      type: 'hotfix',
      priority: 'high',
    });

    expect(result).toEqual({ changed: 3 });
    expect(await stored(raised.id)).toMatchObject({
      title: 'The printer on floor 2 is broken',
      type: 'hotfix',
      priority: 'high',
    });
    expect(await changes(raised.id)).toEqual([
      ['title', 'Help', 'The printer on floor 2 is broken', 'staff'],
      ['type', 'bug', 'hotfix', 'staff'],
      ['priority', 'normal', 'high', 'staff'],
    ]);
    expect((await stored(raised.id))?.lastActivityAt.getTime()).toBeGreaterThan(
      minutesAgo(1).getTime(),
    );
  });

  it('changes nothing, and adds nothing to the history, when the details are the same', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { lastActivityAt: at });

    const result = await updateRequestDetails(ctx, support, { ...SAME, request: raised.id });

    expect(result).toEqual({ changed: 0 });
    expect(await changes(raised.id)).toEqual([]);
    expect((await stored(raised.id))?.lastActivityAt).toEqual(at);
  });

  it('leaves the priority alone when only the type changes', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await updateRequestDetails(ctx, support, { ...SAME, request: raised.id, type: 'hotfix' });

    expect(await stored(raised.id)).toMatchObject({ type: 'hotfix', priority: 'normal' });
    expect(await changes(raised.id)).toEqual([['type', 'bug', 'hotfix', 'staff']]);
  });

  it('does not count a change of the priority alone as activity: the company does not see it', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    const at = minutesAgo(60);
    const raised = await storeRequest(company.id, { lastActivityAt: at });

    const result = await updateRequestDetails(ctx, manager, {
      ...SAME,
      request: raised.id,
      priority: 'low',
    });

    expect(result).toEqual({ changed: 1 });
    expect(await stored(raised.id)).toMatchObject({ priority: 'low', lastActivityAt: at });
  });

  it.each([
    ['no title', { title: ' ' }],
    ['a title of two lines', { title: 'The printer\nis broken' }],
    ['an unknown type', { type: 'question' }],
    ['an unknown priority', { priority: 'urgent' }],
    ['no priority', { priority: '' }],
  ])('refuses %s', async (_name, change) => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      updateRequestDetails(ctx, support, { ...SAME, ...change, request: raised.id }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await changes(raised.id)).toEqual([]);
  });

  it('refuses a change to a request of a deactivated company', async () => {
    const company = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      updateRequestDetails(ctx, support, { ...SAME, request: raised.id, title: 'Another title' }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await stored(raised.id)).toMatchObject({ title: 'The printer is broken' });
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
      updateRequestDetails(ctx, support, { ...SAME, request: raised.id, title: 'Another title' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await stored(raised.id)).toMatchObject({ title: 'The printer is broken' });
  });
});
