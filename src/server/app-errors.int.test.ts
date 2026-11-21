/**
 * @file Integration tests for recording errors in the app: what is stored
 * (database values taken out of the message, the path without its query
 * string or tokens, the signed-in user), the reference a digest gives, the
 * log line (always one line, whatever a request sent), and the limit per IP
 * address.
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appError } from '@/db/schema';
import { hasControlCharacter } from '@/lib/character-rules';
import { defined, firstRow } from '@/lib/defined';
import { referenceFromDigest } from '@/lib/error-reference';

import { createUser, fromIp, inSequence, setupTestContext } from '../../tests/integration/helpers';
import { recordAppError, recordedPath } from './app-errors';
import { RATE_LIMITS } from './rate-limit';

const { db, ctx } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Reads the stored errors.
 *
 * @returns Every column but the ID and time.
 */
async function stored() {
  return db
    .select({
      reference: appError.reference,
      digest: appError.digest,
      source: appError.source,
      routeType: appError.routeType,
      routePath: appError.routePath,
      path: appError.path,
      name: appError.name,
      message: appError.message,
      userId: appError.userId,
    })
    .from(appError);
}

describe('recordAppError', () => {
  it("stores a server error under its digest's reference, without database values", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(
      new DrizzleQueryError('select * from "user" where "email" = $1', ['jane@adiutor.test']),
      { digest: '2828711936' },
    );

    const recorded = await recordAppError(fromIp(ctx, '203.0.113.1'), {
      source: 'server',
      error,
      digest: '2828711936',
      routeType: 'render',
      routePath: '/(app)/companies/page',
      path: '/companies',
    });

    expect(recorded).toMatchObject({ reference: referenceFromDigest('2828711936'), stored: true });
    expect(recorded.at).toBeInstanceOf(Date);
    expect(await stored()).toEqual([
      {
        reference: referenceFromDigest('2828711936'),
        digest: '2828711936',
        source: 'server',
        routeType: 'render',
        routePath: '/(app)/companies/page',
        path: '/companies',
        name: 'Error',
        // On one line: the line break before Drizzle's parameters is a space.
        message: 'Failed query: select * from "user" where "email" = $1 params: [redacted]',
        userId: null,
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      `App error ${recorded.reference}: server render /(app)/companies/page (digest 2828711936)`,
    );
    expect(JSON.stringify([warn.mock.calls, await stored()])).not.toContain('jane');
  });

  it('stores who was signed in, and the same error again under the same reference', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const userId = await createUser(db, 'jane@adiutor.test');
    const report = {
      source: 'server' as const,
      error: new Error('SMTP server refused the message'),
      digest: '3496291841',
      routeType: 'action' as const,
      userId,
    };

    await recordAppError(fromIp(ctx, '203.0.113.1'), report);
    await recordAppError(fromIp(ctx, '203.0.113.1'), report);

    const rows = await stored();
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row).toMatchObject({
        reference: referenceFromDigest('3496291841'),
        name: 'Error',
        message: 'SMTP server refused the message',
        userId,
      });
    });
  });

  it('keeps the path without its query string, and without the token of a secret link', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recordAppError(fromIp(ctx, '203.0.113.1'), {
      source: 'browser',
      error: { name: 'TypeError', message: 'x is undefined' },
      path: '/admin/users?q=jane%40adiutor.test#results',
    });
    await recordAppError(fromIp(ctx, '203.0.113.1'), {
      source: 'server',
      error: new Error('x'),
      path: '/invite/adiutor-tests-secret-token?from=email',
    });

    expect((await stored()).map(({ path }) => path).sort()).toEqual([
      '/admin/users',
      '/invite/[token]',
    ]);
    expect(recordedPath('/join/adiutor-tests-secret-token/more')).toBe('/join/[token]/more');
    expect(recordedPath('/answer/adiutor-tests-secret-token/approve')).toBe(
      '/answer/[token]/approve',
    );
    expect(recordedPath('/api/auth/reset-password/adiutor-tests-secret-token?callbackURL=/')).toBe(
      '/api/auth/reset-password/[token]',
    );
    expect(recordedPath('?q=only')).toBeNull();
    expect(recordedPath(null)).toBeNull();
  });

  it('logs and stores one line, whatever line breaks the report carries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forged = 'App error 7KQ2-M9XD: server render /(app)/admin/users/page';

    const recorded = await recordAppError(fromIp(ctx, '203.0.113.1'), {
      source: 'browser',
      error: { name: 'Type\nError', message: `x is undefined\r\n${forged}\u0000` },
      digest: `12\n${forged}`,
      routePath: `/(app)/dashboard/page\r\n${forged}`,
      path: `/dashboard\n${forged}`,
    });

    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^App error [2-9A-Z]{4}-[2-9A-Z]{4}: browser /);
    expect(hasControlCharacter(defined(lines[0], 'the log line'))).toBe(false);
    expect(recorded.stored).toBe(true);
    expect(firstRow(await stored(), 'the stored error')).toMatchObject({
      digest: `12 ${forged}`,
      routePath: `/(app)/dashboard/page ${forged}`,
      path: `/dashboard ${forged}`,
      name: 'Type Error',
      message: `x is undefined ${forged}`,
    });
    expect(recordedPath('/dashboard\r\n\t/admin')).toBe('/dashboard /admin');
    expect(recordedPath('\n')).toBeNull();
  });

  it('gives a browser error a reference of its own and shortens a long message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const recorded = await recordAppError(fromIp(ctx, '203.0.113.1'), {
      source: 'browser',
      error: { name: null, message: 'x'.repeat(900) },
      path: '/dashboard',
    });

    expect(recorded.reference).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    const row = firstRow(await stored(), 'the stored error');
    expect(row).toMatchObject({ reference: recorded.reference, digest: null, name: null });
    expect(row.message).toHaveLength(500);
    expect(warn).toHaveBeenCalledWith(`App error ${recorded.reference}: browser /dashboard`);
  });

  it('stores at most so many per IP address an hour, and still logs the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { limit } = RATE_LIMITS.appErrorsPerIp;
    const report = { source: 'browser' as const, error: { message: 'x' }, path: '/dashboard' };

    await inSequence(Array.from({ length: limit }), () =>
      recordAppError(fromIp(ctx, '203.0.113.66'), report),
    );
    const over = await recordAppError(fromIp(ctx, '203.0.113.66'), report);
    await recordAppError(fromIp(ctx, '203.0.113.1'), report);

    expect(over).toMatchObject({ stored: false });
    expect(warn).toHaveBeenCalledWith(`App error ${over.reference}: browser /dashboard`);
    // The limit's IP address got its limit's worth; another one isn't affected.
    expect(await stored()).toHaveLength(limit + 1);
    expect((await stored()).map(({ reference }) => reference)).not.toContain(over.reference);
  });

  it('stores every error of a background job, which has no IP address to limit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { limit } = RATE_LIMITS.appErrorsPerIp;
    const report = { source: 'job' as const, error: new Error('x'), routePath: 'retention' };

    await inSequence(Array.from({ length: limit + 2 }), () => recordAppError({ db }, report));

    expect(await stored()).toHaveLength(limit + 2);
  });
});
