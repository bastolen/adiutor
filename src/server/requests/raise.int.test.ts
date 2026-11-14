/**
 * @file Integration tests for raising a request. Which roles may raise one is
 * in the authorization matrix.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { membership, request, requestCounter } from '@/db/schema';

import {
  createCompany,
  fillRateLimitBucket,
  inSequence,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import raiseRequest from './raise';
import { ctx, db } from './test-helpers';

/** A request as a form sends it, without its company. */
const INPUT = {
  title: 'The printer is broken',
  description: 'It prints blank pages.',
  type: 'bug',
} as const;

/**
 * Loads a request as it's stored.
 *
 * @param id - The request's ID.
 * @returns The row.
 */
async function stored(id: string) {
  const [found] = await db.select().from(request).where(eq(request.id, id));
  return found;
}

describe('raiseRequest', () => {
  it('stores what was asked, by whom and from which side, open and with its type’s priority', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    const raised = await raiseRequest(ctx, client, { ...INPUT, companyId: company.id });

    expect(raised.number).toBe(1);
    expect(await stored(raised.id)).toMatchObject({
      number: 1,
      companyId: company.id,
      title: 'The printer is broken',
      description: 'It prints blank pages.',
      descriptionFormat: 'plain',
      type: 'bug',
      priority: 'normal',
      status: 'open',
      reopenedAt: null,
      createdBy: client.id,
      createdBySide: 'company',
    });
  });

  it('takes the company by its URL name too', async () => {
    const company = await createCompany(db, { slug: 'adiutor-tests-raise' });
    const client = await memberActor(db, company.id, 'client');

    const raised = await raiseRequest(ctx, client, { ...INPUT, companyId: 'adiutor-tests-raise' });

    expect(await stored(raised.id)).toMatchObject({ companyId: company.id });
  });

  it.each([
    ['hotfix', 'high'],
    ['bug', 'normal'],
    ['support', 'normal'],
    ['new_feature', 'low'],
  ])('gives a %s the priority %s', async (type, priority) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    const raised = await raiseRequest(ctx, client, { ...INPUT, type, companyId: company.id });

    expect(await stored(raised.id)).toMatchObject({ type, priority });
  });

  it('ignores a priority from the company: the type decides', async () => {
    const company = await createCompany(db);
    const admin = await memberActor(db, company.id, 'admin');

    const raised = await raiseRequest(ctx, admin, {
      ...INPUT,
      type: 'new_feature',
      priority: 'high',
      companyId: company.id,
    });

    expect(await stored(raised.id)).toMatchObject({ priority: 'low' });
  });

  it('lets the staff choose the priority, or leave it to the type, and notes their side', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const input = { ...INPUT, type: 'new_feature', companyId: company.id };

    const chosen = await raiseRequest(ctx, support, { ...input, priority: 'high' });
    const left = await raiseRequest(ctx, support, { ...input, priority: '' });

    expect(await stored(chosen.id)).toMatchObject({ priority: 'high', createdBySide: 'staff' });
    expect(await stored(left.id)).toMatchObject({ priority: 'low', createdBySide: 'staff' });
  });

  it('cleans the title and the description', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    const raised = await raiseRequest(ctx, client, {
      companyId: company.id,
      title: '  The printer is broken ',
      description: ' Steps:\r\n1. Print\u{200B}\r\n2. Look ',
      type: 'bug',
    });

    expect(await stored(raised.id)).toMatchObject({
      title: 'The printer is broken',
      description: 'Steps:\n1. Print\n2. Look',
    });
  });

  it.each([
    ['no title', { title: ' ' }],
    ['a title of two lines', { title: 'The printer\nis broken' }],
    ['no description', { description: ' \r\n ' }],
    ['an unknown type', { type: 'question' }],
  ])('refuses %s', async (_name, change) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    await expect(
      raiseRequest(ctx, client, { ...INPUT, ...change, companyId: company.id }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await db.$count(request)).toBe(0);
  });

  it('refuses an unknown priority from the staff', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');

    await expect(
      raiseRequest(ctx, support, { ...INPUT, priority: 'urgent', companyId: company.id }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a deactivated company, also from the staff', async () => {
    const company = await createCompany(db, { deactivated: true });
    const support = await staffActor(db, 'support');

    await expect(
      raiseRequest(ctx, support, { ...INPUT, companyId: company.id }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.companyDeactivated' });
    expect(await db.$count(request)).toBe(0);
  });

  it('refuses someone who lost their role while the request was under way', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    // The request loaded them as a Client; by the time it's stored they're a Watcher.
    await db.update(membership).set({ role: 'watcher' }).where(eq(membership.userId, client.id));

    await expect(
      raiseRequest(ctx, client, { ...INPUT, companyId: company.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.$count(request)).toBe(0);
  });

  it('stops at the limit of requests one person raises', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    await fillRateLimitBucket(db, `request:user:${client.id}`, RATE_LIMITS.requestsPerUser.limit);

    await expect(
      raiseRequest(ctx, client, { ...INPUT, companyId: company.id }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await db.$count(request)).toBe(0);
  });
});

describe('request numbers', () => {
  it('continue across companies, in the order requests are raised', async () => {
    const [first, second] = [await createCompany(db), await createCompany(db)];
    const [alice, bob] = [
      await memberActor(db, first.id, 'client'),
      await memberActor(db, second.id, 'admin'),
    ];

    const numbers = await inSequence(
      [
        [alice, first.id],
        [bob, second.id],
        [alice, first.id],
      ] as const,
      async ([actor, companyId]) =>
        (await raiseRequest(ctx, actor, { ...INPUT, companyId })).number,
    );

    expect(numbers).toEqual([1, 2, 3]);
  });

  it('are never shared by requests raised at the same moment', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    const raised = await Promise.all(
      Array.from({ length: 10 }, () =>
        raiseRequest(ctx, client, { ...INPUT, companyId: company.id }),
      ),
    );

    expect(raised.map(({ number }) => number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(await db.select({ last: requestCounter.lastNumber }).from(requestCounter)).toEqual([
      { last: 10 },
    ]);
  });

  it('are not used up by a request that is not raised after all', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    // A request that already has number 1 makes the next one fail after it took its number.
    await db.insert(request).values({
      number: 1,
      companyId: company.id,
      title: 'An earlier request',
      description: 'Stored without the counter.',
      type: 'support',
      priority: 'normal',
      createdBySide: 'company',
    });

    await expect(raiseRequest(ctx, client, { ...INPUT, companyId: company.id })).rejects.toThrow();

    expect(await db.select().from(requestCounter)).toEqual([]);
  });
});
