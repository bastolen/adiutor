/**
 * @file Integration tests for the emails about requests, against the test
 * database: everything queued for one person about one request goes out as
 * one email, in their language and worded for them; someone who is no longer
 * on the request gets none; and a mail problem leaves the news in the queue.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { queuedJob, request, requestCounter, requestParticipant, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  createCompany,
  createStaffSettings,
  mailDown,
  memberActor,
  sendQueuedEmails,
  setupTestContext,
  staffActor,
} from '../../../../tests/integration/helpers';
import { replyToRequest, unsubscribe } from '../../requests';

const { ctx, db, sent } = setupTestContext();

/**
 * Stores a request that waits for the company, with people subscribed to it.
 *
 * @param companyId - The company it's in.
 * @param subscribers - The people subscribed to it.
 * @returns The request's ID and number.
 */
async function storeWaitingRequest(companyId: string, subscribers: readonly { id: string }[]) {
  await db.insert(requestCounter).values({ lastNumber: 142 });
  const stored = firstRow(
    await db
      .insert(request)
      .values({
        number: 142,
        companyId,
        title: 'The printer is broken',
        description: 'It prints blank pages.',
        type: 'bug',
        priority: 'high',
        status: 'waiting',
        createdBySide: 'company',
      })
      .returning({ id: request.id, number: request.number }),
    'the stored request',
  );
  await db.insert(requestParticipant).values(
    subscribers.map(({ id }) => ({
      requestId: stored.id,
      userId: id,
      role: 'subscriber' as const,
    })),
  );
  return stored;
}

describe('the emails about requests', () => {
  it('send one email per person for a reply and the status change it brought, worded for each', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeWaitingRequest(company.id, [watcher, support]);

    await replyToRequest(ctx, client, {
      request: raised.id,
      body: 'It’s the one on **floor 2**.\n\n- next to the lift',
    });
    const runs = await sendQueuedEmails(ctx);

    // The writer gets nothing; the two others one email each, with both pieces of news.
    expect(sent.map(({ to }) => to).sort()).toEqual(['sam@adiutor.test', 'wim@adiutor.test']);
    expect(runs).toEqual([
      expect.objectContaining({ summary: expect.objectContaining({ done: 4 }) }),
    ]);
    const toStaff = sent.find(({ to }) => to === 'sam@adiutor.test');
    const toWatcher = sent.find(({ to }) => to === 'wim@adiutor.test');
    expect(toStaff?.subject).toBe('AD-142: The printer is broken');
    expect(toStaff?.text).toContain('casey replied:');
    // The reply in full, formatted in the HTML and readable as text.
    expect(toStaff?.html).toContain('<strong>floor 2</strong>');
    expect(toStaff?.text).toContain('next to the lift');
    // The status in each reader's words.
    expect(toStaff?.text).toContain(
      'casey changed the status from Waiting for the company to In progress.',
    );
    expect(toWatcher?.text).toContain(
      'casey changed the status from Waiting for your company to In progress.',
    );
    // The first link is the request, and nothing names an address or a person's ID.
    expect(toWatcher?.text.match(/https?:\/\/\S+/)?.[0]).toBe('https://adiutor.test/requests/142');
    [toStaff, toWatcher].forEach((email) => {
      expect(email?.html).not.toContain('casey@adiutor.test');
      expect(email?.html).not.toContain(client.id);
      // Nothing only the staff see: the priority isn't news, and isn't shown.
      expect(email?.text).not.toMatch(/priority/i);
    });
    expect(await db.select().from(queuedJob).where(eq(queuedJob.status, 'queued'))).toEqual([]);
  });

  it('are written in the recipient’s language', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    await db.update(user).set({ locale: 'nl-NL' }).where(eq(user.id, watcher.id));
    const raised = await storeWaitingRequest(company.id, [watcher]);

    await replyToRequest(ctx, client, { request: raised.id, body: 'Het is die op de tweede.' });
    await sendQueuedEmails(ctx);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.html).toContain('lang="nl-NL"');
    expect(sent[0]?.text).toContain('casey heeft gereageerd:');
    expect(sent[0]?.text).toContain('van Wacht op je bedrijf naar In behandeling');
  });

  it('skip someone who unsubscribed before the email went out', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const raised = await storeWaitingRequest(company.id, [watcher]);
    await replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' });
    await unsubscribe(ctx, watcher, { request: raised.id });

    const runs = await sendQueuedEmails(ctx);

    expect(sent).toEqual([]);
    expect(runs).toEqual([
      expect.objectContaining({ summary: expect.objectContaining({ skipped: 2 }) }),
    ]);
  });

  it('stay in the queue when the mail server is down, and go out once with what came meanwhile', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const raised = await storeWaitingRequest(company.id, [watcher]);
    await replyToRequest(ctx, client, { request: raised.id, body: 'First.' });

    await sendQueuedEmails(mailDown(ctx));
    expect(sent).toEqual([]);

    await replyToRequest(ctx, client, { request: raised.id, body: 'Second.' });
    // The first two wait for their next attempt: make them due again.
    await db.update(queuedJob).set({ runAt: new Date(0) });
    await sendQueuedEmails(ctx);

    expect(sent).toHaveLength(1);
    const text = sent[0]?.text ?? '';
    expect(text.indexOf('First.')).toBeGreaterThan(-1);
    expect(text.indexOf('Second.')).toBeGreaterThan(text.indexOf('First.'));
  });
});
