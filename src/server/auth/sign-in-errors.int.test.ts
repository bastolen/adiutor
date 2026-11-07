/**
 * @file Integration tests for recording sign-in errors: what is stored, the
 * unique references, the limit per IP address and the 7-day cleanup.
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signInError } from '@/db/schema';

import { createUser, inSequence, setupTestContext } from '../../../tests/integration/helpers';
import type { ServiceContext } from '../context';
import { cleanUp } from '../jobs';
import { RATE_LIMITS } from '../rate-limit';
import { recordSignInError } from './sign-in-errors';

const { db, ctx } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The service context of a request from an IP address.
 *
 * @param ip - The client's address.
 * @returns The context.
 */
function from(ip: string): ServiceContext {
  /**
   * The request's client, as `requestInfoFromHeaders` would give it.
   *
   * @returns The IP address, without a browser.
   */
  const requestInfo = async () => ({ ip, userAgent: null });
  return { ...ctx, requestInfo };
}

/**
 * Reads the stored sign-in errors.
 *
 * @returns Their reference, code, description and user.
 */
async function stored() {
  return db
    .select({
      reference: signInError.reference,
      code: signInError.code,
      description: signInError.description,
      userId: signInError.userId,
    })
    .from(signInError);
}

describe('recordSignInError', () => {
  it('stores the error under its reference and logs only the reference and code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const userId = await createUser(db, 'jane@adiutor.test');

    const recorded = await recordSignInError(from('203.0.113.1'), {
      code: 'state_mismatch',
      description: '  State mismatch for jane@adiutor.test  ',
      userId,
    });

    expect(recorded.reference).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(await stored()).toEqual([
      {
        reference: recorded.reference,
        code: 'state_mismatch',
        description: 'State mismatch for jane@adiutor.test',
        userId,
      },
    ]);
    expect(warn).toHaveBeenCalledWith(`Sign-in error ${recorded.reference}: state_mismatch`);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('jane');
  });

  it('stores an odd code as UNKNOWN, a long description shortened and an empty one as none', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recordSignInError(from('203.0.113.1'), { code: '<b>', description: 'x'.repeat(900) });
    await recordSignInError(from('203.0.113.1'), { code: 'access_denied', description: '   ' });

    const rows = await stored();
    expect(rows.map(({ code }) => code).sort()).toEqual(['UNKNOWN', 'access_denied']);
    expect(rows.find(({ code }) => code === 'UNKNOWN')?.description).toHaveLength(500);
    expect(rows.find(({ code }) => code === 'access_denied')?.description).toBeNull();
    expect(rows.every(({ userId }) => userId === null)).toBe(true);
  });

  it('gives every error a reference of its own', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const references = await inSequence(Array.from({ length: 15 }), () =>
      recordSignInError(from('203.0.113.1'), { code: 'state_mismatch' }).then(
        ({ reference }) => reference,
      ),
    );

    expect(new Set(references).size).toBe(15);
    expect(await stored()).toHaveLength(15);
  });

  it('stores at most so many per IP address an hour, and still logs the rest with a reference', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { limit } = RATE_LIMITS.signInErrorsPerIp;

    await inSequence(Array.from({ length: limit }), () =>
      recordSignInError(from('203.0.113.66'), { code: 'state_mismatch' }),
    );
    const over = await recordSignInError(from('203.0.113.66'), { code: 'state_mismatch' });
    await recordSignInError(from('203.0.113.1'), { code: 'state_mismatch' });

    expect(over.reference).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/^Sign-in error [2-9A-Z-]{9}: /));
    expect(
      await db
        .select({ reference: signInError.reference })
        .from(signInError)
        .where(eq(signInError.reference, over.reference)),
    ).toEqual([]);
    // The limit's IP address got its limit's worth; another one isn't affected.
    expect(await stored()).toHaveLength(limit + 1);
  });
});

describe('cleanUp of sign-in errors', () => {
  it('removes them after 7 days', async () => {
    await db.insert(signInError).values([
      { reference: 'OLD2-OLD2', code: 'state_mismatch', createdAt: sql`now() - interval '8 days'` },
      { reference: 'NEW2-NEW2', code: 'state_mismatch', createdAt: sql`now() - interval '6 days'` },
    ]);

    await expect(cleanUp(ctx)).resolves.toMatchObject({ signInErrors: 1 });

    expect((await stored()).map(({ reference }) => reference)).toEqual(['NEW2-NEW2']);
  });
});
