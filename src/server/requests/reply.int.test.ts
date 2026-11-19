/**
 * @file Integration tests for replying to a request. Which roles may reply
 * is in the authorization matrix.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { membership, request, requestEntry } from '@/db/schema';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import {
  actorFor,
  addMember,
  atTheSameMoment,
  createCompany,
  fillRateLimitBucket,
  memberActor,
  minutesAgo,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import replyToRequest from './reply';
import { ctx, db, deactivatedMeanwhile, storeRequest, storedRequest } from './test-helpers';

/**
 * The entries of a request's history, in order, as rows to compare.
 *
 * @param requestId - The request.
 * @returns Each entry's kind, side, text and change.
 */
async function history(requestId: string) {
  const entries = await db
    .select()
    .from(requestEntry)
    .where(eq(requestEntry.requestId, requestId))
    .orderBy(requestEntry.id);
  return entries.map(({ kind, authorSide, body, fromValue, toValue }) => ({
    kind,
    authorSide,
    body,
    fromValue,
    toValue,
  }));
}

describe('replyToRequest', () => {
  it('adds the reply to the history and counts as activity, leaving the status alone', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { lastActivityAt: minutesAgo(60) });

    const result = await replyToRequest(ctx, client, {
      request: String(raised.number),
      body: '  Any news?\r\nIt still prints blank pages. ',
    });

    expect(result).toEqual({ status: 'open' });
    const entries = await db.select().from(requestEntry);
    expect(entries).toMatchObject([
      {
        requestId: raised.id,
        kind: 'comment',
        authorId: client.id,
        authorSide: 'company',
        body: 'Any news?\nIt still prints blank pages.',
        bodyFormat: 'markdown',
      },
    ]);
    const after = await storedRequest(raised.id);
    expect(after?.status).toBe('open');
    expect(after?.lastActivityAt.getTime()).toBeGreaterThan(minutesAgo(1).getTime());
  });

  it('takes the request by its ID too', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);

    await replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' });

    expect(await history(raised.id)).toHaveLength(1);
  });

  it('puts a request back in progress when the company answers what the staff asked', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');
    const raised = await storeRequest(company.id, { status: 'waiting' });

    const result = await replyToRequest(ctx, admin, { request: raised.id, body: 'Yes, floor 2.' });

    expect(result).toEqual({ status: 'in_progress' });
    // The reply first, then what it did to the status.
    expect(await history(raised.id)).toEqual([
      {
        kind: 'comment',
        authorSide: 'company',
        body: 'Yes, floor 2.',
        fromValue: null,
        toValue: null,
      },
      {
        kind: 'status',
        authorSide: 'company',
        body: null,
        fromValue: 'waiting',
        toValue: 'in_progress',
      },
    ]);
    expect(await storedRequest(raised.id)).toMatchObject({
      status: 'in_progress',
      reopenedAt: null,
    });
  });

  it('keeps a request waiting when the staff add to their own question', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'waiting' });

    const result = await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'Also: which printer?',
    });

    expect(result).toEqual({ status: 'waiting' });
    expect(await history(raised.id)).toMatchObject([{ kind: 'comment', authorSide: 'staff' }]);
  });

  it('lets the staff reply and wait for the company in one go', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'in_progress' });

    const result = await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'Which printer is it?',
      status: 'waiting',
    });

    expect(result).toEqual({ status: 'waiting' });
    expect(await history(raised.id)).toEqual([
      {
        kind: 'comment',
        authorSide: 'staff',
        body: 'Which printer is it?',
        fromValue: null,
        toValue: null,
      },
      {
        kind: 'status',
        authorSide: 'staff',
        body: null,
        fromValue: 'in_progress',
        toValue: 'waiting',
      },
    ]);
  });

  it('adds no status change for the status a request already has', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'waiting' });

    await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'Any news?',
      status: 'waiting',
    });

    expect(await history(raised.id)).toMatchObject([{ kind: 'comment' }]);
  });

  it.each(['todo', 'in_progress', 'waiting'])(
    'refuses a reply from the company that sets the status to %s',
    async (status) => {
      const company = await createCompany(db);
      const client = await memberActor(db, company.id, 'client');
      const raised = await storeRequest(company.id);

      await expect(
        replyToRequest(ctx, client, { request: raised.id, body: 'Please start.', status }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(await history(raised.id)).toEqual([]);
    },
  );

  it.each(['done', 'cancelled'] as const)(
    'never reopens a request that is %s, whoever replies',
    async (status) => {
      const company = await createCompany(db);
      const [client, support] = [
        await memberActor(db, company.id, 'client'),
        await staffActor(db, 'support'),
      ];
      const raised = await storeRequest(company.id, { status });

      expect(await replyToRequest(ctx, client, { request: raised.id, body: 'Thanks!' })).toEqual({
        status,
      });
      expect(await replyToRequest(ctx, support, { request: raised.id, body: 'Welcome.' })).toEqual({
        status,
      });
      expect(await storedRequest(raised.id)).toMatchObject({ status, reopenedAt: null });
    },
  );

  it('counts a reply by Finance who is also a Client as the company’s', async () => {
    const company = await createCompany(db);
    const finance = await staffActor(db, 'finance');
    await addMember(db, company.id, finance.id, 'client');
    const raised = await storeRequest(company.id, { status: 'waiting' });

    const result = await replyToRequest(ctx, await actorFor(db, finance.id), {
      request: raised.id,
      body: 'Yes, floor 2.',
    });

    expect(result).toEqual({ status: 'in_progress' });
    expect(await history(raised.id)).toMatchObject([
      { kind: 'comment', authorSide: 'company' },
      { kind: 'status', authorSide: 'company' },
    ]);
  });

  it.each([
    ['an empty reply', ' \r\n '],
    ['a reply that is too long', 'a'.repeat(REQUEST_TEXT_MAX_LENGTH + 1)],
  ])('refuses %s', async (_name, body) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);

    await expect(replyToRequest(ctx, client, { request: raised.id, body })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await history(raised.id)).toEqual([]);
  });

  it('refuses a status that does not exist', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      replyToRequest(ctx, support, { request: raised.id, body: 'On it.', status: 'closed' }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a reply to a request of a deactivated company, also from the staff', async () => {
    const company = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      replyToRequest(ctx, support, { request: raised.id, body: 'On it.' }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await history(raised.id)).toEqual([]);
  });

  it('refuses someone who lost their role while the reply was under way', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await db.update(membership).set({ role: 'watcher' }).where(eq(membership.userId, client.id));

    await expect(
      replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await history(raised.id)).toEqual([]);
  });

  it('refuses a reply from the staff when the company was deactivated while it was under way', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    const ended = await deactivatedMeanwhile(support.id, company.id, () =>
      replyToRequest(ctx, support, { request: raised.id, body: 'On it.' }),
    );

    expect(ended).toMatchObject({
      status: 'rejected',
      reason: { code: 'invalid', key: 'errors.companyDeactivated' },
    });
    expect(await history(raised.id)).toEqual([]);
  });

  it('times a reply that waited for another change by when it was written, not when it started', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { lastActivityAt: minutesAgo(60) });

    // Another change holds the request, and writes its entry only once the reply waits for it.
    const { second } = await atTheSameMoment(
      db,
      (tx) =>
        tx
          .select({ id: request.id })
          .from(request)
          .where(eq(request.id, raised.id))
          .for('no key update'),
      () => replyToRequest(ctx, client, { request: raised.id, body: 'And it jams.' }),
      async (tx) => {
        await tx.insert(requestEntry).values({
          requestId: raised.id,
          kind: 'comment',
          authorSide: 'staff',
          body: 'Which printer is it?',
          createdAt: sql`clock_timestamp()`,
        });
      },
    );

    expect(second.status).toBe('fulfilled');
    const entries = await db
      .select()
      .from(requestEntry)
      .where(eq(requestEntry.requestId, raised.id))
      .orderBy(requestEntry.id);
    expect(entries.map(({ body }) => body)).toEqual(['Which printer is it?', 'And it jams.']);
    // In the conversation's order, no entry is timed before the one above it.
    const times = entries.map(({ createdAt }) => createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // The last activity is the reply: read from the clock right after its entry was.
    const lastActivity = (await storedRequest(raised.id))?.lastActivityAt.getTime();
    expect(lastActivity).toBeGreaterThanOrEqual(times[1] ?? Infinity);
    expect(lastActivity).toBeLessThan((times[1] ?? 0) + 1_000);
  });

  it('stops at the limit of replies one person writes', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await fillRateLimitBucket(
      db,
      `request-reply:user:${client.id}`,
      RATE_LIMITS.requestRepliesPerUser.limit,
    );

    await expect(
      replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await history(raised.id)).toEqual([]);
  });
});
