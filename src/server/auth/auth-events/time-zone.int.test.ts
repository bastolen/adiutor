/**
 * @file Integration tests for the time zone at sign-in: the browser gets the
 * account's zone, an account without one gets none (and one left in the
 * browser is removed), sign-in never saves a zone, and a password whose code
 * step is still to come changes nothing.
 */
import { getOAuthState } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import { createSession, createUser } from '../../../../tests/integration/helpers';
import { afterAuthRequest } from './after-request';
import { afterPasswordSignIn } from './password-sign-in';
import { db, githubCallback, passwordSignIn } from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  getOAuthState: vi.fn(),
}));

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(getOAuthState).mockReset().mockResolvedValue(null);
});

/**
 * Reads a user's saved time zone.
 *
 * @param userId - The user.
 * @returns Their `user.time_zone`.
 */
async function savedTimeZone(userId: string) {
  return firstRow(
    await db.select({ timeZone: user.timeZone }).from(user).where(eq(user.id, userId)),
    'the user',
  ).timeZone;
}

/**
 * The values a request set the time zone cookie to.
 *
 * @param setCookie - The request's `setCookie` mock.
 * @returns The values, in order.
 */
const zoneCookies = (setCookie: ReturnType<typeof passwordSignIn>['setCookie']) =>
  setCookie.mock.calls.filter(([name]) => name === 'adiutor.time-zone').map(([, value]) => value);

describe('the time zone at sign-in', () => {
  it("gives the browser the account's zone over the one it had", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, jane));
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.time-zone=Europe/Amsterdam' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(zoneCookies(setCookie)).toEqual(['Asia/Kolkata']);
    expect(setCookie).toHaveBeenCalledWith(
      'adiutor.time-zone',
      'Asia/Kolkata',
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('saves nothing for an account without a zone, and removes the one left in the browser', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn(
      { cookie: 'adiutor.time-zone=Europe/Amsterdam' },
      { sessionId, userId: jane },
    );

    await afterPasswordSignIn(ctx);

    expect(await savedTimeZone(jane)).toBeNull();
    expect(setCookie).toHaveBeenCalledWith(
      'adiutor.time-zone',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  it('sets no cookie for an account without a zone in a browser without one', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = passwordSignIn({}, { sessionId, userId: jane });

    await afterPasswordSignIn(ctx);

    expect(zoneCookies(setCookie)).toEqual([]);
  });

  it('changes nothing for a password whose code step is still to come', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'Asia/Kolkata' }).where(eq(user.id, jane));
    const sessionId = await createSession(db, jane);
    const before = passwordSignIn({}, { sessionId, userId: jane });
    await afterAuthRequest(before.ctx);
    const after = passwordSignIn({}, null);
    await afterPasswordSignIn(after.ctx);

    expect(zoneCookies(before.setCookie)).toEqual([]);
    expect(zoneCookies(after.setCookie)).toEqual([]);
  });

  it('does the same for a sign-in with a provider', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ timeZone: 'America/New_York' }).where(eq(user.id, jane));
    const sessionId = await createSession(db, jane);
    const { ctx, setCookie } = githubCallback(new Headers(), { sessionId, userId: jane });

    await afterAuthRequest(ctx);

    expect(zoneCookies(setCookie)).toEqual(['America/New_York']);
  });
});
