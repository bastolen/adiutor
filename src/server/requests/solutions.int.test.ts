/**
 * @file Integration tests for solutions the company approves: the staff send
 * a reply as the solution, which makes the request wait for approval; the
 * company's Admins and Clients approve it (done) or deny it (in progress,
 * with an optional reason), each told to the people on the request in one
 * email. Who may do which is also in the authorization matrix.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { impersonation, queuedJob, request, requestEntry } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { appUrl } from '@/lib/env';

import { createCompany, memberActor, staffActor } from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import replyToRequest from './reply';
import answerSolution from './solutions';
import changeRequestStatus from './status';
import { ctx, db, storeRequest } from './test-helpers';

/**
 * A request a client raised, and the support member who sent its solution.
 *
 * @returns The request, the client, a colleague who watches, and the support member.
 */
async function aProposedSolution() {
  const company = await createCompany(db);
  const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
  const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
  const support = await staffActor(db, 'support', 'sam@adiutor.test');
  const raised = await storeRequest(company.id, { createdBy: client.id, status: 'in_progress' });
  await replyToRequest(ctx, support, {
    request: raised.id,
    body: 'Fixed: the toner was empty.',
    status: 'proposed',
  });
  return { company, raised, client, watcher, support };
}

/**
 * The request's status now.
 *
 * @param requestId - The request.
 * @returns Its status.
 */
async function statusOf(requestId: string) {
  return firstRow(
    await db.select({ status: request.status }).from(request).where(eq(request.id, requestId)),
    'the request',
  ).status;
}

/**
 * The request's history, oldest first, as `kind` or `kind:from>to`.
 *
 * @param requestId - The request.
 * @returns Its entries.
 */
async function historyOf(requestId: string) {
  const rows = await db
    .select({ kind: requestEntry.kind, from: requestEntry.fromValue, to: requestEntry.toValue })
    .from(requestEntry)
    .where(eq(requestEntry.requestId, requestId))
    .orderBy(requestEntry.id);
  return rows.map(({ kind, from, to }) => (kind === 'status' ? `${kind}:${from}>${to}` : kind));
}

describe('sending a solution', () => {
  it('makes the request wait for the company’s approval, with the reply that holds it', async () => {
    const { raised } = await aProposedSolution();

    expect(await statusOf(raised.id)).toBe('proposed');
    expect(await historyOf(raised.id)).toEqual(['comment', 'status:in_progress>proposed']);
  });

  it('is the staff’s, comes only with a reply, and only while the request is worked on', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id, { status: 'done' });

    // Someone at the company can't send one.
    await expect(
      replyToRequest(ctx, client, { request: raised.id, body: 'Done?', status: 'proposed' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Nobody picks it as a status.
    await expect(
      changeRequestStatus(ctx, support, { request: raised.id, status: 'proposed' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // On a closed request, the reply counts and the status stays.
    await replyToRequest(ctx, support, { request: raised.id, body: 'Fixed.', status: 'proposed' });
    expect(await statusOf(raised.id)).toBe('done');
  });
});

describe('answering a solution', () => {
  it('approves it, which closes the request, and tells the people on it in one email', async () => {
    const { raised, client, support } = await aProposedSolution();
    await db.delete(queuedJob);

    await expect(
      answerSolution(ctx, client, { request: raised.id, answer: 'approve' }),
    ).resolves.toEqual({ status: 'done' });

    expect(await statusOf(raised.id)).toBe('done');
    expect((await historyOf(raised.id)).at(-1)).toBe('status:proposed>done');
    const jobs = await db.select({ payload: queuedJob.payload }).from(queuedJob);
    expect(jobs.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ userId: support.id, event: 'status' }),
    ]);
  });

  it('denies it, with a reason that becomes a reply, which puts it back in progress', async () => {
    const { raised, client, support } = await aProposedSolution();
    await db.delete(queuedJob);

    await expect(
      answerSolution(ctx, client, {
        request: raised.id,
        answer: 'deny',
        body: 'It still prints blank pages.',
      }),
    ).resolves.toEqual({ status: 'in_progress' });

    expect(await historyOf(raised.id)).toEqual([
      'comment',
      'status:in_progress>proposed',
      'comment',
      'status:proposed>in_progress',
    ]);
    const reason = await db
      .select({ body: requestEntry.body, side: requestEntry.authorSide })
      .from(requestEntry)
      .where(
        and(
          eq(requestEntry.requestId, raised.id),
          eq(requestEntry.authorId, client.id),
          eq(requestEntry.kind, 'comment'),
        ),
      );
    expect(reason).toEqual([{ body: 'It still prints blank pages.', side: 'company' }]);
    // The support member hears of both, in one email.
    const jobs = await db.select({ payload: queuedJob.payload }).from(queuedJob);
    expect(jobs.map(({ payload }) => (payload as { event: string }).event).sort()).toEqual([
      'reply',
      'status',
    ]);
    expect(jobs.every(({ payload }) => (payload as { userId: string }).userId === support.id)).toBe(
      true,
    );
  });

  it('denies it without a reason too', async () => {
    const { raised, client } = await aProposedSolution();

    await answerSolution(ctx, client, { request: raised.id, answer: 'deny', body: '  ' });

    expect((await historyOf(raised.id)).slice(-2)).toEqual([
      'status:in_progress>proposed',
      'status:proposed>in_progress',
    ]);
  });

  it('is refused to a Watcher and to the staff', async () => {
    const { raised, watcher, support } = await aProposedSolution();

    await expect(
      answerSolution(ctx, watcher, { request: raised.id, answer: 'approve' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      answerSolution(ctx, support, { request: raised.id, answer: 'approve' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await statusOf(raised.id)).toBe('proposed');
  });

  it('says the status changed when the request no longer waits for an approval', async () => {
    const { raised, client, support } = await aProposedSolution();
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'in_progress' });

    await expect(
      answerSolution(ctx, client, { request: raised.id, answer: 'approve' }),
    ).rejects.toMatchObject({ code: 'conflict', key: 'errors.requests.statusChanged' });
    expect(await statusOf(raised.id)).toBe('in_progress');
  });

  it('refuses an answer that isn’t one', async () => {
    const { raised, client } = await aProposedSolution();

    await expect(
      answerSolution(ctx, client, { request: raised.id, answer: 'maybe' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('records a staff member who answers while signed in as the client', async () => {
    const { raised, client } = await aProposedSolution();
    const admin = await staffActor(db, 'platform_admin');
    await db.insert(impersonation).values({
      staffUserId: admin.id,
      userId: client.id,
      returnTo: '/dashboard',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const asClient: Actor = {
      ...client,
      signedInAs: {
        staffId: admin.id,
        staffName: admin.name,
        endsAt: new Date(Date.now() + 30 * 60_000),
        returnTo: '/dashboard',
        staffPermissions: [],
      },
    };

    await answerSolution(ctx, asClient, { request: raised.id, answer: 'approve' });

    const [answer] = await db
      .select({ signedInAsStaffId: requestEntry.signedInAsStaffId })
      .from(requestEntry)
      .where(and(eq(requestEntry.requestId, raised.id), eq(requestEntry.toValue, 'done')));
    expect(answer).toEqual({ signedInAsStaffId: admin.id });
  });

  it('runs what the caller adds in the same transaction, once the answer is saved', async () => {
    const { raised, client } = await aProposedSolution();
    const seen: string[] = [];

    await answerSolution(
      ctx,
      client,
      { request: raised.id, answer: 'approve' },
      {
        /**
         * Notes the request's status as the answer's transaction sees it.
         *
         * @param tx - The answer's transaction.
         */
        onAnswered: async (tx) => {
          const [row] = await tx
            .select({ status: request.status })
            .from(request)
            .where(eq(request.id, raised.id));
          seen.push(row?.status ?? 'none');
        },
      },
    );

    expect(seen).toEqual(['done']);
  });
});

describe('answerSolution: links to the staff’s pages', () => {
  it('keeps a link to a page for the staff in a reason as its text, like any reply', async () => {
    const { raised, client, support } = await aProposedSolution();

    await answerSolution(ctx, client, {
      request: raised.id,
      answer: 'deny',
      body: `[Sam](${appUrl}/admin/users/${support.id}) said so, see [the docs](https://adiutor.dev/docs).`,
    });

    const [reason] = await db
      .select({ body: requestEntry.body })
      .from(requestEntry)
      .where(and(eq(requestEntry.requestId, raised.id), eq(requestEntry.authorId, client.id)));
    expect(reason?.body).toBe('Sam said so, see [the docs](https://adiutor.dev/docs).');
  });
});
