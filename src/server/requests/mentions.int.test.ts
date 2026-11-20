/**
 * @file Integration tests for mentions in a request's text: who may be
 * mentioned, the keys that stand for them, what's stored when a text is
 * sent, and what a reader gets back. Which roles get the list is in the
 * authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { request, requestEntry, requestMention, user } from '@/db/schema';
import {
  MAX_MENTIONS_PER_TEXT,
  MENTION_KEY_LENGTH,
  storedMentionMarker,
  writtenMentionMarker,
} from '@/lib/requests';

import {
  actorFor,
  addMember,
  createCompany,
  createStaffSettings,
  createUser,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { getRequest } from './detail';
import { listMentionable, mentionKey } from './mentions';
import raiseRequest from './raise';
import replyToRequest from './reply';
import { ctx, db, storeAssignees, storeEntry, storeRequest } from './test-helpers';

/**
 * The names in a list of people who can be mentioned, with the staff marked.
 *
 * @param people - The list.
 * @returns Each name, followed by "(staff)" for the staff.
 */
const names = (people: Awaited<ReturnType<typeof listMentionable>>) =>
  people.map(({ name, staff }) => (staff ? `${name} (staff)` : name));

/**
 * The marker a writer's browser sends for someone.
 *
 * @param companyId - The company the text is written in.
 * @param userId - The person.
 * @param name - Their name, as the list showed it.
 * @returns The marker.
 */
const marker = (companyId: string, userId: string, name = 'Someone') =>
  writtenMentionMarker(name, mentionKey(companyId, userId));

/**
 * The rows of the mentions in a request, oldest first.
 *
 * @param requestId - The request.
 * @returns The rows.
 */
const mentionsIn = (requestId: string) =>
  db
    .select()
    .from(requestMention)
    .where(eq(requestMention.requestId, requestId))
    .orderBy(requestMention.id);

describe('listMentionable', () => {
  it('gives the staff everyone at the company and every staff member, by name, but themselves', async () => {
    const company = await createCompany(db);
    await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    await staffActor(db, 'finance', 'fenna@adiutor.test');
    await staffActor(db, 'manager', 'mila@adiutor.test');
    // Someone at another company is nobody here.
    await memberActor(db, (await createCompany(db)).id, 'client', 'other@adiutor.test');
    const raised = await storeRequest(company.id);

    const inRequest = await listMentionable(ctx, support, { request: String(raised.number) });

    expect(names(inRequest)).toEqual(['anna', 'casey', 'fenna (staff)', 'mila (staff)', 'wim']);
    expect(names(await listMentionable(ctx, support, { company: company.slug }))).toEqual(
      names(inRequest),
    );
    // A key, a name and the side: no ID, and no address.
    expect(Object.keys(inRequest[0] ?? {}).sort()).toEqual(['key', 'name', 'staff']);
    expect(JSON.stringify(inRequest)).not.toContain('@adiutor.test');
  });

  it('gives someone at the company their colleagues, and the staff the request already shows', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const replied = await staffActor(db, 'support', 'replied@adiutor.test');
    const assigned = await staffActor(db, 'support', 'assigned@adiutor.test');
    const wasAssigned = await staffActor(db, 'manager', 'was-assigned@adiutor.test');
    const closed = await staffActor(db, 'manager', 'closed@adiutor.test');
    const raisedIt = await staffActor(db, 'support', 'raised@adiutor.test');
    // On the staff, but not in the request as the company sees it.
    const prioritised = await staffActor(db, 'manager', 'prioritised@adiutor.test');
    await staffActor(db, 'platform_admin', 'elsewhere@adiutor.test');
    const raised = await storeRequest(company.id, {
      createdBy: raisedIt.id,
      createdBySide: 'staff',
    });
    await storeEntry(raised.id, { authorId: replied.id, authorSide: 'staff' });
    await storeEntry(raised.id, {
      kind: 'status',
      authorId: closed.id,
      authorSide: 'staff',
      fromValue: 'open',
      toValue: 'done',
    });
    await storeEntry(raised.id, {
      kind: 'priority',
      authorId: prioritised.id,
      authorSide: 'staff',
      fromValue: 'normal',
      toValue: 'high',
    });
    await storeEntry(raised.id, {
      kind: 'assignee',
      authorId: replied.id,
      authorSide: 'staff',
      subjectUserId: wasAssigned.id,
      toValue: 'unassigned',
    });
    await storeAssignees(raised.id, [assigned.id]);

    const people = await listMentionable(ctx, client, { request: raised.id });

    expect(names(people)).toEqual([
      'assigned (staff)',
      'closed (staff)',
      'raised (staff)',
      'replied (staff)',
      'was-assigned (staff)',
      'wim',
    ]);
  });

  it('gives someone at the company only their colleagues for a request that isn’t raised yet', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    await staffActor(db, 'support', 'sam@adiutor.test');

    expect(names(await listMentionable(ctx, admin, { company: company.id }))).toEqual(['casey']);
  });

  it('leaves out a deactivated account, someone without a name to show, and a role that no longer reads requests', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const left = await memberActor(db, company.id, 'client', 'left@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, left.id));
    const nameless = await memberActor(db, company.id, 'client', 'nameless@adiutor.test');
    await db.update(user).set({ name: ' \u200b ' }).where(eq(user.id, nameless.id));
    const formerStaff = await staffActor(db, 'support', 'former@adiutor.test');
    const raised = await storeRequest(company.id);
    await storeEntry(raised.id, { authorId: formerStaff.id, authorSide: 'staff' });
    await db.update(user).set({ platformRole: null }).where(eq(user.id, formerStaff.id));
    await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');

    expect(names(await listMentionable(ctx, client, { request: raised.id }))).toEqual(['wim']);
  });

  it('lists someone on the staff who is also in the company once, as the staff member they are', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const both = await staffActor(db, 'support', 'both@adiutor.test');
    await addMember(db, company.id, both.id, 'admin');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);

    expect(names(await listMentionable(ctx, support, { request: raised.id }))).toEqual([
      'both (staff)',
      'casey',
    ]);
    // To a colleague who hasn't seen them work on the request, they're a colleague.
    expect(names(await listMentionable(ctx, client, { request: raised.id }))).toEqual(['both']);
  });

  it('gives nobody for a deactivated company, where nothing is written', async () => {
    const company = await createCompany(db, { deactivated: true });
    await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');

    expect(await listMentionable(ctx, support, { company: company.id })).toEqual([]);
  });
});

describe('mentionKey', () => {
  it('is the same every time, and says nothing about who it stands for', async () => {
    const company = await createCompany(db);
    const userId = await createUser(db, 'casey@adiutor.test');

    const key = mentionKey(company.id, userId);

    expect(key).toHaveLength(MENTION_KEY_LENGTH);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(mentionKey(company.id, userId)).toBe(key);
    expect(key).not.toContain(userId.slice(0, 8));
  });

  it('differs per person and per company, so a key means nothing elsewhere', async () => {
    const company = await createCompany(db);
    const other = await createCompany(db);
    const casey = await createUser(db, 'casey@adiutor.test');
    const sam = await createUser(db, 'sam@adiutor.test');

    expect(mentionKey(company.id, casey)).not.toBe(mentionKey(company.id, sam));
    expect(mentionKey(company.id, casey)).not.toBe(mentionKey(other.id, casey));
  });

  it('is the key the list gives for that person', async () => {
    const company = await createCompany(db);
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support');

    const [listed] = await listMentionable(ctx, support, { company: company.id });

    expect(listed).toEqual({ key: mentionKey(company.id, casey.id), name: 'casey', staff: false });
  });
});

describe('a reply that mentions people', () => {
  it('stores who it mentions, and points its markers at those rows, without a name or a user ID', async () => {
    const company = await createCompany(db);
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const fenna = await staffActor(db, 'finance', 'fenna@adiutor.test');
    const raised = await storeRequest(company.id);

    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Can ${marker(company.id, casey.id, 'casey')} check this with ${marker(company.id, fenna.id, 'fenna')}? Thanks, ${marker(company.id, casey.id, 'casey')}.`,
    });

    const [reply] = await db.select().from(requestEntry);
    const mentions = await mentionsIn(raised.id);
    // Each person once, however often the text names them.
    expect(mentions).toMatchObject([
      { requestId: raised.id, entryId: reply?.id, userId: casey.id, side: 'company' },
      { requestId: raised.id, entryId: reply?.id, userId: fenna.id, side: 'staff' },
    ]);
    const [toCasey, toFenna] = mentions.map((mention) => storedMentionMarker(mention.id));
    expect(reply?.body).toBe(`Can ${toCasey} check this with ${toFenna}? Thanks, ${toCasey}.`);
    expect(reply?.body).not.toContain(casey.id);
    expect(reply?.body).not.toContain('casey');
  });

  it('leaves a text without mentions as it was written, and stores nothing', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    const raised = await storeRequest(company.id);

    await replyToRequest(ctx, client, { request: raised.id, body: 'Mail sam@adiutor.test.' });

    expect(await mentionsIn(raised.id)).toEqual([]);
    expect((await db.select().from(requestEntry))[0]?.body).toBe('Mail sam@adiutor.test.');
  });

  it('takes no marker for a mention that names nobody the writer may mention there', async () => {
    const company = await createCompany(db);
    const other = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const colleague = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const outsider = await memberActor(db, other.id, 'client', 'outsider@adiutor.test');
    const unseenStaff = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);
    const body = [
      // Someone at another company, with the key they'd have here and with their own.
      marker(company.id, outsider.id, 'outsider'),
      marker(other.id, outsider.id, 'outsider'),
      // A colleague's key from another company.
      marker(other.id, colleague.id, 'wim'),
      // A staff member the request doesn't show the company.
      marker(company.id, unseenStaff.id, 'sam'),
      // The writer themselves.
      marker(company.id, client.id, 'casey'),
      // A key nobody has, and a marker with what looks like a row's ID.
      writtenMentionMarker('nobody', 'A'.repeat(MENTION_KEY_LENGTH)),
      `[@typed](mention:${raised.id})`,
    ].join(' ');

    await replyToRequest(ctx, client, { request: raised.id, body });

    expect(await mentionsIn(raised.id)).toEqual([]);
    expect((await db.select().from(requestEntry))[0]?.body).toBe(body);
  });

  it('lets someone at the company mention a staff member once the request shows them', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);
    await replyToRequest(ctx, support, { request: raised.id, body: 'Which printer is it?' });

    await replyToRequest(ctx, client, {
      request: raised.id,
      body: `The one on the second floor, ${marker(company.id, support.id, 'sam')}.`,
    });

    expect(await mentionsIn(raised.id)).toMatchObject([{ userId: support.id, side: 'staff' }]);
  });

  it(`mentions the first ${MAX_MENTIONS_PER_TEXT} people of a text and leaves the rest as text`, async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const raised = await storeRequest(company.id);
    const members: string[] = [];
    for (let index = 0; index <= MAX_MENTIONS_PER_TEXT; index += 1) {
      // One after another: each needs its own row.
      // eslint-disable-next-line no-await-in-loop -- The members are made in order, on one connection.
      members.push((await memberActor(db, company.id, 'client')).id);
    }
    const last = marker(company.id, members[MAX_MENTIONS_PER_TEXT] ?? '', 'last');

    await replyToRequest(ctx, support, {
      request: raised.id,
      body: [
        ...members.slice(0, MAX_MENTIONS_PER_TEXT).map((id) => marker(company.id, id)),
        last,
      ].join(' '),
    });

    const mentions = await mentionsIn(raised.id);
    expect(mentions.map((mention) => mention.userId)).toEqual(
      members.slice(0, MAX_MENTIONS_PER_TEXT),
    );
    expect((await db.select().from(requestEntry))[0]?.body?.endsWith(` ${last}`)).toBe(true);
  });
});

describe('a new request that mentions people', () => {
  it('stores who its description mentions, under the request itself', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin', 'anna@adiutor.test');
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');

    const raised = await raiseRequest(ctx, admin, {
      companyId: company.id,
      title: 'The printer is broken',
      description: `${marker(company.id, casey.id, 'casey')} saw it first.`,
      type: 'bug',
    });

    const mentions = await mentionsIn(raised.id);
    expect(mentions).toMatchObject([
      { requestId: raised.id, entryId: null, userId: casey.id, side: 'company' },
    ]);
    const [stored] = await db.select().from(request).where(eq(request.id, raised.id));
    expect(stored?.description).toBe(`${storedMentionMarker(mentions[0]?.id ?? '')} saw it first.`);
  });
});

describe('reading a request with mentions', () => {
  it('gives each text the people it mentions, as the reader may see them', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const wim = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await raiseRequest(ctx, casey, {
      companyId: company.id,
      title: 'The printer is broken',
      description: `${marker(company.id, wim.id, 'wim')} saw it first.`,
      type: 'bug',
    });
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Thanks ${marker(company.id, casey.id, 'casey')} and ${marker(company.id, wim.id, 'wim')}.`,
    });
    const [inDescription, toCasey, toWim] = await mentionsIn(raised.id);

    const forStaff = await getRequest(ctx, support, raised.id);
    const forCasey = await getRequest(ctx, casey, raised.id);

    // The staff get the IDs their links to a user's page need.
    expect(forStaff.description.mentions).toEqual({
      [inDescription?.id ?? '']: {
        userId: wim.id,
        name: 'wim',
        side: 'company',
        isViewer: false,
        picture: null,
      },
    });
    // Someone at the company gets names, and whether it's them: never an ID.
    expect(forCasey.description.mentions).toEqual({
      [inDescription?.id ?? '']: {
        userId: null,
        name: 'wim',
        side: 'company',
        isViewer: false,
        picture: null,
      },
    });
    expect(forCasey.entries[0]?.body?.mentions).toEqual({
      [toCasey?.id ?? '']: {
        userId: null,
        name: 'casey',
        side: 'company',
        isViewer: true,
        picture: null,
      },
      [toWim?.id ?? '']: {
        userId: null,
        name: 'wim',
        side: 'company',
        isViewer: false,
        picture: null,
      },
    });
  });

  it('names someone as they’re called by now, and by their side once their account is gone', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const wim = await memberActor(db, company.id, 'watcher', 'wim@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const fenna = await staffActor(db, 'finance', 'fenna@adiutor.test');
    const raised = await storeRequest(company.id);
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `${marker(company.id, wim.id, 'wim')} ${marker(company.id, fenna.id, 'fenna')}`,
    });
    const [toWim, toFenna] = await mentionsIn(raised.id);

    await db.update(user).set({ name: 'Wim de Wit' }).where(eq(user.id, wim.id));
    await db.delete(user).where(eq(user.id, fenna.id));

    const detail = await getRequest(ctx, await actorFor(db, casey.id), raised.id);
    expect(detail.entries[0]?.body?.mentions).toEqual({
      [toWim?.id ?? '']: {
        userId: null,
        name: 'Wim de Wit',
        side: 'company',
        isViewer: false,
        picture: null,
      },
      // The mention stays, on the staff's side, without the name the account took with it.
      [toFenna?.id ?? '']: {
        userId: null,
        name: null,
        side: 'staff',
        isViewer: false,
        picture: null,
      },
    });
    expect((await mentionsIn(raised.id))[1]).toMatchObject({ userId: null, side: 'staff' });
  });

  it('gives a text no mentions of its own for a marker with another text’s row', async () => {
    await createStaffSettings(db);
    const company = await createCompany(db);
    const casey = await memberActor(db, company.id, 'client', 'casey@adiutor.test');
    const support = await staffActor(db, 'support', 'sam@adiutor.test');
    const raised = await storeRequest(company.id);
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Hello ${marker(company.id, casey.id, 'casey')}.`,
    });
    const [first] = await mentionsIn(raised.id);
    // Someone types the stored marker of the first reply into a second one.
    await replyToRequest(ctx, support, {
      request: raised.id,
      body: `Copied: ${storedMentionMarker(first?.id ?? '')}`,
    });

    const detail = await getRequest(ctx, support, raised.id);

    expect(Object.keys(detail.entries[0]?.body?.mentions ?? {})).toEqual([first?.id]);
    expect(detail.entries[1]?.body?.mentions).toBeUndefined();
  });
});
