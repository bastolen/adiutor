/**
 * @file Integration tests for raising a request. Which roles may raise one is
 * in the authorization matrix.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { membership, request, setting } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { appUrl } from '@/lib/env';

import {
  actorFor,
  addMember,
  atTheSameMoment,
  createCompany,
  fillRateLimitBucket,
  inSequence,
  memberActor,
  staffActor,
} from '../../../tests/integration/helpers';
import { RATE_LIMITS } from '../rate-limit';
import { incrementSetting } from '../settings';
import raiseRequest from './raise';
import { ctx, db, deactivatedMeanwhile, storedRequest, storeRequestType } from './test-helpers';

/**
 * Reads the request counter's row, the `requests.last_number` setting.
 *
 * @returns Its value, in a list: empty while no request took a number.
 */
const counterRow = () =>
  db.select({ value: setting.value }).from(setting).where(eq(setting.key, 'requests.last_number'));

/** A request as a form sends it, without its company. */
const INPUT = {
  title: 'The printer is broken',
  description: 'It prints blank pages.',
  type: 'bug',
} as const;

describe('raiseRequest', () => {
  it('stores what was asked, by whom and from which side, open and with its type’s priority', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    const raised = await raiseRequest(ctx, client, { ...INPUT, companyId: company.id });

    expect(raised.number).toBe(1);
    expect(await storedRequest(raised.id)).toMatchObject({
      number: 1,
      companyId: company.id,
      title: 'The printer is broken',
      description: 'It prints blank pages.',
      descriptionFormat: 'markdown',
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

    expect(await storedRequest(raised.id)).toMatchObject({ companyId: company.id });
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

    expect(await storedRequest(raised.id)).toMatchObject({ type, priority });
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

    expect(await storedRequest(raised.id)).toMatchObject({ priority: 'low' });
  });

  it('lets the staff choose the priority, or leave it to the type, and notes their side', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');
    const input = { ...INPUT, type: 'new_feature', companyId: company.id };

    const chosen = await raiseRequest(ctx, support, { ...input, priority: 'high' });
    const left = await raiseRequest(ctx, support, { ...input, priority: '' });

    expect(await storedRequest(chosen.id)).toMatchObject({
      priority: 'high',
      createdBySide: 'staff',
    });
    expect(await storedRequest(left.id)).toMatchObject({ priority: 'low', createdBySide: 'staff' });
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

    expect(await storedRequest(raised.id)).toMatchObject({
      title: 'The printer is broken',
      description: 'Steps:\n1. Print\n2. Look',
    });
  });

  it.each([
    ['no title', { title: ' ' }],
    ['a title of two lines', { title: 'The printer\nis broken' }],
    ['no description', { description: ' \r\n ' }],
    ['a type that isn’t a key', { type: 'New feature' }],
  ])('refuses %s', async (_name, change) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');

    await expect(
      raiseRequest(ctx, client, { ...INPUT, ...change, companyId: company.id }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await db.$count(request)).toBe(0);
  });

  it('takes the starting priority from a type the staff added', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    await storeRequestType({ key: 'printers', startingPriority: 'high' });

    const raised = await raiseRequest(ctx, client, {
      ...INPUT,
      type: 'printers',
      companyId: company.id,
    });

    expect(await storedRequest(raised.id)).toMatchObject({ type: 'printers', priority: 'high' });
  });

  it.each([
    ['no type has', 'printers', null],
    ['an archived type has', 'printers', new Date()],
  ])('refuses a key %s', async (_name, key, archivedAt) => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    if (archivedAt) {
      await storeRequestType({ key, archivedAt });
    }

    await expect(
      raiseRequest(ctx, client, { ...INPUT, type: key, companyId: company.id }),
    ).rejects.toMatchObject({ code: 'invalid', key: 'errors.requestTypes.unavailable' });
    expect(await db.$count(request)).toBe(0);
  });

  it.each([
    ['the staff', ''],
    ['the staff, who sent spaces', '   '],
  ])('asks %s for a company when none was chosen, as for any other field', async (_who, none) => {
    await createCompany(db);
    const support = await staffActor(db, 'support');

    const refusal = await raiseRequest(ctx, support, { ...INPUT, companyId: none }).catch(
      (error: unknown) => error,
    );

    // Not "this page doesn't exist", which is for a company that can't be seen.
    expect(refusal).toBeInstanceOf(ZodError);
    expect(refusal).toMatchObject({ issues: [{ message: 'validation.requestCompany' }] });
    expect(await db.$count(request)).toBe(0);
  });

  it('asks for a company before anything else that is missing', async () => {
    const [alpha, beta] = [await createCompany(db), await createCompany(db)];
    const client = await memberActor(db, alpha.id, 'client');
    await addMember(db, beta.id, client.id, 'client');

    await expect(
      raiseRequest(ctx, await actorFor(db, client.id), {
        companyId: '',
        title: '',
        description: '',
        type: '',
      }),
    ).rejects.toMatchObject({ issues: [{ message: 'validation.requestCompany' }] });
  });

  it('still reports a company that does not exist, or that they may not see, as not found', async () => {
    const [own, other] = [await createCompany(db), await createCompany(db)];
    const client = await memberActor(db, own.id, 'client');

    await expect(
      raiseRequest(ctx, client, { ...INPUT, companyId: 'adiutor-tests-nowhere' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      raiseRequest(ctx, client, { ...INPUT, companyId: other.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
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

  it('refuses the staff when the company was deactivated while the request was under way', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');

    // The staff keep their rights in a deactivated company: only the company itself refuses this.
    const ended = await deactivatedMeanwhile(support.id, company.id, () =>
      raiseRequest(ctx, support, { ...INPUT, companyId: company.id }),
    );

    expect(ended).toMatchObject({
      status: 'rejected',
      reason: { code: 'invalid', key: 'errors.companyDeactivated' },
    });
    expect(await db.$count(request)).toBe(0);
    expect(await counterRow()).toEqual([]);
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

describe('raiseRequest: links to the staff’s pages', () => {
  it('keeps a link to a page for the staff in the description as its text', async () => {
    const company = await createCompany(db);
    const support = await staffActor(db, 'support');

    const raised = await raiseRequest(ctx, support, {
      ...INPUT,
      companyId: company.id,
      description: `Reported to [Adiutor Tests](${appUrl}/admin/companies/${company.id}) by phone.`,
    });

    expect((await storedRequest(raised.id))?.description).toBe(
      'Reported to Adiutor Tests by phone.',
    );
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
    expect(await counterRow()).toEqual([{ value: 10 }]);
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

    expect(await counterRow()).toEqual([]);
  });

  it('time a request once, by when its number was taken: raised and last active at one moment', async () => {
    const company = await createCompany(db);
    const client = await memberActor(db, company.id, 'client');
    let waitedUntil = Infinity;

    // Another request holds the counter, so this one starts and then waits for its number.
    const { second } = await atTheSameMoment(
      db,
      (tx) => incrementSetting(tx, 'requests.last_number'),
      () => raiseRequest(ctx, client, { ...INPUT, companyId: company.id }),
      async (tx) => {
        const { rows } = await tx.execute<{ ms: number }>(
          sql`select floor(extract(epoch from clock_timestamp()) * 1000)::float8 as ms`,
        );
        waitedUntil = firstRow(rows, 'the clock').ms;
      },
    );

    if (second.status === 'rejected') {
      throw second.reason;
    }
    expect(second.value.number).toBe(2);
    const row = await storedRequest(second.value.id);
    expect(row?.lastActivityAt).toEqual(row?.createdAt);
    // Not when its transaction started, which was before it waited.
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(waitedUntil);
  });
});
