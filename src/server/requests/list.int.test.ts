/**
 * @file Integration tests for listing requests and the companies they're in.
 * Which roles may list what is in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { company as companyTable, user } from '@/db/schema';

import {
  actorFor,
  addMember,
  createCompany,
  createUser,
  inSequence,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { getRequest } from './detail';
import { listRequestCompanies, listRequests } from './list';
import {
  ctx,
  db,
  storeAssignees,
  storeRequest,
  REQUEST_READERS,
  requestReader,
  setActivity,
} from './test-helpers';

/**
 * The titles of a page of requests, in order.
 *
 * @param page - The page.
 * @param page.items - Its requests.
 * @returns The titles.
 */
const titles = ({ items }: { items: { title: string }[] }) => items.map(({ title }) => title);

describe('listRequests: who sees what', () => {
  it('shows a company’s members its requests only, and the staff every company’s', async () => {
    const [alpha, beta] = [
      await createCompany(db, { name: 'Adiutor Tests Alpha' }),
      await createCompany(db, { name: 'Adiutor Tests Beta' }),
    ];
    await storeRequest(alpha.id, { title: 'Alpha’s request' });
    await storeRequest(beta.id, { title: 'Beta’s request' });

    const [client, watcher, support, finance] = [
      await memberActor(db, alpha.id, 'client'),
      await memberActor(db, alpha.id, 'watcher'),
      await staffActor(db, 'support'),
      await staffActor(db, 'finance'),
    ];

    expect(titles(await listRequests(ctx, client))).toEqual(['Alpha’s request']);
    expect(titles(await listRequests(ctx, watcher))).toEqual(['Alpha’s request']);
    expect(titles(await listRequests(ctx, support)).sort()).toEqual([
      'Alpha’s request',
      'Beta’s request',
    ]);
    expect((await listRequests(ctx, finance)).total).toBe(2);
  });

  it('shows someone in several companies the requests of each', async () => {
    const [alpha, beta, gamma] = [
      await createCompany(db),
      await createCompany(db),
      await createCompany(db),
    ];
    await inSequence([alpha, beta, gamma], ({ id }) => storeRequest(id));
    const userId = await createUser(db, 'multi@adiutor.test');
    await addMember(db, alpha.id, userId, 'watcher');
    await addMember(db, beta.id, userId, 'admin');

    const page = await listRequests(ctx, await actorFor(db, userId));

    expect(page.items.map(({ company }) => company?.id).sort()).toEqual([alpha.id, beta.id].sort());
  });

  it('shows nothing to someone in no company, or whose company is deactivated', async () => {
    const [active, closed] = [await createCompany(db), await createCompany(db)];
    await storeRequest(active.id);
    await storeRequest(closed.id);
    const admin = await memberActor(db, closed.id, 'admin');
    // The company closes after its Admin signed in: the actor still lists it as theirs.
    await db
      .update(companyTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(companyTable.id, closed.id));
    const nobody = await actorFor(db, await createUser(db, 'drifter@adiutor.test'));

    expect((await listRequests(ctx, admin, { status: 'all' })).total).toBe(0);
    expect((await listRequests(ctx, nobody, { status: 'all' })).total).toBe(0);
  });

  it('gives the priority to the staff only, to read, filter and sort by', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { title: 'Low', priority: 'low' });
    await storeRequest(company.id, { title: 'High', priority: 'high' });
    await storeRequest(company.id, { title: 'Normal', priority: 'normal' });
    const [client, finance] = [
      await memberActor(db, company.id, 'client'),
      await staffActor(db, 'finance'),
    ];

    const forStaff = await listRequests(ctx, finance, { sort: 'priority' });
    expect(forStaff.items.map(({ title, priority }) => [title, priority])).toEqual([
      ['High', 'high'],
      ['Normal', 'normal'],
      ['Low', 'low'],
    ]);
    expect(titles(await listRequests(ctx, finance, { sort: 'priority', dir: 'asc' }))).toEqual([
      'Low',
      'Normal',
      'High',
    ]);
    expect(titles(await listRequests(ctx, finance, { priority: 'high' }))).toEqual(['High']);

    // A company user gets no priority, and asking for one changes nothing.
    const forClient = await listRequests(ctx, client, { sort: 'priority', priority: 'high' });
    expect(forClient.items.map(({ title, priority }) => [title, priority])).toEqual([
      ['Normal', null],
      ['High', null],
      ['Low', null],
    ]);
  });
});

describe('listRequests: filters and search', () => {
  it('shows what is still worked on unless asked for something else', async () => {
    const company = await createCompany(db);
    await inSequence(
      ['open', 'todo', 'in_progress', 'waiting', 'done', 'cancelled'] as const,
      (status) => storeRequest(company.id, { title: status, status }),
    );
    const support = await staffActor(db, 'support');
    /**
     * The statuses a status filter shows, sorted.
     *
     * @param status - The filter, as an address would name it.
     * @returns The statuses.
     */
    const shown = async (status?: string) =>
      titles(await listRequests(ctx, support, { status })).sort();

    expect(await shown()).toEqual(['in_progress', 'open', 'todo', 'waiting']);
    expect(await shown('active')).toEqual(['in_progress', 'open', 'todo', 'waiting']);
    expect(await shown('waiting')).toEqual(['waiting']);
    expect(await shown('closed')).toEqual(['cancelled', 'done']);
    expect(await shown('all')).toHaveLength(6);
    expect(await shown('nonsense')).toEqual(['in_progress', 'open', 'todo', 'waiting']);
  });

  it('shows one status instead of a group when asked, and ignores one that isn’t a status', async () => {
    const company = await createCompany(db);
    await inSequence(['waiting', 'proposed', 'done', 'cancelled'] as const, (status) =>
      storeRequest(company.id, { title: status, status }),
    );
    const support = await staffActor(db, 'support');

    // The Waiting link's group holds both waiting statuses; one status is just that one.
    expect(titles(await listRequests(ctx, support, { status: 'waiting' })).sort()).toEqual([
      'proposed',
      'waiting',
    ]);
    expect(titles(await listRequests(ctx, support, { only: 'waiting' }))).toEqual(['waiting']);
    expect(titles(await listRequests(ctx, support, { status: 'all', only: 'done' }))).toEqual([
      'done',
    ]);
    expect(
      titles(await listRequests(ctx, support, { status: 'closed', only: 'bogus' })).sort(),
    ).toEqual(['cancelled', 'done']);
  });

  it('leaves a deactivated company’s requests out of what is still worked on, across companies', async () => {
    const [active, closed] = [
      await createCompany(db),
      await createCompany(db, { deactivated: true, slug: 'adiutor-tests-closed' }),
    ];
    await storeRequest(active.id, { title: 'Active company' });
    await storeRequest(closed.id, { title: 'Closed company, open' });
    await storeRequest(closed.id, { title: 'Closed company, waiting', status: 'waiting' });
    await storeRequest(closed.id, { title: 'Closed company, done', status: 'done' });
    const manager = await staffActor(db, 'manager');

    expect(titles(await listRequests(ctx, manager))).toEqual(['Active company']);
    expect(titles(await listRequests(ctx, manager, { status: 'waiting' }))).toEqual([]);
    expect(titles(await listRequests(ctx, manager, { status: 'closed' }))).toEqual([
      'Closed company, done',
    ]);
    expect((await listRequests(ctx, manager, { status: 'all' })).total).toBe(4);
    // The company's own list shows them as they are.
    expect(
      titles(await listRequests(ctx, manager, { company: 'adiutor-tests-closed' })).sort(),
    ).toEqual(['Closed company, open', 'Closed company, waiting']);
  });

  it('shows one company’s requests, by its ID or URL name', async () => {
    const [alpha, beta] = [
      await createCompany(db, { slug: 'adiutor-tests-alpha' }),
      await createCompany(db),
    ];
    await storeRequest(alpha.id, { title: 'Alpha’s request' });
    await storeRequest(beta.id, { title: 'Beta’s request' });
    const support = await staffActor(db, 'support');

    expect(titles(await listRequests(ctx, support, { company: alpha.id }))).toEqual([
      'Alpha’s request',
    ]);
    expect(titles(await listRequests(ctx, support, { company: 'adiutor-tests-alpha' }))).toEqual([
      'Alpha’s request',
    ]);
  });

  it('reports a company someone may not see as not found', async () => {
    const [own, other] = [await createCompany(db), await createCompany(db)];
    const client = await memberActor(db, own.id, 'client');

    await expect(listRequests(ctx, client, { company: other.id })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(listRequests(ctx, client, { company: 'no-such-company' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('shows one type, and every type for a type that does not exist', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { title: 'A bug', type: 'bug' });
    await storeRequest(company.id, { title: 'A hotfix', type: 'hotfix' });
    const client = await memberActor(db, company.id, 'client');

    expect(titles(await listRequests(ctx, client, { type: 'hotfix' }))).toEqual(['A hotfix']);
    expect((await listRequests(ctx, client, { type: 'question' })).total).toBe(2);
  });

  it('shows the staff the requests someone is assigned to, or nobody is', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const mine = await storeRequest(company.id, { title: 'Mine' });
    const shared = await storeRequest(company.id, { title: 'Shared' });
    const theirs = await storeRequest(company.id, { title: 'Theirs' });
    await storeRequest(company.id, { title: 'Nobody' });
    await storeAssignees(mine.id, [support.id]);
    await storeAssignees(shared.id, [support.id, manager.id]);
    await storeAssignees(theirs.id, [manager.id]);

    /**
     * The titles Sam's list shows for an assignee filter, oldest first.
     *
     * @param assignee - The filter.
     * @returns The titles.
     */
    const list = async (assignee: string) =>
      titles(await listRequests(ctx, support, { assignee, sort: 'raised', dir: 'asc' }));
    expect(await list('me')).toEqual(['Mine', 'Shared']);
    expect(await list(manager.id)).toEqual(['Shared', 'Theirs']);
    expect(await list('none')).toEqual(['Nobody']);
    expect(await list('someone')).toEqual(['Mine', 'Shared', 'Theirs', 'Nobody']);
  });

  it('ignores the assignee filter for the company', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const client = await memberActor(db, company.id, 'client');
    const assigned = await storeRequest(company.id, { title: 'Assigned' });
    await storeRequest(company.id, { title: 'Nobody' });
    await storeAssignees(assigned.id, [support.id]);

    expect((await listRequests(ctx, client, { assignee: 'none' })).total).toBe(2);
    expect((await listRequests(ctx, client, { assignee: support.id })).total).toBe(2);
  });

  it('searches titles, ignoring case and taking % and _ literally', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { title: 'The Printer is broken' });
    await storeRequest(company.id, { title: '100% of invoices fail' });
    await storeRequest(company.id, { title: 'New colleague needs access' });
    const client = await memberActor(db, company.id, 'client');

    expect(titles(await listRequests(ctx, client, { search: ' printer ' }))).toEqual([
      'The Printer is broken',
    ]);
    expect(titles(await listRequests(ctx, client, { search: '0%' }))).toEqual([
      '100% of invoices fail',
    ]);
    expect((await listRequests(ctx, client, { search: '_' })).total).toBe(0);
  });

  it('finds a request by its number, with any prefix or none', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { title: 'First' });
    await storeRequest(company.id, { title: 'Second' });
    // A title with the same digits is found as well.
    await storeRequest(company.id, { title: 'Room 2 is cold' });
    const client = await memberActor(db, company.id, 'client');

    await inSequence(['2', '#2', 'AD-2', 'req-2'], async (search) => {
      expect(titles(await listRequests(ctx, client, { search })).sort(), search).toEqual(
        search === '2' ? ['Room 2 is cold', 'Second'] : ['Second'],
      );
    });
  });

  it('finds every request whose number starts with the digits typed', async () => {
    const company = await createCompany(db);
    await inSequence(
      Array.from({ length: 12 }, (_, index) => index + 1),
      (number) =>
        storeRequest(company.id, { title: `Request ${String.fromCharCode(64 + number)}` }),
    );
    const client = await memberActor(db, company.id, 'client');

    /**
     * The numbers of the requests a search finds, lowest first.
     *
     * @param search - The search term.
     * @returns The numbers.
     */
    const found = async (search: string) =>
      (await listRequests(ctx, client, { search, sort: 'raised', dir: 'asc' })).items.map(
        ({ number }) => number,
      );

    // With a prefix, with "#" and without: the same requests.
    await inSequence(['AD-1', 'ad 1', '#1', '1', 'OLD-1'], async (search) => {
      expect(await found(search), search).toEqual([1, 10, 11, 12]);
    });
    expect(await found('AD-11')).toEqual([11]);
    // What a number starts with, not what it holds or ends with.
    expect(await found('AD-2')).toEqual([2]);
    expect(await found('AD-13')).toEqual([]);
  });

  it('never finds another company’s request by its number', async () => {
    const [own, other] = [await createCompany(db), await createCompany(db)];
    await storeRequest(other.id);
    const client = await memberActor(db, own.id, 'client');

    expect((await listRequests(ctx, client, { search: 'AD-1', status: 'all' })).total).toBe(0);
  });
});

describe('listRequests: order and pages', () => {
  it('puts the request with the latest activity first, or the one raised last', async () => {
    const company = await createCompany(db);
    const first = await storeRequest(company.id, { title: 'First' });
    const second = await storeRequest(company.id, { title: 'Second' });
    const third = await storeRequest(company.id, { title: 'Third' });
    await setActivity(first.id, 1);
    await setActivity(second.id, 30);
    await setActivity(third.id, 10);
    const client = await memberActor(db, company.id, 'client');

    expect(titles(await listRequests(ctx, client))).toEqual(['First', 'Third', 'Second']);
    expect(titles(await listRequests(ctx, client, { dir: 'asc' }))).toEqual([
      'Second',
      'Third',
      'First',
    ]);
    expect(titles(await listRequests(ctx, client, { sort: 'raised' }))).toEqual([
      'Third',
      'Second',
      'First',
    ]);
  });

  it('returns one page at a time, and the last page for a page past the end', async () => {
    const company = await createCompany(db);
    await inSequence(
      Array.from({ length: 30 }, (_, index) => index + 1),
      (n) => storeRequest(company.id, { title: `Request ${n}` }),
    );
    const client = await memberActor(db, company.id, 'client');

    const first = await listRequests(ctx, client, { sort: 'raised', dir: 'asc' });
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    const past = await listRequests(ctx, client, { sort: 'raised', dir: 'asc', page: 9 });
    expect(past).toMatchObject({ total: 30, page: 2 });
    expect(titles(past)).toEqual([
      'Request 26',
      'Request 27',
      'Request 28',
      'Request 29',
      'Request 30',
    ]);
  });
});

describe('listRequests: what a request shows', () => {
  it('says when a request was reopened', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { title: 'Reopened', reopenedAt: new Date() });
    await storeRequest(company.id, { title: 'Never closed' });
    const client = await memberActor(db, company.id, 'client');

    const page = await listRequests(ctx, client, { sort: 'raised', dir: 'asc' });

    expect(page.items.map(({ title, reopened }) => [title, reopened])).toEqual([
      ['Reopened', true],
      ['Never closed', false],
    ]);
  });

  it.each(REQUEST_READERS)(
    'tells %s how they are addressed about a waiting request, as its own page does',
    async (_who, companyRole, staffRole, audience) => {
      const company = await createCompany(db);
      await storeRequest(company.id, { status: 'waiting' });
      const reader = await requestReader(company.id, companyRole, staffRole);

      const page = await listRequests(ctx, reader, { status: 'waiting' });

      expect(page.items.map((item) => item.audience)).toEqual([audience]);
      expect((await getRequest(ctx, reader, '1')).audience).toBe(audience);
    },
  );

  it('names who each request is assigned to, by name, with their IDs for the staff only', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const manager = await staffActor(db, 'manager');
    const client = await memberActor(db, company.id, 'client');
    await db.update(user).set({ name: 'Sam Support' }).where(eq(user.id, support.id));
    await db.update(user).set({ name: 'Morgan Manager' }).where(eq(user.id, manager.id));
    const assigned = await storeRequest(company.id, { title: 'Assigned' });
    await storeRequest(company.id, { title: 'Nobody' });
    await storeAssignees(assigned.id, [support.id, manager.id]);

    /**
     * Who each request is assigned to, as a reader's list gives it, oldest first.
     *
     * @param reader - Whoever reads the list.
     * @returns Each request's assignees, with their IDs and names.
     */
    const assigneesFor = async (reader: Actor) =>
      (await listRequests(ctx, reader, { sort: 'raised', dir: 'asc' })).items.map(({ assignees }) =>
        assignees.map(({ userId, name }) => ({ userId, name })),
      );
    expect(await assigneesFor(support)).toEqual([
      [
        { userId: manager.id, name: 'Morgan Manager' },
        { userId: support.id, name: 'Sam Support' },
      ],
      [],
    ]);
    expect(await assigneesFor(client)).toEqual([
      [
        { userId: null, name: 'Morgan Manager' },
        { userId: null, name: 'Sam Support' },
      ],
      [],
    ]);
  });

  it('addresses someone per company: taking part in one, following in another', async () => {
    const [alpha, beta] = [await createCompany(db), await createCompany(db)];
    await storeRequest(alpha.id, { title: 'Where they are a Client', status: 'waiting' });
    await storeRequest(beta.id, { title: 'Where they are a Watcher', status: 'waiting' });
    const member = await memberActor(db, alpha.id, 'client');
    await addMember(db, beta.id, member.id, 'watcher');

    const page = await listRequests(ctx, await actorFor(db, member.id), {
      status: 'waiting',
      sort: 'raised',
      dir: 'asc',
    });

    expect(page.items.map((item) => [item.title, item.audience])).toEqual([
      ['Where they are a Client', 'contributor'],
      ['Where they are a Watcher', 'follower'],
    ]);
  });

  it('addresses the staff as the staff about a deactivated company’s request', async () => {
    const company = await createCompany(db, { deactivated: true });
    await storeRequest(company.id, { status: 'waiting' });

    const page = await listRequests(ctx, await staffActor(db, 'support'), { status: 'all' });

    expect(page.items.map((item) => item.audience)).toEqual(['staff']);
    // The company's own row stays what a list gives: nothing about its deactivation.
    expect(Object.keys(page.items[0]?.company ?? {}).sort()).toEqual(['id', 'name', 'slug']);
  });
});

describe('listRequestCompanies', () => {
  it('lists every company for the staff, by name, and where they may raise a request', async () => {
    const alpha = await createCompany(db, { name: 'adiutor Tests Alpha' });
    const beta = await createCompany(db, { name: 'Adiutor Tests Beta' });
    const closed = await createCompany(db, { name: 'Adiutor Tests Closed', deactivated: true });
    const [support, finance] = [await staffActor(db, 'support'), await staffActor(db, 'finance')];

    expect(await listRequestCompanies(ctx, support)).toEqual([
      { id: alpha.id, name: alpha.name, slug: alpha.slug, canRaise: true },
      { id: beta.id, name: beta.name, slug: beta.slug, canRaise: true },
      { id: closed.id, name: closed.name, slug: closed.slug, canRaise: false },
    ]);
    // Finance reads requests, and raises none.
    expect((await listRequestCompanies(ctx, finance)).map(({ canRaise }) => canRaise)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('lists the active companies of everyone else, and where their role lets them raise a request', async () => {
    const [alpha, beta, closed] = [
      await createCompany(db, { name: 'Adiutor Tests Alpha' }),
      await createCompany(db, { name: 'Adiutor Tests Beta' }),
      await createCompany(db, { name: 'Adiutor Tests Closed', deactivated: true }),
    ];
    await createCompany(db, { name: 'Adiutor Tests Other' });
    const userId = await createUser(db, 'multi@adiutor.test');
    await addMember(db, alpha.id, userId, 'watcher');
    await addMember(db, beta.id, userId, 'client');
    await addMember(db, closed.id, userId, 'admin');

    const companies = await listRequestCompanies(ctx, await actorFor(db, userId));

    expect(companies.map(({ name, canRaise }) => [name, canRaise])).toEqual([
      ['Adiutor Tests Alpha', false],
      ['Adiutor Tests Beta', true],
    ]);
    expect(
      await listRequestCompanies(
        ctx,
        await actorFor(db, await createUser(db, 'drifter@adiutor.test')),
      ),
    ).toEqual([]);
  });

  it('lets Finance raise a request where they are a Client themselves', async () => {
    const [own, other] = [
      await createCompany(db, { name: 'Adiutor Tests Alpha' }),
      await createCompany(db, { name: 'Adiutor Tests Beta' }),
    ];
    const finance = await staffActor(db, 'finance');
    await addMember(db, own.id, finance.id, 'client');

    const companies = await listRequestCompanies(ctx, await actorFor(db, finance.id));

    expect(companies.map(({ id, canRaise }) => [id, canRaise])).toEqual([
      [own.id, true],
      [other.id, false],
    ]);
  });
});
