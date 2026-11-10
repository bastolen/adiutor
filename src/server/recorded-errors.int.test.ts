/**
 * @file Integration tests for reading recorded errors back: only staff
 * Admins may; a reference is found however it's typed, with every
 * occurrence of a server error and the signed-in user; and the last 7 days
 * of both kinds are listed together, newest first, a page at a time.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { appError, signInError } from '@/db/schema';
import { REFERENCE_ALPHABET } from '@/lib/error-reference';

import { createStaffSettings, setupTestContext, staffActor } from '../../tests/integration/helpers';
import type { Actor } from './actor';
import { findErrorReference, listRecentErrors } from './recorded-errors';

const { ctx, db } = setupTestContext();

let admin: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin', 'admin@adiutor.test');
});

/**
 * Records an error on the server, as `recordAppError` would.
 *
 * @param reference - Its reference.
 * @param at - When it happened.
 * @param userId - Who was signed in, if anyone.
 */
async function serverError(reference: string, at: string, userId: string | null = null) {
  await db.insert(appError).values({
    reference,
    digest: '2828711936',
    source: 'server',
    routeType: 'render',
    routePath: '/(app)/companies/page',
    path: '/companies/adiutor-tests',
    name: 'TypeError',
    message: 'Cannot read properties of undefined',
    userId,
    createdAt: new Date(at),
  });
}

/**
 * Records a sign-in error, as `recordSignInError` would.
 *
 * @param reference - Its reference.
 * @param at - When it happened.
 * @param userId - Who was signed in, if anyone.
 */
async function failedSignIn(reference: string, at: string, userId: string | null = null) {
  await db.insert(signInError).values({
    reference,
    code: 'state_mismatch',
    description: 'State mismatch',
    userId,
    createdAt: new Date(at),
  });
}

describe('who may read recorded errors', () => {
  it('is staff Admins only, not Managers who see the audit log', async () => {
    const manager = await staffActor(db, 'manager', 'manager@adiutor.test');
    const support = await staffActor(db, 'support', 'support@adiutor.test');

    for (const viewer of [manager, support]) {
      // eslint-disable-next-line no-await-in-loop -- Each viewer is checked in turn.
      await expect(findErrorReference(ctx, viewer, '7KQ2-M9XD')).rejects.toMatchObject({
        code: 'forbidden',
      });
      // eslint-disable-next-line no-await-in-loop -- Same.
      await expect(listRecentErrors(ctx, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});

describe('findErrorReference', () => {
  it('finds a reference however it was typed, with every occurrence, newest first', async () => {
    await serverError('7KQ2-M9XD', '2026-11-02T10:00:00Z', admin.id);
    await serverError('7KQ2-M9XD', '2026-11-03T10:00:00Z');
    await serverError('AAAA-BBBB', '2026-11-03T11:00:00Z');

    const found = await findErrorReference(ctx, admin, ' 7kq2m9xd ');

    expect(found.reference).toBe('7KQ2-M9XD');
    expect(found.errors.map(({ at }) => at.toISOString())).toEqual([
      '2026-11-03T10:00:00.000Z',
      '2026-11-02T10:00:00.000Z',
    ]);
    expect(found.errors[1]).toMatchObject({
      kind: 'app',
      source: 'server',
      routeType: 'render',
      routePath: '/(app)/companies/page',
      path: '/companies/adiutor-tests',
      name: 'TypeError',
      message: 'Cannot read properties of undefined',
      digest: '2828711936',
      code: null,
      user: { id: admin.id, email: 'admin@adiutor.test' },
    });
    expect(found.errors[0]?.user).toBeNull();
  });

  it('finds a sign-in error with its code, description and user', async () => {
    await failedSignIn('M9XD-7KQ2', '2026-11-03T10:00:00Z', admin.id);

    const found = await findErrorReference(ctx, admin, 'm9xd-7kq2');

    expect(found.errors).toEqual([
      expect.objectContaining({
        kind: 'sign-in',
        reference: 'M9XD-7KQ2',
        code: 'state_mismatch',
        description: 'State mismatch',
        source: null,
        path: null,
        user: expect.objectContaining({ id: admin.id }),
      }),
    ]);
  });

  it('finds nothing for an unknown reference, and reads nothing for input that can’t be one', async () => {
    await serverError('7KQ2-M9XD', '2026-11-03T10:00:00Z');

    expect(await findErrorReference(ctx, admin, 'ZZZZ-ZZZZ')).toEqual({
      reference: 'ZZZZ-ZZZZ',
      errors: [],
    });
    expect(await findErrorReference(ctx, admin, 'not a reference')).toEqual({
      reference: null,
      errors: [],
    });
  });
});

describe('listRecentErrors', () => {
  it('lists both kinds together, newest first, with how many there are in all', async () => {
    await serverError('AAAA-AAAA', '2026-11-01T10:00:00Z');
    await failedSignIn('BBBB-BBBB', '2026-11-02T10:00:00Z', admin.id);
    await serverError('CCCC-CCCC', '2026-11-03T10:00:00Z', admin.id);

    const newest = await listRecentErrors(ctx, admin);
    const oldest = await listRecentErrors(ctx, admin, { dir: 'asc' });

    expect(newest.total).toBe(3);
    expect(newest.items.map(({ reference, kind }) => `${reference} ${kind}`)).toEqual([
      'CCCC-CCCC app',
      'BBBB-BBBB sign-in',
      'AAAA-AAAA app',
    ]);
    expect(oldest.items.map(({ reference }) => reference)).toEqual([
      'AAAA-AAAA',
      'BBBB-BBBB',
      'CCCC-CCCC',
    ]);
  });

  it('pages through both kinds without repeating one', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) => {
        // A distinct reference per error: its last character comes from the alphabet by index.
        const reference = `AAAA-AAA${REFERENCE_ALPHABET.charAt(index)}`;
        const at = `2026-11-03T10:${String(index).padStart(2, '0')}:00Z`;
        return index % 2 === 0 ? serverError(reference, at) : failedSignIn(reference, at);
      }),
    );

    const first = await listRecentErrors(ctx, admin, { size: 25 });
    const second = await listRecentErrors(ctx, admin, { size: 25, page: 2 });

    expect(first).toMatchObject({ total: 30, page: 1 });
    expect(second.items).toHaveLength(5);
    const ids = [...first.items, ...second.items].map(({ id }) => id);
    expect(new Set(ids).size).toBe(30);
  });
});
