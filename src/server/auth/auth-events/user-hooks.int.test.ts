/**
 * @file Integration tests for emailed links, email addresses verified by a
 * provider, and a first password.
 */
import { getOAuthState } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { account, rateLimitBucket, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';

import { connectGitHub, createUser, inSequence } from '../../../../tests/integration/helpers';
import { countFailedSignIn } from '../auth-guards';
import type { AuthHookContext } from './hook-context';
import { afterAccountCreate } from './provider-accounts';
import { db, subjects, events } from './test-helpers';
import { afterUserUpdate, beforeUserUpdate, onEmailVerified, onPasswordReset } from './user-hooks';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

// The checks before a request read its session from Better Auth, and the reactions read the OAuth
// state (only there during a request); the tests hand both over.
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
  vi.mocked(sendEmail).mockClear();
  // No OAuth sign-in marked as a re-verify, unless a test marks one (`markReverify`).
  vi.mocked(getOAuthState).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  // Puts back the real `fetch` after tests that stand in for GitHub's API.
  vi.restoreAllMocks();
});

describe('a first password', () => {
  it('is emailed when a reset adds it to an account that could already sign in another way', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    // Without two-factor authentication: a reset that would end provider MFA is refused before.
    await connectGitHub(db, jane, false);

    await afterAccountCreate(
      { userId: jane, providerId: 'credential' },
      { path: '/reset-password', headers: new Headers(), context: {} },
    );

    expect(await subjects()).toEqual(['A password was added to your Adiutor account']);
  });

  it("isn't emailed for the welcome link of a registered account", async () => {
    const john = await createUser(db, 'john@adiutor.test');

    await afterAccountCreate(
      { userId: john, providerId: 'credential' },
      { path: '/reset-password', headers: new Headers(), context: {} },
    );

    expect(await subjects()).toEqual([]);
  });
});

describe('emailed links', () => {
  it('records a verified email address', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    await onEmailVerified(jane, new Headers());

    expect(await events()).toEqual([
      { action: 'email_verified', actorUserId: jane, targetUserId: jane, details: {} },
    ]);
  });

  it('records a password reset, verifies the address and tells the user', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, jane));
    await db.insert(account).values({
      userId: jane,
      accountId: jane,
      providerId: 'credential',
      password: 'hashed',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    await onPasswordReset(jane, new Headers());

    expect(await events()).toEqual([
      { action: 'password_reset', actorUserId: jane, targetUserId: jane, details: {} },
    ]);
    expect(await subjects()).toHaveLength(1);
    const found = firstRow(
      await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, jane)),
      'the user',
    );
    expect(found.emailVerified).toBe(true);
  });

  it('lifts a pause on password sign-in with a password reset', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await inSequence(Array.from({ length: 10 }), () => countFailedSignIn('Jane@adiutor.test'));
    await inSequence(Array.from({ length: 10 }), () => countFailedSignIn('john@adiutor.test'));

    await onPasswordReset(jane, new Headers());

    const left = await db.select({ key: rateLimitBucket.key }).from(rateLimitBucket);
    expect(left.map(({ key }) => key)).toEqual(['sign-in-failed:email:john@adiutor.test']);
  });
});

describe('an email address verified by signing in with GitHub or Google', () => {
  /**
   * Builds the context of a provider's OAuth callback.
   *
   * @param providerId - `github` or `google`.
   * @returns The context.
   */
  const callback = (providerId: string): AuthHookContext => ({
    path: '/callback/:id',
    params: { id: providerId },
    headers: new Headers(),
    context: {},
  });

  /**
   * Runs Better Auth's hooks around a change to a user.
   *
   * @param userId - The user.
   * @param data - The changed fields.
   * @param ctx - The endpoint changing them.
   */
  async function updateUser(
    userId: string,
    data: Record<string, unknown>,
    ctx: AuthHookContext | null,
  ): Promise<void> {
    beforeUserUpdate(data, ctx);
    await afterUserUpdate({ id: userId }, ctx);
  }

  it('is recorded with the provider', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');

    await updateUser(jane, { emailVerified: true }, callback('github'));
    await updateUser(john, { emailVerified: true }, callback('google'));

    expect(await events()).toEqual([
      {
        action: 'email_verified',
        actorUserId: jane,
        targetUserId: jane,
        details: { providerId: 'github' },
      },
      {
        action: 'email_verified',
        actorUserId: john,
        targetUserId: john,
        details: { providerId: 'google' },
      },
    ]);
  });

  it('is recorded once, even when the sign-in changes the user again', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const ctx = callback('github');

    await updateUser(jane, { emailVerified: true }, ctx);
    await updateUser(jane, { name: 'Jane' }, ctx);

    expect((await events()).map((event) => event.action)).toEqual(['email_verified']);
  });

  it('is not recorded for other changes, or by other endpoints', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    await updateUser(jane, { name: 'Jane' }, callback('github'));
    await updateUser(jane, { emailVerified: false }, callback('github'));
    // The verification link has its own reaction (`onEmailVerified`).
    await updateUser(jane, { emailVerified: true }, { path: '/verify-email', context: {} });
    await updateUser(jane, { emailVerified: true }, null);

    expect(await events()).toEqual([]);
  });

  it('is not recorded after a change that was not checked before it', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    await afterUserUpdate({ id: jane }, callback('github'));

    expect(await events()).toEqual([]);
  });
});
