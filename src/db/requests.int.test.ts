/**
 * @file Tests for what the database itself guarantees about requests: one
 * number each, entries that are a reply or a change, a single counter row,
 * and a history that outlives the accounts in it.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createCompany,
  createStaffSettings,
  createUser,
  setupTestContext,
} from '../../tests/integration/helpers';
import { firstRow } from '../lib/defined';
import { request, requestCounter, requestEntry, staffSettings, user } from './schema';

const { db } = setupTestContext();

/**
 * Stores a request raised by someone at a company.
 *
 * @param number - The request's number.
 * @returns The request's ID, its company's and its author's.
 */
async function storeRequest(number: number) {
  const company = await createCompany(db);
  const authorId = await createUser(db, `author${number}@adiutor.test`);
  const created = firstRow(
    await db
      .insert(request)
      .values({
        number,
        companyId: company.id,
        title: 'The printer is broken',
        description: 'It prints blank pages.',
        type: 'bug',
        priority: 'normal',
        createdBy: authorId,
        createdBySide: 'company',
      })
      .returning(),
    'the new request',
  );
  return { request: created, companyId: company.id, authorId };
}

describe('the request table', () => {
  it('starts a request open, in plain text, with its activity at its creation', async () => {
    const { request: created } = await storeRequest(1);
    expect(created).toMatchObject({
      status: 'open',
      descriptionFormat: 'plain',
      reopenedAt: null,
    });
    expect(created.lastActivityAt).toEqual(created.createdAt);
  });

  it('gives every request its own number', async () => {
    const { companyId } = await storeRequest(1);
    await expect(
      db.insert(request).values({
        number: 1,
        companyId,
        title: 'Another request',
        description: 'With the same number.',
        type: 'support',
        priority: 'normal',
        createdBySide: 'staff',
      }),
    ).rejects.toThrow();
  });

  it('keeps a request and its history when its author’s account is deleted', async () => {
    const { request: created, authorId } = await storeRequest(1);
    await db.insert(requestEntry).values({
      requestId: created.id,
      kind: 'comment',
      authorId,
      authorSide: 'company',
      body: 'Any news?',
    });

    await db.delete(user).where(eq(user.id, authorId));

    const [kept] = await db.select().from(request).where(eq(request.id, created.id));
    expect(kept).toMatchObject({ createdBy: null, createdBySide: 'company' });
    const entries = await db.select().from(requestEntry);
    expect(entries).toMatchObject([{ authorId: null, authorSide: 'company', body: 'Any news?' }]);
  });
});

describe('the request_entry table', () => {
  it('takes a reply with a text and a change with a new value', async () => {
    const { request: created, authorId } = await storeRequest(1);
    const entry = { requestId: created.id, authorId, authorSide: 'staff' as const };
    await db.insert(requestEntry).values([
      { ...entry, kind: 'comment', body: 'On it.' },
      { ...entry, kind: 'status', fromValue: 'open', toValue: 'todo' },
      { ...entry, kind: 'title', fromValue: 'Help', toValue: 'The printer is broken' },
    ]);

    const entries = await db.select().from(requestEntry).orderBy(requestEntry.id);
    expect(entries.map(({ kind, bodyFormat }) => [kind, bodyFormat])).toEqual([
      ['comment', 'plain'],
      ['status', 'plain'],
      ['title', 'plain'],
    ]);
  });

  it.each([
    ['a reply without a text', { kind: 'comment' as const }],
    ['a reply with a new value', { kind: 'comment' as const, body: 'Done.', toValue: 'done' }],
    ['a change without a new value', { kind: 'status' as const, fromValue: 'open' }],
    ['a change with a text', { kind: 'status' as const, toValue: 'done', body: 'Done.' }],
  ])('refuses %s', async (_name, values) => {
    const { request: created, authorId } = await storeRequest(1);
    await expect(
      db
        .insert(requestEntry)
        .values({ requestId: created.id, authorId, authorSide: 'staff', ...values }),
    ).rejects.toThrow();
  });

  it('goes when its request goes', async () => {
    const { request: created, authorId } = await storeRequest(1);
    await db.insert(requestEntry).values({
      requestId: created.id,
      kind: 'comment',
      authorId,
      authorSide: 'company',
      body: 'Any news?',
    });

    await db.delete(request).where(eq(request.id, created.id));

    expect(await db.select().from(requestEntry)).toEqual([]);
  });
});

describe('the request_counter table', () => {
  it('holds one row only', async () => {
    await db.insert(requestCounter).values({ lastNumber: 1 });
    await expect(db.insert(requestCounter).values({ lastNumber: 2 })).rejects.toThrow();
  });
});

describe('the staff settings', () => {
  it('show request numbers with "AD" until the staff choose a prefix', async () => {
    await createStaffSettings(db);
    const [settings] = await db
      .select({ requestPrefix: staffSettings.requestPrefix })
      .from(staffSettings);
    expect(settings).toEqual({ requestPrefix: 'AD' });
  });
});
