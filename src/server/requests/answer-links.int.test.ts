/**
 * @file Integration tests for the links in an email that answer a proposed
 * solution (decision 0033): a link answers once, as its person and only for
 * its proposal, with the same rules as the buttons on the request's page,
 * and says why when it can't any more (used, expired, overtaken by a change,
 * its person no longer able to answer, or no such link, which counts against
 * the visitor's limit).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { company as companyTable, membership, requestAnswerLink, user } from '@/db/schema';

import {
  createCompany,
  fillRateLimitBucket,
  fromIp,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import { answerByLink, createAnswerLink, readAnswerLink } from './answer-links';
import currentProposalEntryId from './proposals';
import replyToRequest from './reply';
import changeRequestStatus from './status';
import { ctx, db, storeRequest, storedRequest } from './test-helpers';

/**
 * A request waiting for the client's approval, with the client's answer link.
 *
 * @returns The request, the client, the support member who proposed, and the link's token.
 */
async function aLinkToAnswer() {
  const company = await createCompany(db);
  const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
  const support = await staffActor(db, 'support', 'sam@adiutor.test');
  const raised = await storeRequest(company.id, { createdBy: client.id, status: 'in_progress' });
  await replyToRequest(ctx, support, {
    request: raised.id,
    body: 'Fixed: the toner was empty.',
    status: 'proposed',
  });
  const proposalEntryId = await currentProposalEntryId(db, raised.id);
  if (proposalEntryId === null) {
    throw new Error('The reply should have proposed a solution.');
  }
  const token = await createAnswerLink(db, {
    requestId: raised.id,
    userId: client.id,
    proposalEntryId,
  });
  return { company, raised, client, support, token, proposalEntryId };
}

describe('an answer link', () => {
  it('stores only the token’s hash, for two weeks', async () => {
    const { token, raised } = await aLinkToAnswer();

    const [row] = await db
      .select({ tokenHash: requestAnswerLink.tokenHash, expiresAt: requestAnswerLink.expiresAt })
      .from(requestAnswerLink)
      .where(eq(requestAnswerLink.requestId, raised.id));
    expect(row?.tokenHash).not.toContain(token);
    const days = ((row?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  it('can answer while the request waits for its proposal, naming the request', async () => {
    const { token, raised } = await aLinkToAnswer();

    await expect(readAnswerLink(ctx, token)).resolves.toEqual({
      state: 'usable',
      reference: expect.stringMatching(/-\d+$/),
      number: raised.number,
    });
  });

  it('approves as its person, once, which closes the request', async () => {
    const { token, raised, client } = await aLinkToAnswer();

    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'used',
      answer: 'approve',
    });
    expect((await storedRequest(raised.id))?.status).toBe('done');
    const [link] = await db
      .select({ usedAt: requestAnswerLink.usedAt, answer: requestAnswerLink.answer })
      .from(requestAnswerLink)
      .where(eq(requestAnswerLink.userId, client.id));
    expect(link?.usedAt).toBeInstanceOf(Date);
    expect(link?.answer).toBe('approve');

    // Used: the other answer changes nothing, and the page says what it did.
    await expect(answerByLink(ctx, token, 'deny')).resolves.toMatchObject({
      state: 'used',
      answer: 'approve',
    });
    expect((await storedRequest(raised.id))?.status).toBe('done');
  });

  it('denies, which puts the request back in progress', async () => {
    const { token, raised } = await aLinkToAnswer();

    await expect(answerByLink(ctx, token, 'deny')).resolves.toMatchObject({
      state: 'used',
      answer: 'deny',
    });
    expect((await storedRequest(raised.id))?.status).toBe('in_progress');
  });

  it('answers once when it’s used twice at the same moment', async () => {
    const { token, raised } = await aLinkToAnswer();

    const views = await Promise.all([
      answerByLink(ctx, token, 'approve'),
      answerByLink(ctx, token, 'approve'),
    ]);

    expect(views.map(({ state }) => state).sort()).toEqual(['overtaken', 'used']);
    expect((await storedRequest(raised.id))?.status).toBe('done');
  });

  it('has expired after its time, and changes nothing', async () => {
    const { token, raised } = await aLinkToAnswer();
    await db
      .update(requestAnswerLink)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(requestAnswerLink.requestId, raised.id));

    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'expired',
    });
    expect((await storedRequest(raised.id))?.status).toBe('proposed');
  });

  it('is overtaken once the request no longer waits for its proposal', async () => {
    const { token, raised, support } = await aLinkToAnswer();
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'in_progress' });

    await expect(readAnswerLink(ctx, token)).resolves.toMatchObject({ state: 'overtaken' });
    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'overtaken',
    });
    expect((await storedRequest(raised.id))?.status).toBe('in_progress');
  });

  it('is overtaken by a newer proposal, which needs its own link', async () => {
    const { token, raised, support } = await aLinkToAnswer();
    await changeRequestStatus(ctx, support, { request: raised.id, status: 'in_progress' });
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'Now it’s fixed for real.',
      status: 'proposed',
    });

    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'overtaken',
    });
    expect((await storedRequest(raised.id))?.status).toBe('proposed');
  });

  it('is unavailable once its person is deactivated', async () => {
    const { token, raised, client } = await aLinkToAnswer();
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, client.id));

    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'unavailable',
    });
    expect((await storedRequest(raised.id))?.status).toBe('proposed');
  });

  it('is unavailable once its person left the company', async () => {
    const { token, raised, client, company } = await aLinkToAnswer();
    await db
      .delete(membership)
      .where(and(eq(membership.userId, client.id), eq(membership.companyId, company.id)));

    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'unavailable',
    });
    expect((await storedRequest(raised.id))?.status).toBe('proposed');
  });

  it('answers only as someone who may answer: a Watcher’s link changes nothing', async () => {
    const { raised, company, proposalEntryId } = await aLinkToAnswer();
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const token = await createAnswerLink(db, {
      requestId: raised.id,
      userId: watcher.id,
      proposalEntryId,
    });

    await expect(answerByLink(ctx, token, 'approve')).resolves.toMatchObject({
      state: 'unavailable',
    });
    expect((await storedRequest(raised.id))?.status).toBe('proposed');
  });

  it('shows its page as unavailable once its person left the company', async () => {
    const { token, client, company } = await aLinkToAnswer();
    await db
      .delete(membership)
      .where(and(eq(membership.userId, client.id), eq(membership.companyId, company.id)));

    await expect(readAnswerLink(ctx, token)).resolves.toMatchObject({ state: 'unavailable' });
  });

  it('shows its page as unavailable for a Watcher, and once the company is deactivated', async () => {
    const { raised, company, proposalEntryId, token } = await aLinkToAnswer();
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const watcherToken = await createAnswerLink(db, {
      requestId: raised.id,
      userId: watcher.id,
      proposalEntryId,
    });

    await expect(readAnswerLink(ctx, watcherToken)).resolves.toMatchObject({
      state: 'unavailable',
    });
    await db
      .update(companyTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(companyTable.id, company.id));
    await expect(readAnswerLink(ctx, token)).resolves.toMatchObject({ state: 'unavailable' });
  });

  it('is unknown when there’s no such link, which counts against the visitor', async () => {
    await expect(readAnswerLink(fromIp(ctx, '203.0.113.6'), 'no-such-token')).resolves.toEqual({
      state: 'unknown',
    });

    const visitor = fromIp(ctx, '203.0.113.7');
    await fillRateLimitBucket(
      db,
      'answer-link-miss:ip:203.0.113.7',
      RATE_LIMITS.answerLinkMissesPerIp.limit,
    );
    await expect(readAnswerLink(visitor, 'another-token')).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await expect(answerByLink(visitor, 'another-token', 'approve')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('doesn’t count a link that exists against the visitor', async () => {
    const { token } = await aLinkToAnswer();
    const visitor = fromIp(ctx, '203.0.113.8');
    await fillRateLimitBucket(
      db,
      'answer-link-miss:ip:203.0.113.8',
      RATE_LIMITS.answerLinkMissesPerIp.limit,
    );

    await expect(readAnswerLink(visitor, token)).resolves.toMatchObject({ state: 'usable' });
  });
});
