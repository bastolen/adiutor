/**
 * @file Integration tests for request work done while a staff member is
 * signed in as a user (decision 0028): each kind of change records the staff
 * member, the work counts against the staff member's rate limits, a sign-in
 * that ended changes nothing, and only the user and the staff who see the
 * audit log are told. A change of subscriptions, which leaves no history, goes
 * to the audit log instead (decision 0025). Which operations are allowed is
 * in the authorization matrix.
 */
import { and, eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  impersonation,
  rateLimitBucket,
  request,
  requestEntry,
  requestTextVersion,
  user,
} from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  createCompany,
  memberActor,
  staffActor,
  auditEvents,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { listOwnActivity } from '../audit';
import { changeAssignees } from './assignees';
import { getRequest } from './detail';
import updateRequestDetails from './details';
import { editReply, editRequestDescription } from './edits';
import mentionKey from './mention-key';
import addNote from './notes';
import raiseRequest from './raise';
import replyToRequest from './reply';
import changeRequestStatus from './status';
import { subscribe, unsubscribe } from './subscribers';
import { ctx, db, storeRequest, entriesOf } from './test-helpers';
import { addRequestType } from './types';

/**
 * Signs a staff member in as a user: the row the sign-in keeps, and the
 * user as the actor, with the staff member on it.
 *
 * @param staff - The staff member.
 * @param target - The user they sign in as.
 * @returns The user, as the actor while the staff member is signed in as them.
 */
async function signInAs(staff: Actor, target: Actor): Promise<Actor> {
  const endsAt = new Date(Date.now() + 30 * 60_000);
  await db.insert(impersonation).values({
    staffUserId: staff.id,
    userId: target.id,
    returnTo: '/dashboard',
    expiresAt: endsAt,
  });
  return {
    ...target,
    signedInAs: {
      staffId: staff.id,
      staffName: staff.name,
      endsAt,
      returnTo: '/dashboard',
      staffPermissions: ['users:view', 'users:manage', 'audit:view'],
    },
  };
}

/**
 * The request's entries' kinds and what they record about a staff member,
 * oldest first.
 *
 * @param requestId - The request.
 * @returns Each entry.
 */
async function entries(requestId: string) {
  const rows = await entriesOf(requestId);
  return rows.map(({ kind, authorId, signedInAs, signedInAsStaffId }) => ({
    kind,
    authorId,
    signedInAs,
    signedInAsStaffId,
  }));
}

describe('request work while a staff member is signed in as a user', () => {
  it('raises a request in the user’s name, and records the staff member', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const client = await memberActor(db, company.id, 'client');
    const asClient = await signInAs(admin, client);

    const raised = await raiseRequest(ctx, asClient, {
      companyId: company.id,
      title: 'The printer is broken',
      description: 'It prints blank pages.',
      type: 'bug',
    });

    const stored = firstRow(
      await db.select().from(request).where(eq(request.id, raised.id)),
      'the request',
    );
    expect(stored).toMatchObject({
      createdBy: client.id,
      createdBySide: 'company',
      createdSignedInAs: true,
      createdSignedInAsStaffId: admin.id,
    });
  });

  it('raises a request for someone at a company while signed in as a staff member', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const manager = await staffActor(db, 'manager');
    const client = await memberActor(db, company.id, 'client');
    const asManager = await signInAs(admin, manager);

    const raised = await raiseRequest(ctx, asManager, {
      companyId: company.id,
      title: 'The printer is broken',
      description: 'They called about it.',
      type: 'bug',
      raisedFor: mentionKey(company.id, client.id),
    });

    const stored = firstRow(
      await db.select().from(request).where(eq(request.id, raised.id)),
      'the request',
    );
    // The manager raised it for the Client; the Admin did that while signed in as the manager.
    expect(stored).toMatchObject({
      createdBy: client.id,
      createdOnBehalf: true,
      createdOnBehalfBy: manager.id,
      createdSignedInAs: true,
      createdSignedInAsStaffId: admin.id,
    });
  });

  it('records the staff member on a reply, a status change and both edits', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { createdBy: client.id });
    const asClient = await signInAs(admin, client);

    await replyToRequest(ctx, asClient, { request: raised.id, body: 'It still prints blank.' });
    await changeRequestStatus(ctx, asClient, { request: raised.id, status: 'done' });
    await changeRequestStatus(ctx, asClient, { request: raised.id, status: 'open' });
    const reply = firstRow(
      await db
        .select({ id: requestEntry.id })
        .from(requestEntry)
        .where(and(eq(requestEntry.requestId, raised.id), eq(requestEntry.kind, 'comment'))),
      'the reply',
    );
    await editReply(ctx, asClient, {
      request: raised.id,
      entry: reply.id,
      text: 'It still prints blank pages.',
      edits: 0,
    });
    await editRequestDescription(ctx, asClient, {
      request: raised.id,
      text: 'It prints blank pages, every time.',
      edits: 0,
    });

    const work = { authorId: client.id, signedInAs: true, signedInAsStaffId: admin.id };
    expect(await entries(raised.id)).toEqual([
      { kind: 'comment', ...work },
      { kind: 'status', ...work },
      { kind: 'status', ...work },
    ]);
    const versions = await db
      .select({
        editedBy: requestTextVersion.editedBy,
        signedInAs: requestTextVersion.signedInAs,
        signedInAsStaffId: requestTextVersion.signedInAsStaffId,
      })
      .from(requestTextVersion)
      .where(eq(requestTextVersion.requestId, raised.id));
    expect(versions).toEqual([
      { editedBy: client.id, signedInAs: true, signedInAsStaffId: admin.id },
      { editedBy: client.id, signedInAs: true, signedInAsStaffId: admin.id },
    ]);
  });

  it('does a staff user’s request work as them: a note, details and assigning', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const manager = await staffActor(db, 'manager');
    const raised = await storeRequest(company.id);
    const asManager = await signInAs(admin, manager);

    await addNote(ctx, asManager, { request: raised.id, body: 'Ask about the toner.' });
    await updateRequestDetails(ctx, asManager, {
      request: raised.id,
      title: 'The printer prints blank pages',
      type: 'bug',
      priority: 'normal',
      was: { title: raised.title, type: 'bug', priority: 'normal' },
    });
    await changeAssignees(ctx, asManager, { request: raised.id, add: [manager.id], remove: [] });

    const work = { authorId: manager.id, signedInAs: true, signedInAsStaffId: admin.id };
    expect(await entries(raised.id)).toEqual([
      { kind: 'note', ...work },
      { kind: 'title', ...work },
      { kind: 'assignee', ...work },
    ]);
  });

  it('counts against the staff member’s rate limits, never the user’s', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { createdBy: client.id });
    const asClient = await signInAs(admin, client);

    await replyToRequest(ctx, asClient, { request: raised.id, body: 'Any news?' });

    const buckets = await db
      .select({ key: rateLimitBucket.key })
      .from(rateLimitBucket)
      .where(like(rateLimitBucket.key, 'request-reply:%'));
    expect(buckets).toEqual([{ key: `request-reply:user:${admin.id}` }]);
  });

  it('changes nothing once the sign-in has ended', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { createdBy: client.id });
    const asClient = await signInAs(admin, client);
    // Ending it deletes its row; the actor the page loaded still carries it.
    await db.delete(impersonation).where(eq(impersonation.userId, client.id));

    await expect(
      replyToRequest(ctx, asClient, { request: raised.id, body: 'Any news?' }),
    ).rejects.toMatchObject({ code: 'signed_in_as', key: 'errors.impersonation.ended' });
    expect(await entries(raised.id)).toEqual([]);
  });

  it('still refuses managing request types', async () => {
    const admin = await staffActor(db, 'platform_admin');
    const otherAdmin = await staffActor(db, 'platform_admin');
    const asAdmin = await signInAs(otherAdmin, admin);

    await expect(
      addRequestType(ctx, asAdmin, {
        name: 'Printers',
        description: 'A printer acts up.',
        startingPriority: 'normal',
      }),
    ).rejects.toMatchObject({ code: 'signed_in_as' });
  });

  it('refuses a staff member stored without the flag', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');

    await expect(
      storeRequest(company.id, { createdSignedInAsStaffId: admin.id }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'request_created_signed_in_as_fits' },
    });
  });
});

describe('who is told about work done while signed in as someone', () => {
  /**
   * A request a staff Admin replied to while signed in as a client, and the
   * people who read it.
   *
   * @returns The request, the client, the staff Admin who did it, and the other readers.
   */
  async function aReplyWhileSignedIn() {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin', 'ann@adiutor.test');
    await db.update(user).set({ name: 'Ann Staff' }).where(eq(user.id, admin.id));
    const client = await memberActor(db, company.id, 'client');
    const colleague = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id, { createdBy: client.id });
    const asClient = await signInAs({ ...admin, name: 'Ann Staff' }, client);
    await replyToRequest(ctx, asClient, { request: raised.id, body: 'It still prints blank.' });
    return { raised, admin, client, colleague };
  }

  it('tells the user and the staff who see the audit log, by the staff member’s name', async () => {
    const { raised, client } = await aReplyWhileSignedIn();
    const manager = await staffActor(db, 'manager');

    const reads = await Promise.all(
      [client, manager].map((reader) => getRequest(ctx, reader, raised.id)),
    );
    reads.forEach(({ entries: read }) => {
      expect(read).toMatchObject([{ kind: 'comment', signedInAs: { staffName: 'Ann Staff' } }]);
    });
  });

  it('tells nobody else: a colleague, Support and Finance read it as the user’s', async () => {
    const { raised, colleague } = await aReplyWhileSignedIn();
    const support = await staffActor(db, 'support');
    const finance = await staffActor(db, 'finance');

    const reads = await Promise.all(
      [colleague, support, finance].map((reader) => getRequest(ctx, reader, raised.id)),
    );
    reads.forEach(({ entries: read }) => {
      expect(read).toHaveLength(1);
      expect(read[0]).not.toHaveProperty('signedInAs');
    });
  });

  it('says a staff member did it once their account is gone', async () => {
    const { raised, admin, client } = await aReplyWhileSignedIn();
    await db.delete(user).where(eq(user.id, admin.id));

    const { entries: read } = await getRequest(ctx, client, raised.id);
    expect(read).toMatchObject([{ signedInAs: { staffName: null } }]);
  });

  it('tells the user about a request raised and a text edited while signed in as them', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    await db.update(user).set({ name: 'Ann Staff' }).where(eq(user.id, admin.id));
    const client = await memberActor(db, company.id, 'client');
    const colleague = await memberActor(db, company.id, 'client');
    const asClient = await signInAs(admin, client);
    const raised = await raiseRequest(ctx, asClient, {
      companyId: company.id,
      title: 'The printer is broken',
      description: 'It prints blank pages.',
      type: 'bug',
    });
    await editRequestDescription(ctx, asClient, {
      request: raised.id,
      text: 'It prints blank pages, every time.',
      edits: 0,
    });

    const own = await getRequest(ctx, client, raised.id);
    expect(own.raisedSignedInAs).toEqual({ staffName: 'Ann Staff' });
    expect(own.description.editedSignedInAs).toMatchObject({
      staffName: 'Ann Staff',
      editedBy: { isViewer: true },
    });
    const theirs = await getRequest(ctx, colleague, raised.id);
    expect(theirs).not.toHaveProperty('raisedSignedInAs');
    expect(theirs.description).not.toHaveProperty('editedSignedInAs');
  });
});

describe('subscriptions changed while signed in as someone', () => {
  it('go to the audit log, by the staff member about the user, and not to the user’s own activity', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const watcher = await memberActor(db, company.id, 'watcher');
    const raised = await storeRequest(company.id);
    const asWatcher = await signInAs(admin, watcher);

    await expect(subscribe(ctx, asWatcher, { request: raised.id })).resolves.toEqual({
      subscribed: true,
    });
    await expect(unsubscribe(ctx, asWatcher, { request: raised.id })).resolves.toEqual({
      unsubscribed: true,
    });

    const events = await auditEvents(db, { action: 'request_subscribers_changed' });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actorUserId: admin.id,
      targetUserId: watcher.id,
      companyId: company.id,
      // The staff member's name as the sign-in has it, so the line survives their account.
      details: { requestId: raised.id, subscribed: [watcher.id], staffMember: admin.name },
    });
    expect(events[1]).toMatchObject({ details: { unsubscribed: [watcher.id] } });
    const own = await listOwnActivity(ctx, watcher);
    expect(own.map(({ action }) => action)).not.toContain('request_subscribers_changed');
  });

  it('count against the staff member’s rate limit, and the user’s own change records nothing', async () => {
    const company = await createCompany(db);
    const admin = await staffActor(db, 'platform_admin');
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);

    await subscribe(ctx, await signInAs(admin, client), { request: raised.id });
    await unsubscribe(ctx, client, { request: raised.id });

    const buckets = await db
      .select({ key: rateLimitBucket.key })
      .from(rateLimitBucket)
      .where(like(rateLimitBucket.key, 'request-change:user:%'));
    expect(buckets.map(({ key }) => key).sort()).toEqual(
      [`request-change:user:${admin.id}`, `request-change:user:${client.id}`].sort(),
    );
    const events = await auditEvents(db, {
      action: 'request_subscribers_changed',
      fields: ['actorUserId'],
    });
    expect(events).toEqual([{ actorUserId: admin.id }]);
  });
});
