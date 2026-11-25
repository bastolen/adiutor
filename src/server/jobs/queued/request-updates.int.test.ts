/**
 * @file Integration tests for the emails about requests, against the test
 * database: everything queued for one person about one request goes out as
 * one email, in their language and worded for them, with a link of their
 * own that signs them in; someone who is no longer on the request gets none;
 * and a mail problem leaves the news in the queue.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  queuedJob,
  request,
  requestAnswerLink,
  requestEntry,
  requestSignInLink,
  user,
} from '@/db/schema';
import { writtenMentionMarker } from '@/lib/requests';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  createCompany,
  createStaffSettings,
  mailDown,
  memberActor,
  saveSettings,
  sendQueuedEmails,
  setupTestContext,
  staffActor,
  storeParticipants,
  storeRequest,
} from '../../../../tests/integration/helpers';
import {
  addNote,
  changeAssignees,
  changeSubscribers,
  listMentionable,
  listSubscribable,
  replyToRequest,
  unsubscribe,
} from '../../requests';

const { ctx, db, sent } = setupTestContext();

/**
 * Stores a request that waits for the company, with people subscribed to it.
 *
 * @param companyId - The company it's in.
 * @param subscribers - The people subscribed to it.
 * @returns The request's ID and number.
 */
async function storeWaitingRequest(companyId: string, subscribers: readonly { id: string }[]) {
  // The subject of the emails names the number, so the request takes number 142.
  await saveSettings(db, { 'requests.last_number': 141 });
  const stored = await storeRequest(db, companyId, { priority: 'high', status: 'waiting' });
  await storeParticipants(
    db,
    stored.id,
    subscribers.map(({ id }) => id),
    'subscriber',
  );
  return stored;
}

describe('the emails about requests', () => {
  it('send an internal note to the staff in the same email as a reply, and nothing of it to the company', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const manager = await staffActor(db, 'manager', 'morgan@adiutor.test');
    const raised = await storeWaitingRequest(company.id, [client, manager]);

    await addNote(ctx, support, { request: raised.id, body: 'The toner is **empty**.' });
    await replyToRequest(ctx, support, { request: raised.id, body: 'We are on it.' });
    await sendQueuedEmails(ctx);

    expect(sent.map(({ to }) => to).sort()).toEqual(['casey@adiutor.test', 'morgan@adiutor.test']);
    const toStaff = sent.find(({ to }) => to === 'morgan@adiutor.test');
    const toClient = sent.find(({ to }) => to === 'casey@adiutor.test');
    expect(toStaff?.text).toContain('sam wrote an internal note:');
    expect(toStaff?.html).toContain('<strong>empty</strong>');
    expect(toStaff?.text).toContain('Internal note: only the staff see this.');
    expect(toStaff?.text).toContain('sam replied:');
    // The client hears of the reply, and of no note.
    expect(toClient?.text).toContain('sam replied:');
    expect(toClient?.text).not.toContain('note');
    expect(toClient?.html).not.toContain('empty');
  });

  it('give the people who may answer a proposed solution Approve and Deny links of their own', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const watcher = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const manager = await staffActor(db, 'manager', 'morgan@adiutor.test');
    const raised = await storeWaitingRequest(company.id, [client, watcher, manager]);
    await db.update(request).set({ status: 'in_progress' }).where(eq(request.id, raised.id));

    await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'The toner was empty; it prints again.',
      status: 'proposed',
    });
    await sendQueuedEmails(ctx);

    /**
     * The text of the email to someone.
     *
     * @param to - Their address.
     * @returns The text, or nothing when they got none.
     */
    const textTo = (to: string) => sent.find((email) => email.to === to)?.text ?? '';
    /**
     * The answer links in the email to someone.
     *
     * @param to - Their address.
     * @returns The links, or `null` when there are none.
     */
    const links = (to: string) =>
      textTo(to).match(/https:\/\/adiutor\.test\/answer\/[^\s/]+\/\w+/g);
    // The client: their own two links, and still the request as the first link (their own link
    // that signs them in, decision 0036).
    expect(textTo('casey@adiutor.test')).toContain('sam proposed a solution.');
    expect(textTo('casey@adiutor.test')).toContain('Does this solve your request?');
    expect(textTo('casey@adiutor.test').match(/https?:\/\/\S+/)?.[0]).toMatch(
      /^https:\/\/adiutor\.test\/api\/auth\/request-link\/sign-in\?token=[\w-]+&entry=([0-9a-f-]{36})#entry-\1$/,
    );
    const [approve, deny] = links('casey@adiutor.test') ?? [];
    expect(approve).toMatch(/\/approve$/);
    expect(deny).toMatch(/\/deny$/);
    expect(approve?.replace(/\/approve$/, '')).toBe(deny?.replace(/\/deny$/, ''));
    // A Watcher and the staff can't answer: no links, just the request.
    expect(links('wim@adiutor.test')).toBeNull();
    expect(links('morgan@adiutor.test')).toBeNull();
    expect(textTo('wim@adiutor.test')).toContain('Open request');
    // One link, for the client and that proposal, stored only as a hash.
    const stored = await db
      .select({ userId: requestAnswerLink.userId, tokenHash: requestAnswerLink.tokenHash })
      .from(requestAnswerLink)
      .where(eq(requestAnswerLink.requestId, raised.id));
    expect(stored).toEqual([{ userId: client.id, tokenHash: expect.any(String) }]);
    expect(approve).not.toContain(stored[0]?.tokenHash);
  });

  it('give no answer links in a later email while the solution still waits', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db, { name: 'Adiutor Tests Client' });
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeWaitingRequest(company.id, [client]);
    await db.update(request).set({ status: 'in_progress' }).where(eq(request.id, raised.id));
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: 'It prints again.',
      status: 'proposed',
    });
    await sendQueuedEmails(ctx);
    sent.length = 0;

    await replyToRequest(ctx, support, { request: raised.id, body: 'Let us know.' });
    await sendQueuedEmails(ctx);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain('/answer/');
    expect(await db.select().from(requestAnswerLink)).toHaveLength(1);
  });

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
    // The first link is the reader's own link that signs them in and opens the request (decision
    // 0036) at the reply, the first news the email tells of, and nothing names an address or a
    // person's ID.
    const watcherLink = new URL(toWatcher?.text.match(/https?:\/\/\S+/)?.[0] ?? '');
    expect(`${watcherLink.origin}${watcherLink.pathname}`).toBe(
      'https://adiutor.test/api/auth/request-link/sign-in',
    );
    const [reply] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(and(eq(requestEntry.requestId, raised.id), eq(requestEntry.kind, 'comment')));
    expect(watcherLink.searchParams.get('entry')).toBe(reply?.id);
    expect(watcherLink.hash).toBe(`#entry-${reply?.id}`);
    const token = watcherLink.searchParams.get('token') ?? '';
    expect(
      await db
        .select({ userId: requestSignInLink.userId, requestId: requestSignInLink.requestId })
        .from(requestSignInLink)
        .where(eq(requestSignInLink.tokenHash, hashToken(token))),
    ).toEqual([{ userId: watcher.id, requestId: raised.id }]);
    // Each reader gets a link of their own, and only its hash is stored.
    expect(toStaff?.text).not.toContain(token);
    expect(
      await db.select().from(requestSignInLink).where(eq(requestSignInLink.tokenHash, token)),
    ).toEqual([]);
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

  it('tell someone what put them on a request: assigned, mentioned, subscribed', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const manager = await staffActor(db, 'manager', 'mo@adiutor.test');
    const raised = await storeWaitingRequest(company.id, []);

    // The Admin subscribes a colleague, the staff assign a colleague and mention the Admin.
    await changeSubscribers(ctx, admin, {
      request: raised.id,
      add: (await listSubscribable(ctx, admin, raised.id))
        .filter(({ name }) => name === 'wim')
        .map(({ key }) => key),
      remove: [],
    });
    await changeAssignees(ctx, support, { request: raised.id, add: [manager.id], remove: [] });
    const [toAnna] = (await listMentionable(ctx, support, { request: raised.id })).filter(
      ({ name }) => name === 'anna',
    );
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Is it this one, ${writtenMentionMarker('anna', toAnna?.key ?? '')}?`,
    });
    await sendQueuedEmails(ctx);

    /**
     * The text of the email to someone.
     *
     * @param to - Their address.
     * @returns The email's plain text.
     */
    const textTo = (to: string) => sent.find((email) => email.to === to)?.text ?? '';
    expect(textTo('wim@adiutor.test')).toContain('anna subscribed you to this request.');
    // They follow it from then on, so the reply reaches them too, in the same email.
    expect(textTo('wim@adiutor.test')).toContain('sam replied:');
    expect(textTo('mo@adiutor.test')).toContain('sam assigned this request to you.');
    expect(textTo('mo@adiutor.test')).toContain('this request is assigned to you');
    expect(textTo('anna@adiutor.test')).toContain('sam mentioned you in a reply:');
    expect(textTo('anna@adiutor.test')).toContain('Is it this one, @anna?');
    expect(textTo('anna@adiutor.test')).not.toContain('sam replied:');
    expect(sent).toHaveLength(3);
  });
});
