/**
 * @file Integration tests for internal requests (decision 0048): requests
 * without a company, which only the staff read. Who reads them, the lists
 * and the board they're on, raising one, working on one (replies, links to
 * the staff's pages, no solutions, mentions, subscribers) and who is told
 * about one. The authorization matrix has a row for each operation on one.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { queuedJob, requestEntry } from '@/db/schema';
import { appUrl } from '@/lib/env';
import { INTERNAL_CHOICE, writtenMentionMarker } from '@/lib/requests';

import {
  actorFor,
  addMember,
  createCompany,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { assertStillManages } from '../access';
import { countAssignedRequests } from './assignees';
import { listBoard } from './board';
import { getRequest } from './detail';
import { editReply, editRequestDescription } from './edits';
import { listRequests } from './list';
import mentionKey from './mention-key';
import { listMentionable } from './mentions';
import raiseRequest from './raise';
import replyToRequest from './reply';
import { changeSubscribers, listSubscribable } from './subscribers';
import {
  ctx,
  db,
  storeAssignees,
  storeRequest,
  storeSubscribers,
  storedRequest,
} from './test-helpers';
import { type QueuedRequestNews, readRequestUpdate } from './updates';

/**
 * A text with a link to one of the staff's pages, which only the staff may read as a link.
 *
 * @param userId - The user whose page it links to.
 * @returns The text.
 */
const withStaffLink = (userId: string) =>
  `Ask [Sam Support](${appUrl}/admin/users/${userId}) about the toner.`;

/**
 * The news queued for one person, as the batch hands it over.
 *
 * @param userId - The person.
 * @returns Their news.
 */
async function newsFor(userId: string): Promise<QueuedRequestNews[]> {
  const jobs = await db
    .select({ id: queuedJob.id, payload: queuedJob.payload })
    .from(queuedJob)
    .where(eq(queuedJob.kind, 'request-update'));
  return jobs.flatMap(({ id, payload }) => {
    const news = payload as { userId: string } & Omit<QueuedRequestNews, 'jobId'>;
    return news.userId === userId
      ? [{ jobId: id, event: news.event, entryId: news.entryId, byUserId: news.byUserId }]
      : [];
  });
}

describe('who reads an internal request', () => {
  it('is every staff role, as the staff', async () => {
    const raised = await storeRequest(null);

    await Promise.all(
      (['platform_admin', 'manager', 'support', 'finance'] as const).map(async (role) => {
        const detail = await getRequest(ctx, await staffActor(db, role), String(raised.number));
        expect(detail).toMatchObject({ company: null, audience: 'staff', priority: 'normal' });
      }),
    );
  });

  it('is nobody at a company, its Admins included: for them it isn’t there', async () => {
    const company = await createCompany(db);
    const raised = await storeRequest(null);

    await Promise.all(
      (['admin', 'client', 'watcher'] as const).map(async (role) => {
        await expect(
          getRequest(ctx, await memberActor(db, company.id, role), String(raised.number)),
        ).rejects.toMatchObject({ code: 'not_found' });
      }),
    );
  });

  it('counts only the staff role of a staff member who is also a company’s Admin', async () => {
    const company = await createCompany(db);
    const finance = await staffActor(db, 'finance');
    await addMember(db, company.id, finance.id, 'admin');
    const raised = await storeRequest(null);

    const detail = await getRequest(ctx, await actorFor(db, finance.id), raised.id);
    // Finance reads it, and takes no part: their membership doesn't count here.
    expect(detail.permissions.has('requests:contribute')).toBe(false);
    expect(detail.audience).toBe('staff');
  });
});

describe('the lists and the board', () => {
  it('show the staff every company’s requests and the internal ones, and nobody else these', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const own = await storeRequest(company.id);
    const internal = await storeRequest(null);

    const forStaff = await listRequests(ctx, await staffActor(db, 'support'));
    expect(forStaff.items.map(({ id, company: of }) => [id, of?.id ?? null])).toEqual(
      expect.arrayContaining([
        [own.id, company.id],
        [internal.id, null],
      ]),
    );
    const forClient = await listRequests(ctx, client);
    expect(forClient.items.map(({ id }) => id)).toEqual([own.id]);
  });

  it('filters the staff’s lists to the internal requests, and refuses that filter to anyone else', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');
    await storeRequest(company.id);
    const internal = await storeRequest(null);

    const page = await listRequests(ctx, await staffActor(db, 'finance'), {
      company: INTERNAL_CHOICE,
    });
    expect(page.items.map(({ id }) => id)).toEqual([internal.id]);
    await expect(listRequests(ctx, admin, { company: INTERNAL_CHOICE })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('keeps internal requests on the board, movable by the staff who work on requests', async () => {
    const internal = await storeRequest(null, { status: 'in_progress' });

    const board = await listBoard(ctx, await staffActor(db, 'support'));
    const card = board.lanes
      .find(({ status }) => status === 'in_progress')
      ?.items.find(({ id }) => id === internal.id);
    expect(card?.company).toBeNull();
    // Any lane but Waiting for approval, which nobody could answer anyway.
    expect(card?.moves).toEqual(['open', 'todo', 'waiting', 'done', 'cancelled']);

    const forFinance = await listBoard(ctx, await staffActor(db, 'finance'));
    expect(
      forFinance.lanes.flatMap(({ items }) => items).find(({ id }) => id === internal.id)?.moves,
    ).toEqual([]);
  });

  it('counts internal requests assigned to someone in Assigned to you', async () => {
    const support = await staffActor(db, 'support');
    const internal = await storeRequest(null);
    await storeAssignees(internal.id, [support.id]);

    expect(await countAssignedRequests(ctx, support)).toBe(1);
  });
});

describe('raising an internal request', () => {
  it('is for the staff who work on requests: theirs, without a company, and followed', async () => {
    const support = await staffActor(db, 'support');

    const raised = await raiseRequest(ctx, support, {
      companyId: INTERNAL_CHOICE,
      title: 'Renew the certificates',
      description: withStaffLink(support.id),
      type: 'support',
      priority: 'high',
    });

    expect(await storedRequest(raised.id)).toMatchObject({
      companyId: null,
      createdBy: support.id,
      createdBySide: 'staff',
      priority: 'high',
      // Only the staff read it: a link to one of their pages stays a link.
      description: withStaffLink(support.id),
    });
    const detail = await getRequest(ctx, support, raised.id);
    expect(detail.subscribed).toBe(true);
  });

  it('is refused to Finance, who reads them, and not there for anyone at a company', async () => {
    const company = await createCompany(db);
    const input = {
      companyId: INTERNAL_CHOICE,
      title: 'Renew the certificates',
      description: 'They run out on Friday.',
      type: 'support',
    };

    await expect(raiseRequest(ctx, await staffActor(db, 'finance'), input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      raiseRequest(ctx, await memberActor(db, company.id, 'admin'), input),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is never raised for someone at a company', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    await expect(
      raiseRequest(ctx, await staffActor(db, 'support'), {
        companyId: INTERNAL_CHOICE,
        title: 'Renew the certificates',
        description: 'They run out on Friday.',
        type: 'support',
        raisedFor: mentionKey(company.id, client.id),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('mentions only the staff, by keys of the internal requests’ own', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager', 'morgan@adiutor.test');

    const people = await listMentionable(ctx, support, { internal: true });
    expect(people).toContainEqual({
      key: mentionKey(null, manager.id),
      name: 'morgan',
      staff: true,
    });
    expect(people.map(({ name }) => name)).not.toContain(client.name);

    // A key made in a company stands for nobody in an internal request.
    const { number } = await raiseRequest(ctx, support, {
      companyId: INTERNAL_CHOICE,
      title: 'Renew the certificates',
      description: `${writtenMentionMarker('Morgan', mentionKey(null, manager.id))} and ${writtenMentionMarker('Casey', mentionKey(company.id, client.id))}`,
      type: 'support',
    });
    const raised = await getRequest(ctx, manager, String(number));
    expect(raised.subscribed).toBe(true);
    expect(Object.values(raised.description.mentions ?? {}).map(({ name }) => name)).toEqual([
      'morgan',
    ]);
  });
});

describe('working on an internal request', () => {
  it('keeps the staff’s links in replies and edits, as in a note', async () => {
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(null);

    await replyToRequest(ctx, support, { request: raised.id, body: 'Looking.' });
    const [reply] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(eq(requestEntry.requestId, raised.id));
    await editReply(ctx, support, {
      request: raised.id,
      entry: reply?.id ?? '',
      text: withStaffLink(support.id),
      edits: 0,
    });
    await replyToRequest(ctx, support, { request: raised.id, body: withStaffLink(support.id) });

    const bodies = await db
      .select({ body: requestEntry.body })
      .from(requestEntry)
      .where(eq(requestEntry.requestId, raised.id));
    expect(bodies.map(({ body }) => body)).toEqual([
      withStaffLink(support.id),
      withStaffLink(support.id),
    ]);
  });

  it('keeps the staff’s links in an edited description', async () => {
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(null);

    await editRequestDescription(ctx, support, {
      request: raised.id,
      text: withStaffLink(support.id),
      edits: 0,
    });

    expect((await storedRequest(raised.id))?.description).toBe(withStaffLink(support.id));
  });

  it('never sends a reply as a solution, and still waits with one', async () => {
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(null, { status: 'in_progress' });

    await expect(
      replyToRequest(ctx, support, { request: raised.id, body: 'Done?', status: 'proposed' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      await replyToRequest(ctx, support, {
        request: raised.id,
        body: 'Waiting for the supplier.',
        status: 'waiting',
      }),
    ).toEqual({ status: 'waiting' });
  });

  it('subscribes only the staff, named by keys of the internal requests’ own', async () => {
    const company = await createCompany(db);
    await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance', 'fran@adiutor.test');
    const raised = await storeRequest(null);

    const choices = await listSubscribable(ctx, support, raised.id);
    expect(choices.every(({ staff }) => staff)).toBe(true);
    expect(choices.map(({ key }) => key)).toContain(mentionKey(null, finance.id));

    await changeSubscribers(ctx, support, {
      request: raised.id,
      add: [mentionKey(null, finance.id)],
      remove: [],
    });
    expect((await getRequest(ctx, support, raised.id)).subscribers.map(({ name }) => name)).toEqual(
      ['fran'],
    );
  });

  it('checks again in the change that the actor still works on internal requests', async () => {
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance');

    await db.transaction(async (tx) => {
      await expect(
        assertStillManages(tx, support, null, 'requests:manage', { internalRequest: true }),
      ).resolves.toMatchObject({ companyDeactivatedAt: null });
      await expect(
        assertStillManages(tx, finance, null, 'requests:manage', { internalRequest: true }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });
});

describe('who is told about an internal request', () => {
  it('emails the staff on it, with "Internal" for its company and the links to staff pages', async () => {
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance');
    const raised = await storeRequest(null);
    await storeSubscribers(raised.id, [finance.id]);

    await replyToRequest(ctx, support, { request: raised.id, body: withStaffLink(support.id) });

    const update = await readRequestUpdate(
      ctx,
      { requestId: raised.id, userId: finance.id },
      await newsFor(finance.id),
    );
    expect(update).toMatchObject({
      audience: 'staff',
      request: { number: raised.number, companyName: null },
      items: [{ event: 'reply', text: { text: withStaffLink(support.id) } }],
    });
  });
});
