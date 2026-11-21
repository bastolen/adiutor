/**
 * @file Integration tests for the board of requests: who sees which cards,
 * the list's filters and sort on the lanes, priorities for the staff only,
 * the lanes each card may move to per role, the open lanes' size and every
 * lane's true count, the closed lanes' latest ten, and a deactivated
 * company's requests. Which roles may load the board is in the
 * authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { request } from '@/db/schema';
import { defined } from '@/lib/defined';
import type { RequestStatus } from '@/lib/requests';

import {
  createCompany,
  inSequence,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { type BoardLane, listBoard } from './board';
import { ctx, db, storeAssignees, storeRequest } from './test-helpers';

/**
 * One lane of a board.
 *
 * @param board - The board.
 * @param board.lanes - Its lanes.
 * @param status - The lane's status.
 * @returns The lane.
 */
const lane = ({ lanes }: { lanes: BoardLane[] }, status: RequestStatus) =>
  defined(
    lanes.find((each) => each.status === status),
    `the ${status} lane`,
  );

/**
 * The titles of a lane's cards, in order.
 *
 * @param board - The board.
 * @param board.lanes - Its lanes.
 * @param status - The lane's status.
 * @returns The titles.
 */
const titlesIn = (board: { lanes: BoardLane[] }, status: RequestStatus) =>
  lane(board, status).items.map(({ title }) => title);

/**
 * Every card's title on a board, sorted, whatever its lane.
 *
 * @param board - The board.
 * @param board.lanes - Its lanes.
 * @returns The titles.
 */
const allTitles = ({ lanes }: { lanes: BoardLane[] }) =>
  lanes.flatMap(({ items }) => items.map(({ title }) => title)).sort();

/**
 * Sets when a request last had activity, to tell the order of a lane.
 *
 * @param id - The request.
 * @param minutesAgo - How long ago, in minutes.
 */
async function setActivity(id: string, minutesAgo: number): Promise<void> {
  await db
    .update(request)
    .set({ lastActivityAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(request.id, id));
}

describe('listBoard: who sees what', () => {
  it('has a lane per status, in the order a request moves through them', async () => {
    const support = await staffActor(db, 'support');

    const board = await listBoard(ctx, support);

    expect(board.lanes.map(({ status }) => status)).toEqual([
      'open',
      'todo',
      'in_progress',
      'waiting',
      'proposed',
      'done',
      'cancelled',
    ]);
    expect(board.lanes.every(({ total, items }) => total === 0 && items.length === 0)).toBe(true);
    expect(board.size).toBe(25);
  });

  it('shows a company’s members its requests only, and the staff every company’s', async () => {
    const [alpha, beta] = [await createCompany(db), await createCompany(db)];
    await storeRequest(alpha.id, { title: 'Alpha’s request' });
    await storeRequest(beta.id, { title: 'Beta’s request', status: 'in_progress' });
    const [client, watcher, finance] = [
      await memberActor(db, alpha.id, 'client'),
      await memberActor(db, alpha.id, 'watcher'),
      await staffActor(db, 'finance'),
    ];

    expect(allTitles(await listBoard(ctx, client))).toEqual(['Alpha’s request']);
    expect(allTitles(await listBoard(ctx, watcher))).toEqual(['Alpha’s request']);
    const forStaff = await listBoard(ctx, finance);
    expect(titlesIn(forStaff, 'open')).toEqual(['Alpha’s request']);
    expect(titlesIn(forStaff, 'in_progress')).toEqual(['Beta’s request']);
    // Another company's lanes aren't even counted for its members.
    expect(lane(await listBoard(ctx, client), 'in_progress').total).toBe(0);
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

    const forStaff = await listBoard(ctx, finance, { sort: 'priority' });
    expect(lane(forStaff, 'open').items.map(({ title, priority }) => [title, priority])).toEqual([
      ['High', 'high'],
      ['Normal', 'normal'],
      ['Low', 'low'],
    ]);
    expect(titlesIn(await listBoard(ctx, finance, { priority: 'high' }), 'open')).toEqual(['High']);

    // A company user gets no priority, and asking for one changes nothing: the newest first.
    const forClient = await listBoard(ctx, client, { sort: 'priority', priority: 'high' });
    expect(lane(forClient, 'open').items.map(({ title, priority }) => [title, priority])).toEqual([
      ['Normal', null],
      ['High', null],
      ['Low', null],
    ]);
  });
});

describe('listBoard: filters and sort', () => {
  it('narrows every lane down by a search, a company and a type', async () => {
    const [alpha, beta] = [
      await createCompany(db, { slug: 'adiutor-tests-alpha' }),
      await createCompany(db),
    ];
    await storeRequest(alpha.id, { title: 'The printer is broken', type: 'bug' });
    await storeRequest(alpha.id, { title: 'A new printer', type: 'hotfix', status: 'done' });
    await storeRequest(alpha.id, { title: 'Access for a colleague', type: 'bug' });
    await storeRequest(beta.id, { title: 'Beta’s printer', type: 'bug', status: 'todo' });
    const support = await staffActor(db, 'support');

    expect(allTitles(await listBoard(ctx, support, { search: 'printer' }))).toEqual([
      'A new printer',
      'Beta’s printer',
      'The printer is broken',
    ]);
    expect(allTitles(await listBoard(ctx, support, { company: 'adiutor-tests-alpha' }))).toEqual([
      'A new printer',
      'Access for a colleague',
      'The printer is broken',
    ]);
    expect(allTitles(await listBoard(ctx, support, { type: 'hotfix' }))).toEqual(['A new printer']);
    // The totals count what the filters leave, too.
    expect(lane(await listBoard(ctx, support, { search: 'printer' }), 'open').total).toBe(1);
  });

  it('filters by assignee for the staff, and ignores it for the company', async () => {
    const company = await createCompany(db);
    const [support, client] = [
      await staffActor(db, 'support'),
      await memberActor(db, company.id, 'client'),
    ];
    const mine = await storeRequest(company.id, { title: 'Mine' });
    await storeRequest(company.id, { title: 'Nobody’s' });
    await storeAssignees(mine.id, [support.id]);

    const forStaff = await listBoard(ctx, support, { assignee: 'me' });
    expect(titlesIn(forStaff, 'open')).toEqual(['Mine']);
    expect(lane(forStaff, 'open').items[0]?.assignees.map(({ name }) => name)).toHaveLength(1);
    expect(titlesIn(await listBoard(ctx, support, { assignee: 'none' }), 'open')).toEqual([
      'Nobody’s',
    ]);
    expect(lane(await listBoard(ctx, client, { assignee: 'none' }), 'open').total).toBe(2);
  });

  it('reports a company someone may not see as not found', async () => {
    const [own, other] = [await createCompany(db), await createCompany(db)];
    const client = await memberActor(db, own.id, 'client');

    await expect(listBoard(ctx, client, { company: other.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('sorts the open lanes as the list is sorted, and the closed ones newest first', async () => {
    const company = await createCompany(db);
    const [first, second, third] = await inSequence(['First', 'Second', 'Third'], (title) =>
      storeRequest(company.id, { title, status: 'in_progress' }),
    );
    const [doneEarlier, doneLater] = await inSequence(['Done earlier', 'Done later'], (title) =>
      storeRequest(company.id, { title, status: 'done' }),
    );
    await setActivity(defined(first, 'a stored request').id, 1);
    await setActivity(defined(second, 'a stored request').id, 3);
    await setActivity(defined(third, 'a stored request').id, 2);
    await setActivity(defined(doneEarlier, 'a stored request').id, 20);
    await setActivity(defined(doneLater, 'a stored request').id, 10);
    const support = await staffActor(db, 'support');

    const byActivity = await listBoard(ctx, support);
    expect(titlesIn(byActivity, 'in_progress')).toEqual(['First', 'Third', 'Second']);
    const byRaised = await listBoard(ctx, support, { sort: 'raised', dir: 'asc' });
    expect(titlesIn(byRaised, 'in_progress')).toEqual(['First', 'Second', 'Third']);
    // Closing a request is activity: the closed lanes show the latest, whatever the sort.
    expect(titlesIn(byRaised, 'done')).toEqual(['Done later', 'Done earlier']);
  });
});

describe('listBoard: how many cards a lane shows', () => {
  it('shows up to the chosen size in an open lane, and counts them all', async () => {
    const company = await createCompany(db);
    await inSequence(
      Array.from({ length: 27 }, (_, index) => index),
      (index) => storeRequest(company.id, { title: `Open ${index}` }),
    );
    await storeRequest(company.id, { title: 'To do', status: 'todo' });
    const support = await staffActor(db, 'support');

    const board = await listBoard(ctx, support);
    expect(lane(board, 'open').items).toHaveLength(25);
    expect(lane(board, 'open').total).toBe(27);
    expect(lane(board, 'todo').total).toBe(1);

    const larger = await listBoard(ctx, support, { size: 50 });
    expect(larger.size).toBe(50);
    expect(lane(larger, 'open').items).toHaveLength(27);
  });

  it('shows the latest ten in Done and Cancelled, newest first, and counts them all', async () => {
    const company = await createCompany(db);
    const done = await inSequence(
      Array.from({ length: 12 }, (_, index) => index),
      (index) => storeRequest(company.id, { title: `Done ${index}`, status: 'done' }),
    );
    // Done 0 had activity last, Done 11 first.
    await inSequence(
      done.map((stored, index) => ({ id: stored.id, minutesAgo: index + 1 })),
      ({ id, minutesAgo }) => setActivity(id, minutesAgo),
    );
    await storeRequest(company.id, { title: 'Cancelled', status: 'cancelled' });
    const support = await staffActor(db, 'support');

    const board = await listBoard(ctx, support, { size: 100 });
    expect(titlesIn(board, 'done')).toEqual(
      Array.from({ length: 10 }, (_, index) => `Done ${index}`),
    );
    expect(lane(board, 'done').total).toBe(12);
    expect(titlesIn(board, 'cancelled')).toEqual(['Cancelled']);
  });
});

describe('listBoard: where each card may move', () => {
  it('lets the staff who work on requests move a card anywhere but Waiting for approval', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { status: 'in_progress' });
    const support = await staffActor(db, 'support');

    const card = lane(await listBoard(ctx, support), 'in_progress').items[0];

    expect(card?.moves).toEqual(['open', 'todo', 'waiting', 'done', 'cancelled']);
  });

  it('lets a Client close a card, or reopen a closed one, and approve on the request', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { title: 'Active', status: 'in_progress' });
    await storeRequest(company.id, { title: 'Proposed', status: 'proposed' });
    await storeRequest(company.id, { title: 'Done', status: 'done' });
    const client = await memberActor(db, company.id, 'client');

    const board = await listBoard(ctx, client);

    expect(lane(board, 'in_progress').items[0]?.moves).toEqual(['done', 'cancelled']);
    // A solution is approved on the request, not by moving its card to Done.
    expect(lane(board, 'proposed').items[0]?.moves).toEqual(['cancelled']);
    expect(lane(board, 'done').items[0]?.moves).toEqual(['open']);
  });

  it('lets a Watcher and Finance move nothing', async () => {
    const company = await createCompany(db);
    await storeRequest(company.id, { status: 'in_progress' });
    await storeRequest(company.id, { status: 'done' });
    const [watcher, finance] = [
      await memberActor(db, company.id, 'watcher'),
      await staffActor(db, 'finance'),
    ];

    await inSequence([watcher, finance], async (reader) => {
      const board = await listBoard(ctx, reader);
      expect(board.lanes.flatMap(({ items }) => items.flatMap(({ moves }) => moves))).toEqual([]);
      expect(lane(board, 'in_progress').total).toBe(1);
    });
  });

  it('leaves a deactivated company’s cards where they are, also for the staff', async () => {
    const closed = await createCompany(db, { deactivated: true });
    await storeRequest(closed.id, { title: 'Open', status: 'open' });
    await storeRequest(closed.id, { title: 'Done', status: 'done' });
    const manager = await staffActor(db, 'manager');

    const board = await listBoard(ctx, manager, { company: closed.id });

    expect(lane(board, 'open').items.map(({ moves }) => moves)).toEqual([[]]);
    expect(lane(board, 'done').items.map(({ moves }) => moves)).toEqual([[]]);
  });
});

describe('listBoard: a deactivated company', () => {
  it('leaves its requests out of the open lanes across companies, and keeps them closed', async () => {
    const [active, closed] = [
      await createCompany(db),
      await createCompany(db, { deactivated: true }),
    ];
    await storeRequest(active.id, { title: 'Active company' });
    await storeRequest(closed.id, { title: 'Closed company, open' });
    await storeRequest(closed.id, { title: 'Closed company, waiting', status: 'waiting' });
    await storeRequest(closed.id, { title: 'Closed company, done', status: 'done' });
    const manager = await staffActor(db, 'manager');

    const board = await listBoard(ctx, manager);
    expect(titlesIn(board, 'open')).toEqual(['Active company']);
    expect(lane(board, 'open').total).toBe(1);
    expect(lane(board, 'waiting').total).toBe(0);
    expect(titlesIn(board, 'done')).toEqual(['Closed company, done']);

    // The company's own board shows them as they are.
    const own = await listBoard(ctx, manager, { company: closed.id });
    expect(allTitles(own)).toEqual([
      'Closed company, done',
      'Closed company, open',
      'Closed company, waiting',
    ]);
  });
});
