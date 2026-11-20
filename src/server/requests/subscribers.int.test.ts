/**
 * @file Integration tests for subscribing to a request: who can subscribe,
 * who changes whose subscription, who is subscribed automatically, what a
 * reader sees, what ends a subscription, and the subscribers the migration
 * gives the requests there were. Which roles may do what is in the
 * authorization matrix.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { membership, requestEntry, requestMention, requestParticipant, user } from '@/db/schema';
import { writtenMentionMarker } from '@/lib/requests';

import {
  actorFor,
  addMember,
  createCompany,
  createStaffSettings,
  createUser,
  fillRateLimitBucket,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { removeMember } from '../people/members';
import { changeStaffRole, removeFromStaff } from '../people/staff';
import { deactivateUser, deleteUser } from '../people/user-admin';
import { RATE_LIMITS } from '../rate-limit';
import { changeAssignees } from './assignees';
import { getRequest } from './detail';
import { mentionKey } from './mentions';
import raiseRequest from './raise';
import replyToRequest from './reply';
import {
  changeSubscribers,
  listSubscribable,
  MAX_SUBSCRIBER_CHANGES,
  subscribe,
  unsubscribe,
} from './subscribers';
import { assigneesOf, ctx, db, storedRequest, storeRequest } from './test-helpers';

/**
 * Who is subscribed to a request.
 *
 * @param requestId - The request.
 * @returns Their user IDs, sorted.
 */
async function subscribersOf(requestId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: requestParticipant.userId })
    .from(requestParticipant)
    .where(
      and(eq(requestParticipant.requestId, requestId), eq(requestParticipant.role, 'subscriber')),
    );
  return rows.map(({ userId }) => userId).sort();
}

/**
 * Subscribes people to a request without going through a service.
 *
 * @param requestId - The request.
 * @param userIds - The people.
 */
async function storeSubscribers(requestId: string, userIds: readonly string[]): Promise<void> {
  await db
    .insert(requestParticipant)
    .values(userIds.map((userId) => ({ requestId, userId, role: 'subscriber' as const })));
}

/**
 * The names of the people in a list, with the staff marked.
 *
 * @param people - The list.
 * @returns Each name, followed by "(staff)" for the staff and "*" for a subscriber.
 */
const names = (people: Awaited<ReturnType<typeof listSubscribable>>) =>
  people.map(
    ({ name, staff, subscribed }) => `${name}${staff ? ' (staff)' : ''}${subscribed ? '*' : ''}`,
  );

describe('subscribe and unsubscribe', () => {
  it('lets everyone who reads a request follow it, also who can’t reply to it', async () => {
    const company = await createCompany(db);
    const watcher = await memberActor(db, company.id, 'watcher');
    const finance = await staffActor(db, 'finance');
    const raised = await storeRequest(company.id);
    const before = await storedRequest(raised.id);

    expect(await subscribe(ctx, watcher, { request: String(raised.number) })).toEqual({
      subscribed: true,
    });
    expect(await subscribe(ctx, finance, { request: raised.id })).toEqual({ subscribed: true });
    // Once is enough.
    expect(await subscribe(ctx, watcher, { request: raised.id })).toEqual({ subscribed: false });

    expect(await subscribersOf(raised.id)).toEqual([watcher.id, finance.id].sort());
    // A preference, not work on the request: nothing in its history, and no activity.
    expect(await db.select().from(requestEntry)).toEqual([]);
    expect((await storedRequest(raised.id))?.lastActivityAt).toEqual(before?.lastActivityAt);
  });

  it('unsubscribes only the one who asks', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [client.id, watcher.id]);

    expect(await unsubscribe(ctx, client, { request: raised.id })).toEqual({ unsubscribed: true });
    expect(await unsubscribe(ctx, client, { request: raised.id })).toEqual({ unsubscribed: false });

    expect(await subscribersOf(raised.id)).toEqual([watcher.id]);
  });

  it('keeps an assignee assigned when they unsubscribe', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await changeAssignees(ctx, support, { request: raised.id, add: [support.id], remove: [] });
    await subscribe(ctx, support, { request: raised.id });
    expect(await subscribersOf(raised.id)).toEqual([support.id]);

    await unsubscribe(ctx, support, { request: raised.id });

    expect(await subscribersOf(raised.id)).toEqual([]);
    expect(await assigneesOf(raised.id)).toEqual([support.id]);
  });

  it('is refused for a request the actor can’t read, and in a deactivated company', async () => {
    const company = await createCompany(db);
    const outsider = await memberActor(db, (await createCompany(db)).id, 'admin');
    const raised = await storeRequest(company.id);
    await expect(subscribe(ctx, outsider, { request: raised.id })).rejects.toMatchObject({
      code: 'not_found',
    });

    const closed = await createCompany(db, { deactivated: true });
    const inClosed = await storeRequest(closed.id);
    const support = await staffActor(db, 'support');
    await expect(subscribe(ctx, support, { request: inClosed.id })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(unsubscribe(ctx, support, { request: inClosed.id })).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('counts against the limit on changes to requests', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await fillRateLimitBucket(
      db,
      `request-change:user:${client.id}`,
      RATE_LIMITS.requestChangesPerUser.limit,
    );

    await expect(subscribe(ctx, client, { request: raised.id })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(await subscribersOf(raised.id)).toEqual([]);
  });
});

describe('changeSubscribers', () => {
  it('lets the staff who work on requests subscribe anyone who reads the request, and take them off', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const finance = await staffActor(db, 'finance');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    expect(
      await changeSubscribers(ctx, support, {
        request: raised.id,
        add: [client.id, watcher.id, finance.id, client.id],
        remove: [],
      }),
    ).toEqual({ added: 3, removed: 0 });
    // Each person is a change of their own: who's subscribed isn't added again, and who isn't
    // subscribed isn't removed.
    expect(
      await changeSubscribers(ctx, support, {
        request: raised.id,
        add: [client.id],
        remove: [watcher.id, support.id],
      }),
    ).toEqual({ added: 0, removed: 1 });

    expect(await subscribersOf(raised.id)).toEqual([client.id, finance.id].sort());
    expect(await db.select().from(requestEntry)).toEqual([]);
  });

  it('adds someone who is in both lists', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await changeSubscribers(ctx, support, {
      request: raised.id,
      add: [client.id],
      remove: [client.id],
    });

    expect(await subscribersOf(raised.id)).toEqual([client.id]);
  });

  it('lets a company’s Admin subscribe and unsubscribe their colleagues, and nobody else', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');
    const colleague = await memberActor(db, company.id, 'watcher');
    const support = await staffActor(db, 'support');
    const outsider = await memberActor(db, (await createCompany(db)).id, 'client');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [support.id]);

    expect(
      await changeSubscribers(ctx, admin, { request: raised.id, add: [colleague.id], remove: [] }),
    ).toEqual({ added: 1, removed: 0 });
    // Someone on the staff, or at another company, isn't theirs to subscribe.
    await expect(
      changeSubscribers(ctx, admin, { request: raised.id, add: [support.id], remove: [] }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.requests.notSubscribable' });
    await expect(
      changeSubscribers(ctx, admin, { request: raised.id, add: [outsider.id], remove: [] }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.requests.notSubscribable' });
    // And a staff member who follows along is left alone, without a word about it.
    expect(
      await changeSubscribers(ctx, admin, {
        request: raised.id,
        add: [],
        remove: [support.id, colleague.id],
      }),
    ).toEqual({ added: 0, removed: 1 });

    expect(await subscribersOf(raised.id)).toEqual([support.id]);
  });

  it('counts someone on the staff who is in the company as a colleague', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');
    const both = await staffActor(db, 'support');
    await addMember(db, company.id, both.id, 'client');
    const raised = await storeRequest(company.id);

    await changeSubscribers(ctx, admin, { request: raised.id, add: [both.id], remove: [] });

    expect(await subscribersOf(raised.id)).toEqual([both.id]);
  });

  it('refuses someone who may only change their own subscription', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const watcher = await memberActor(db, company.id, 'watcher');
    const finance = await staffActor(db, 'finance');
    const raised = await storeRequest(company.id);

    for (const actor of [client, watcher, finance]) {
      // eslint-disable-next-line no-await-in-loop -- One after another, on one connection.
      await expect(
        changeSubscribers(ctx, actor, { request: raised.id, add: [watcher.id], remove: [] }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await subscribersOf(raised.id)).toEqual([]);
  });

  it('subscribes nobody who can’t read the request: a deactivated account, a stranger, nobody at all', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const left = await memberActor(db, company.id, 'client');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, left.id));
    const stranger = await createUser(db, 'stranger@adiutor.test');
    const raised = await storeRequest(company.id);

    for (const id of [left.id, stranger, '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b']) {
      // eslint-disable-next-line no-await-in-loop -- One after another, on one connection.
      await expect(
        changeSubscribers(ctx, support, { request: raised.id, add: [id], remove: [] }),
      ).rejects.toMatchObject({ code: 'invalid', key: 'errors.requests.notSubscribable' });
    }
    expect(await subscribersOf(raised.id)).toEqual([]);
  });

  it('lets the staff take off someone who can no longer be subscribed', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const left = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [left.id]);
    await db.delete(membership).where(eq(membership.userId, left.id));

    expect(
      await changeSubscribers(ctx, support, { request: raised.id, add: [], remove: [left.id] }),
    ).toEqual({ added: 0, removed: 1 });
  });

  it('takes user IDs only, and not more than a change holds', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);

    await expect(
      changeSubscribers(ctx, support, { request: raised.id, add: ['someone'], remove: [] }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      changeSubscribers(ctx, support, {
        request: raised.id,
        add: [],
        remove: Array.from({ length: MAX_SUBSCRIBER_CHANGES + 1 }, () => support.id),
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('listSubscribable', () => {
  it('lists everyone who reads the request for the staff, with who is subscribed', async () => {
    const company = await createCompany(db);
    await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    await staffActor(db, 'finance', 'fenna@adiutor.test');
    // Nobody here: at another company, deactivated, or without a name to show.
    await memberActor(db, (await createCompany(db)).id, 'client', 'other@adiutor.test');
    const left = await memberActor(db, company.id, 'client', 'left@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, left.id));
    const nameless = await memberActor(db, company.id, 'client', 'nameless@adiutor.test');
    await db.update(user).set({ name: ' ' }).where(eq(user.id, nameless.id));
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [casey.id]);

    expect(names(await listSubscribable(ctx, support, String(raised.number)))).toEqual([
      'anna',
      'casey*',
      'fenna (staff)',
      'sam (staff)',
    ]);
  });

  it('lists a company’s Admin their colleagues, and nobody as staff', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const both = await staffActor(db, 'support', 'both@adiutor.test');
    await addMember(db, company.id, both.id, 'client');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [support.id]);

    expect(names(await listSubscribable(ctx, admin, raised.id))).toEqual(['anna', 'both', 'wim']);
  });

  it('is only for whoever may change other people’s subscriptions', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const finance = await staffActor(db, 'finance');
    const raised = await storeRequest(company.id);

    await expect(listSubscribable(ctx, client, raised.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(listSubscribable(ctx, finance, raised.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('who is subscribed automatically', () => {
  it('subscribes whoever raises a request, replies to it or is mentioned in it', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const wim = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');

    const raised = await raiseRequest(ctx, admin, {
      companyId: company.id,
      title: 'The printer is broken',
      description: `${writtenMentionMarker('wim', mentionKey(company.id, wim.id))} saw it first.`,
      type: 'bug',
    });
    expect(await subscribersOf(raised.id)).toEqual([admin.id, wim.id].sort());

    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Which one, ${writtenMentionMarker('casey', mentionKey(company.id, casey.id))}?`,
    });

    expect(await subscribersOf(raised.id)).toEqual([admin.id, wim.id, support.id, casey.id].sort());
    expect(await db.select().from(requestMention)).toHaveLength(2);
  });

  it('subscribes someone who unsubscribed again when they reply', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);
    await replyToRequest(ctx, client, { request: raised.id, body: 'Any news?' });
    await unsubscribe(ctx, client, { request: raised.id });
    expect(await subscribersOf(raised.id)).toEqual([]);

    await replyToRequest(ctx, client, { request: raised.id, body: 'It still prints blank pages.' });

    expect(await subscribersOf(raised.id)).toEqual([client.id]);
  });
});

describe('reading a request’s subscribers', () => {
  it('shows the staff everyone, and someone at the company the subscribers from their company', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const wim = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const finance = await staffActor(db, 'finance', 'fenna@adiutor.test');
    const both = await staffActor(db, 'manager', 'both@adiutor.test');
    await addMember(db, company.id, both.id, 'client');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [wim.id, finance.id, both.id, support.id]);

    const forStaff = await getRequest(ctx, support, raised.id);
    const forCasey = await getRequest(ctx, casey, raised.id);
    const forWim = await getRequest(ctx, await actorFor(db, wim.id), raised.id);

    // By name, in order; the reader is told when it's them.
    expect(forStaff.subscribers.map(({ name, side, isViewer }) => [name, side, isViewer])).toEqual([
      ['both', 'staff', false],
      ['fenna', 'staff', false],
      ['sam', 'staff', true],
      ['wim', 'company', false],
    ]);
    expect(forStaff.subscribed).toBe(true);
    // Not which staff members follow along; someone on the staff who is in the company is a
    // colleague. And never an ID.
    expect(forCasey.subscribers.map(({ name, side, userId }) => [name, side, userId])).toEqual([
      ['both', 'company', null],
      ['wim', 'company', null],
    ]);
    expect(forCasey.subscribed).toBe(false);
    expect(forWim.subscribed).toBe(true);
  });

  it('never shows a subscriber who can’t read the request anymore', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const stays = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const left = await memberActor(db, company.id, 'client', 'left@adiutor.test');
    const closed = await memberActor(db, company.id, 'client', 'closed@adiutor.test');
    const raised = await storeRequest(company.id);
    // Rows as losing access at the very moment of being subscribed would leave them.
    await storeSubscribers(raised.id, [stays.id, left.id, closed.id]);
    await db.delete(membership).where(eq(membership.userId, left.id));
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, closed.id));

    const detail = await getRequest(ctx, support, raised.id);

    expect(detail.subscribers.map(({ name }) => name)).toEqual(['casey']);
  });

  it('lists someone the request is assigned to as an assignee only', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);
    await changeAssignees(ctx, support, { request: raised.id, add: [support.id], remove: [] });
    await subscribe(ctx, support, { request: raised.id });

    const detail = await getRequest(ctx, support, raised.id);

    expect(detail.assignees.map(({ name }) => name)).toEqual(['sam']);
    expect(detail.subscribers).toEqual([]);
    expect(detail.subscribed).toBe(true);
  });
});

describe('losing access to a request', () => {
  it('ends the subscriptions of someone who leaves the company, in that company only', async () => {
    const company = await createCompany(db);
    const other = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    const leaver = await memberActor(db, company.id, 'client');
    await addMember(db, other.id, leaver.id, 'watcher');
    const colleague = await memberActor(db, company.id, 'watcher');
    const here = await storeRequest(company.id);
    const there = await storeRequest(other.id);
    await storeSubscribers(here.id, [leaver.id, colleague.id]);
    await storeSubscribers(there.id, [leaver.id]);
    const [member] = await db
      .select({ id: membership.id })
      .from(membership)
      .where(and(eq(membership.userId, leaver.id), eq(membership.companyId, company.id)));

    await removeMember(ctx, manager, { companyId: company.id, membershipId: member?.id ?? '' });

    expect(await subscribersOf(here.id)).toEqual([colleague.id]);
    expect(await subscribersOf(there.id)).toEqual([leaver.id]);
  });

  it('ends the subscriptions of someone who leaves the staff, except in a company they’re in', async () => {
    const company = await createCompany(db);
    const other = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const leaver = await staffActor(db, 'support');
    await addMember(db, company.id, leaver.id, 'client');
    const here = await storeRequest(company.id);
    const there = await storeRequest(other.id);
    await storeSubscribers(here.id, [leaver.id]);
    await storeSubscribers(there.id, [leaver.id]);

    await removeFromStaff(ctx, admin, leaver.id);

    expect(await subscribersOf(here.id)).toEqual([leaver.id]);
    expect(await subscribersOf(there.id)).toEqual([]);
  });

  it('keeps the subscriptions of a staff member whose new role still reads requests', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [support.id]);

    await changeStaffRole(ctx, admin, { userId: support.id, role: 'finance' });

    expect(await subscribersOf(raised.id)).toEqual([support.id]);
  });

  it('ends every subscription of a deactivated account, and of a deleted one', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const left = await memberActor(db, company.id, 'client');
    const gone = await memberActor(db, company.id, 'client');
    const stays = await memberActor(db, company.id, 'watcher');
    const raised = await storeRequest(company.id);
    await storeSubscribers(raised.id, [left.id, gone.id, stays.id]);

    await deactivateUser(ctx, admin, left.id);
    expect(await subscribersOf(raised.id)).toEqual([gone.id, stays.id].sort());

    await deactivateUser(ctx, admin, gone.id);
    await deleteUser(ctx, admin, gone.id, gone.email);
    expect(await subscribersOf(raised.id)).toEqual([stays.id]);
  });
});

describe('the subscribers of the requests there were', () => {
  /** What the migration does for the requests that were there before it: its last statement. */
  const backfill =
    readFileSync(path.join(process.cwd(), 'drizzle/0014_request_participants.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .at(-1) ?? '';

  it('are whoever raised one, replied to it or is mentioned in it, as far as they still read it', async () => {
    const company = await createCompany(db);
    const raiser = await memberActor(db, company.id, 'client');
    const replier = await staffActor(db, 'support');
    const mentioned = await memberActor(db, company.id, 'watcher');
    const changedIt = await staffActor(db, 'manager');
    const deactivated = await memberActor(db, company.id, 'client');
    const leftCompany = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { createdBy: raiser.id });
    const other = await storeRequest(company.id);
    await db.insert(requestEntry).values([
      {
        requestId: raised.id,
        kind: 'comment',
        authorId: replier.id,
        authorSide: 'staff',
        body: 'On it.',
      },
      {
        requestId: raised.id,
        kind: 'comment',
        authorId: replier.id,
        authorSide: 'staff',
        body: 'Done.',
      },
      {
        requestId: raised.id,
        kind: 'comment',
        authorId: deactivated.id,
        authorSide: 'company',
        body: 'Thanks.',
      },
      {
        requestId: raised.id,
        kind: 'comment',
        authorId: leftCompany.id,
        authorSide: 'company',
        body: 'Great.',
      },
      // A change of the status isn't a reply.
      {
        requestId: raised.id,
        kind: 'status',
        authorId: changedIt.id,
        authorSide: 'staff',
        fromValue: 'open',
        toValue: 'done',
      },
    ]);
    await db
      .insert(requestMention)
      .values({ requestId: raised.id, userId: mentioned.id, side: 'company' });
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, deactivated.id));
    await db.delete(membership).where(eq(membership.userId, leftCompany.id));
    // Someone the request is assigned to keeps that row, and gets one as a subscriber for replying.
    await db
      .insert(requestParticipant)
      .values({ requestId: raised.id, userId: replier.id, role: 'assignee' });

    expect(backfill).toContain('INSERT INTO "request_participant"');
    await db.execute(sql.raw(backfill));
    // Running it again changes nothing.
    await db.execute(sql.raw(backfill));

    expect(await subscribersOf(raised.id)).toEqual([raiser.id, replier.id, mentioned.id].sort());
    expect(await assigneesOf(raised.id)).toEqual([replier.id]);
    expect(await subscribersOf(other.id)).toEqual([]);
  });
});
