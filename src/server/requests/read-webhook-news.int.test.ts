/**
 * @file Integration tests for what a webhook is told about a request: every
 * kind of event as it's read when it's sent, in the order of the request's
 * history, people by the names the page gives them (their side's once an
 * account is gone), mentions by name, and nothing that's no longer there.
 * Never an email address, a user ID or who did something while signed in as
 * someone else.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { requestMention, user } from '@/db/schema';
import { storedMentionMarker } from '@/lib/requests';

import { createCompany, createStaffSettings, createUser } from '../../../tests/integration/helpers';
import { readWebhookNews } from './read-webhook-news';
import { db, storeEntry, storeRequest } from './test-helpers';

let company: Awaited<ReturnType<typeof createCompany>>;
let pat: string;
let sam: string;

beforeEach(async () => {
  await createStaffSettings(db, 'Adiutor Tests Support');
  company = await createCompany(db, { name: 'Adiutor Tests Client' });
  pat = await createUser(db, 'pat.client@adiutor.test');
  sam = await createUser(db, 'sam.support@adiutor.test');
  await db.update(user).set({ name: 'Pat Client' }).where(eq(user.id, pat));
  await db.update(user).set({ name: 'Sam Support' }).where(eq(user.id, sam));
});

describe('readWebhookNews', () => {
  it('tells of a request raised, with its description and who raised it', async () => {
    const raised = await storeRequest(company.id, {
      title: 'The printer is broken',
      description: 'It prints **blank** pages.',
      createdBy: pat,
      priority: 'high',
    });

    const news = await readWebhookNews(db, raised.id, [{ event: 'raised', entryId: null }]);

    expect(news).toEqual({
      request: {
        id: raised.id,
        number: raised.number,
        reference: `AD-${raised.number}`,
        title: 'The printer is broken',
        status: 'open',
        type: { key: 'bug', name: 'Bug' },
        priority: 'high',
        company: { id: company.id, name: 'Adiutor Tests Client' },
        path: `/requests/${raised.number}`,
        raisedAt: raised.createdAt,
        lastActivityAt: raised.lastActivityAt,
      },
      events: [
        {
          type: 'raised',
          id: raised.id,
          at: raised.createdAt,
          by: { name: 'Pat Client', side: 'company' },
          text: { format: 'markdown', text: 'It prints **blank** pages.' },
        },
      ],
    });
  });

  it('tells each event in the order of the history, opening the page at the first', async () => {
    const { id, number } = await storeRequest(company.id);
    const status = await storeEntry(id, {
      kind: 'status',
      authorId: sam,
      authorSide: 'staff',
      fromValue: 'in_progress',
      toValue: 'proposed',
    });
    const reply = await storeEntry(id, {
      authorId: sam,
      authorSide: 'staff',
      body: 'Fixed it.',
    });
    const note = await storeEntry(id, {
      kind: 'note',
      authorId: sam,
      authorSide: 'staff',
      body: 'The toner was empty.',
    });
    const assigned = await storeEntry(id, {
      kind: 'assignee',
      authorId: sam,
      authorSide: 'staff',
      toValue: 'assigned',
      subjectUserId: sam,
    });
    const title = await storeEntry(id, {
      kind: 'title',
      authorId: sam,
      authorSide: 'staff',
      fromValue: 'Printer',
      toValue: 'The printer is broken',
    });
    const type = await storeEntry(id, {
      kind: 'type',
      authorId: sam,
      authorSide: 'staff',
      fromValue: 'bug',
      toValue: 'hotfix',
    });
    const priority = await storeEntry(id, {
      kind: 'priority',
      authorId: sam,
      authorSide: 'staff',
      fromValue: 'normal',
      toValue: 'high',
    });

    // Queued in another order than they happened in.
    const news = await readWebhookNews(db, id, [
      { event: 'details', entryId: priority.id },
      { event: 'reply', entryId: reply.id },
      { event: 'status', entryId: status.id },
      { event: 'note', entryId: note.id },
      { event: 'assignee', entryId: assigned.id },
      { event: 'details', entryId: title.id },
      { event: 'details', entryId: type.id },
    ]);

    const staff = { name: 'Sam Support', side: 'staff' };
    expect(news?.request.path).toBe(`/requests/${number}?entry=${status.id}#entry-${status.id}`);
    expect(news?.events).toEqual([
      {
        type: 'status',
        id: status.id,
        at: status.createdAt,
        by: staff,
        from: 'in_progress',
        to: 'proposed',
      },
      {
        type: 'reply',
        id: reply.id,
        at: reply.createdAt,
        by: staff,
        text: { format: 'markdown', text: 'Fixed it.' },
      },
      {
        type: 'note',
        id: note.id,
        at: note.createdAt,
        by: staff,
        text: { format: 'markdown', text: 'The toner was empty.' },
      },
      {
        type: 'assignee',
        id: assigned.id,
        at: assigned.createdAt,
        by: staff,
        change: 'assigned',
        person: 'Sam Support',
      },
      {
        type: 'details',
        id: title.id,
        at: title.createdAt,
        by: staff,
        field: 'title',
        from: 'Printer',
        to: 'The printer is broken',
      },
      {
        type: 'details',
        id: type.id,
        at: type.createdAt,
        by: staff,
        field: 'type',
        from: { key: 'bug', name: 'Bug' },
        to: { key: 'hotfix', name: 'Hotfix' },
      },
      {
        type: 'details',
        id: priority.id,
        at: priority.createdAt,
        by: staff,
        field: 'priority',
        from: 'normal',
        to: 'high',
      },
    ]);
  });

  it('names people as the page does: by their side once their account is gone, and mentions by name', async () => {
    const { id } = await storeRequest(company.id);
    const gone = await createUser(db, 'gone@adiutor.test');
    const mentionOfSam = await db
      .insert(requestMention)
      .values({ requestId: id, userId: sam, side: 'staff' })
      .returning({ id: requestMention.id });
    const mentionOfGone = await db
      .insert(requestMention)
      .values({ requestId: id, userId: gone, side: 'company' })
      .returning({ id: requestMention.id });
    const reply = await storeEntry(id, {
      authorId: gone,
      body: `Thanks ${storedMentionMarker(mentionOfSam[0]?.id ?? '')}, and ${storedMentionMarker(mentionOfGone[0]?.id ?? '')}.`,
    });
    const unassigned = await storeEntry(id, {
      kind: 'assignee',
      authorSide: 'staff',
      toValue: 'unassigned',
      subjectUserId: gone,
    });
    await db.delete(user).where(eq(user.id, gone));

    const news = await readWebhookNews(db, id, [
      { event: 'reply', entryId: reply.id },
      { event: 'assignee', entryId: unassigned.id },
    ]);

    expect(news?.events).toEqual([
      expect.objectContaining({
        by: { name: 'Adiutor Tests Client', side: 'company' },
        text: { format: 'markdown', text: 'Thanks @Sam Support, and @Adiutor Tests Client.' },
      }),
      expect.objectContaining({
        // Taken off by nobody in particular, shown as the staff; about an account that's gone.
        by: { name: 'Adiutor Tests Support', side: 'staff' },
        change: 'unassigned',
        person: null,
      }),
    ]);
  });

  it('tells nothing of who was signed in as whom, and holds no address or user ID', async () => {
    const { id } = await storeRequest(company.id, { createdBy: pat });
    const reply = await storeEntry(id, {
      authorId: pat,
      body: 'Sent while a staff member was signed in as Pat.',
      signedInAs: true,
      signedInAsStaffId: sam,
    });

    const news = await readWebhookNews(db, id, [
      { event: 'raised', entryId: null },
      { event: 'reply', entryId: reply.id },
    ]);

    const json = JSON.stringify(news);
    expect(json).not.toContain('@adiutor.test');
    expect(json).not.toContain(pat);
    expect(json).not.toContain(sam);
    expect(json).not.toMatch(/signedInAs|staffId/i);
    expect(news?.events[1]).toMatchObject({ by: { name: 'Pat Client', side: 'company' } });
  });

  it('leaves out news that’s no longer there, and tells nothing when none is left', async () => {
    const { id } = await storeRequest(company.id);
    const reply = await storeEntry(id, { body: 'Any news?' });
    const other = await storeRequest(company.id);
    const elsewhere = await storeEntry(other.id, { body: 'Another request’s reply.' });

    // A reply queued as a status change, and another request's entry, aren't this news.
    expect(
      await readWebhookNews(db, id, [
        { event: 'status', entryId: reply.id },
        { event: 'reply', entryId: elsewhere.id },
      ]),
    ).toBeNull();
    expect(
      await readWebhookNews(db, '019abcde-0000-7000-8000-000000000000', [
        { event: 'raised', entryId: null },
      ]),
    ).toBeNull();
  });
});
