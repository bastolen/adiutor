/**
 * @file Integration tests for the reactions after a request: confirming a
 * session with a code, changes to how the user signs in, and a first
 * passkey.
 */
import { APIError, getOAuthState, getSessionFromCtx } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { rateLimitBucket, session, twoFactor, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';

import {
  addPassword,
  connectGitHub,
  createCompany,
  createSession,
  createUser,
  enableTwoFactor,
  memberActor,
  staffActor,
  startAuthenticatorSetup,
  turnOffGitHubSignIn,
} from '../../../../tests/integration/helpers';
import { type AuthGuardContext, beforeAuthRequest } from '../auth-guards';
import { takeSignInChangeLock } from '../sign-in-change-lock';
import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import {
  db,
  requestWithSession,
  events,
  sessionMfa,
  expectSetSince,
  sessionVerifiedAt,
  trustDevice,
  subjects,
  devicesLeft,
  addPasskey,
  storeSessionMfa,
} from './test-helpers';

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

describe('confirming a session with a code', () => {
  it('records a wrong code and counts it towards the step-up limit', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const sessionId = await createSession(db, support.id);

    await afterAuthRequest(
      await requestWithSession(
        '/two-factor/verify-totp',
        { sessionId, userId: support.id },
        new APIError('UNAUTHORIZED', { message: 'Invalid code' }),
      ),
    );

    expect(await events()).toEqual([
      {
        action: 'mfa_failed',
        actorUserId: support.id,
        targetUserId: support.id,
        details: { method: 'authenticator' },
      },
    ]);
    expect(
      await db
        .select({ key: rateLimitBucket.key, count: rateLimitBucket.count })
        .from(rateLimitBucket),
    ).toEqual([{ key: `step-up-failed:user:${support.id}`, count: 1 }]);
    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: false, mfaMethod: null });
  });

  it('ends the wait for a new emailed code once a code is used, not after a wrong one', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    const sessionId = await createSession(db, support.id);
    const cooldown = `email-code-cooldown:user:${support.id}`;
    await db
      .insert(rateLimitBucket)
      .values({ key: cooldown, count: 1, resetAt: new Date(Date.now() + 150_000) });
    /**
     * Whether the user is still waiting for a new code.
     *
     * @returns Whether the wait's bucket is there.
     */
    const waiting = async () =>
      (await db.select().from(rateLimitBucket).where(eq(rateLimitBucket.key, cooldown))).length > 0;

    await afterAuthRequest(
      await requestWithSession(
        '/two-factor/verify-otp',
        { sessionId, userId: support.id },
        new APIError('UNAUTHORIZED', { message: 'Invalid code' }),
      ),
    );
    expect(await waiting()).toBe(true);

    await afterAuthRequest(
      await requestWithSession('/two-factor/verify-otp', { sessionId, userId: support.id }),
    );
    expect(await waiting()).toBe(false);
  });

  it('confirms the session with an email code only where email codes count', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    const supportSession = await createSession(db, support.id);
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id, 'email');
    const managerSession = await createSession(db, manager.id);

    await afterAuthRequest(
      await requestWithSession('/two-factor/verify-otp', {
        sessionId: supportSession,
        userId: support.id,
      }),
    );
    await afterAuthRequest(
      await requestWithSession('/two-factor/verify-otp', {
        sessionId: managerSession,
        userId: manager.id,
      }),
    );

    expect(await sessionMfa(supportSession)).toEqual({
      mfaVerified: true,
      mfaMethod: 'email_code',
    });
    expect(await sessionMfa(managerSession)).toEqual({ mfaVerified: false, mfaMethod: null });
    expect(await events()).toEqual([
      {
        action: 'mfa_verified',
        actorUserId: support.id,
        targetUserId: support.id,
        details: { method: 'email_code' },
      },
    ]);
  });

  it('starts a new window for changing sign-in methods on a session confirmed long ago', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const sessionId = await createSession(db, support.id, {
      mfaMethod: 'authenticator',
      mfaVerifiedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    const start = new Date();

    await afterAuthRequest(
      await requestWithSession('/two-factor/verify-totp', { sessionId, userId: support.id }),
    );

    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'authenticator' });
    expectSetSince(await sessionVerifiedAt(sessionId), start);
  });
});

describe('an authenticator code checked with a session', () => {
  /**
   * Builds a request that checks an authenticator code with a session, as
   * both the checks before it (`auth-guards/`) and the reactions after it
   * see it, and makes the checks find that session.
   *
   * @param sessionId - The session.
   * @param userId - Its user.
   * @returns The context; set `context.returned` before the reactions run.
   */
  async function authenticatorCode(
    sessionId: string,
    userId: string,
  ): Promise<AuthGuardContext & AuthHookContext> {
    const found = firstRow(
      await db
        .select({
          mfaVerified: session.mfaVerified,
          mfaMethod: session.mfaMethod,
          mfaVerifiedAt: session.mfaVerifiedAt,
          createdAt: session.createdAt,
          twoFactorEnabled: user.twoFactorEnabled,
        })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(eq(session.id, sessionId)),
      'the session',
    );
    const { twoFactorEnabled, ...facts } = found;
    const signedIn = {
      session: { id: sessionId, ...facts },
      user: { id: userId, twoFactorEnabled },
    };
    vi.mocked(getSessionFromCtx).mockResolvedValue(
      signedIn as unknown as Awaited<ReturnType<typeof getSessionFromCtx>>,
    );
    return {
      path: '/two-factor/verify-totp',
      headers: new Headers(),
      body: {},
      /**
       * Reads a signed cookie; there's no pending sign-in.
       *
       * @returns Nothing.
       */
      getSignedCookie: async () => null,
      context: {
        secret: 'adiutor-tests-secret',
        /**
         * Builds a cookie name.
         *
         * @param name - The cookie's short name.
         * @returns The cookie.
         */
        createAuthCookie: (name) => ({ name: `adiutor-tests.${name}` }),
        internalAdapter: {
          /**
           * Looks up a verification value; there are none.
           *
           * @returns Nothing.
           */
          findVerificationValue: async () => null,
        },
        session: signedIn,
      },
    };
  }

  it('records a new method when it finishes setting up the app next to email codes', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    await startAuthenticatorSetup(db, support.id);
    const sessionId = await createSession(db, support.id, {
      mfaMethod: 'email_code',
      mfaVerifiedAt: new Date(),
    });
    // Browsers trusted after an email code, and someone else's.
    const trusted = [
      await trustDevice(support.id, 'laptop'),
      await trustDevice(support.id, 'phone'),
    ];
    const othersDevice = await trustDevice(await createUser(db, 'sam@adiutor.test'));
    const ctx = await authenticatorCode(sessionId, support.id);

    await beforeAuthRequest(ctx);
    // Better Auth checks the code and finishes the setup.
    await db.update(twoFactor).set({ verified: true }).where(eq(twoFactor.userId, support.id));
    ctx.context.returned = { status: true };
    // Better Auth gives the hooks after the endpoint their own copy of `ctx`, sharing `context`.
    await afterAuthRequest({ ...ctx, context: ctx.context });

    expect(await events()).toEqual([
      {
        action: 'two_factor_enabled',
        actorUserId: support.id,
        targetUserId: support.id,
        details: { method: 'authenticator' },
      },
    ]);
    expect(await subjects()).toEqual(['Two-step verification is on for your Adiutor account']);
    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'authenticator' });
    // Email codes no longer count, so neither does a browser trusted after one.
    expect(await devicesLeft([...trusted, othersDevice])).toEqual([othersDevice]);
  });

  it('records a step-up when the app was set up already', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const sessionId = await createSession(db, support.id);
    const trusted = await trustDevice(support.id);
    const ctx = await authenticatorCode(sessionId, support.id);

    await beforeAuthRequest(ctx);
    ctx.context.returned = { status: true };
    // Better Auth gives the hooks after the endpoint their own copy of `ctx`, sharing `context`.
    await afterAuthRequest({ ...ctx, context: ctx.context });

    expect(await events()).toEqual([
      {
        action: 'mfa_verified',
        actorUserId: support.id,
        targetUserId: support.id,
        details: { method: 'authenticator' },
      },
    ]);
    expect(await subjects()).toEqual([]);
    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'authenticator' });
    // A step-up changes no sign-in method, so trusted devices stay.
    expect(await devicesLeft([trusted])).toEqual([trusted]);
  });

  /**
   * Reads how many wrong step-up codes count against a user now.
   *
   * @param userId - The user.
   * @returns The count, or `null` when none were counted.
   */
  async function wrongStepUps(userId: string): Promise<number | null> {
    const [bucket] = await db
      .select({ count: rateLimitBucket.count })
      .from(rateLimitBucket)
      .where(eq(rateLimitBucket.key, `step-up-failed:user:${userId}`));
    return bucket?.count ?? null;
  }

  it('gives back the attempt a right step-up code took before it was checked', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const ctx = await authenticatorCode(await createSession(db, support.id), support.id);

    await beforeAuthRequest(ctx);
    expect(await wrongStepUps(support.id)).toBe(1);
    ctx.context.returned = { status: true };
    await afterAuthRequest({ ...ctx, context: ctx.context });

    expect(await wrongStepUps(support.id)).toBe(0);
  });

  it.each([
    [
      'an emailed code that expired before it was entered',
      new APIError('BAD_REQUEST', { message: 'OTP has expired', code: 'OTP_HAS_EXPIRED' }),
    ],
    [
      'too many tries for one emailed code',
      new APIError('BAD_REQUEST', {
        message: 'Too many attempts. Please request a new code.',
        code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      }),
    ],
    [
      'a method that isn’t turned on',
      new APIError('BAD_REQUEST', { message: 'TOTP not enabled', code: 'TOTP_NOT_ENABLED' }),
    ],
    ['a request that crossed another', new APIError('CONFLICT', { message: 'Conflict' })],
    [
      'an error of the server',
      new APIError('INTERNAL_SERVER_ERROR', { message: 'Internal server error' }),
    ],
  ])(
    'gives back the attempt and records no wrong code for %s: none was compared',
    async (_name, refusal) => {
      const support = await staffActor(db, 'support');
      await enableTwoFactor(db, support.id, 'email');
      const ctx = {
        ...(await authenticatorCode(await createSession(db, support.id), support.id)),
        path: '/two-factor/verify-otp',
      };

      await beforeAuthRequest(ctx);
      expect(await wrongStepUps(support.id)).toBe(1);
      ctx.context.returned = refusal;
      await afterAuthRequest({ ...ctx, context: ctx.context });

      expect(await wrongStepUps(support.id)).toBe(0);
      // The user's activity doesn't say a wrong code was entered.
      expect(await events()).toEqual([]);
    },
  );

  it('keeps the attempt a wrong step-up code took, counting it once', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const ctx = await authenticatorCode(await createSession(db, support.id), support.id);

    await beforeAuthRequest(ctx);
    ctx.context.returned = new APIError('UNAUTHORIZED', { message: 'Invalid code' });
    await afterAuthRequest({ ...ctx, context: ctx.context });

    expect(await wrongStepUps(support.id)).toBe(1);
    expect((await events()).map(({ action }) => action)).toEqual(['mfa_failed']);
  });
});

describe('a change to how the user signs in', () => {
  it('gives back the lock it took once the request is done', async () => {
    const manager = await createUser(db, 'manager@adiutor.test');
    await db.update(user).set({ platformRole: 'manager' }).where(eq(user.id, manager));
    await addPasskey(manager);
    await addPasskey(manager);
    const sessionId = await createSession(db, manager, { mfaMethod: 'passkey' });
    await storeSessionMfa(sessionId, 'passkey');
    const ctx = {
      ...(await requestWithSession('/passkey/delete-passkey', { sessionId, userId: manager })),
      /**
       * Reads a signed cookie; there's no pending sign-in.
       *
       * @returns Nothing.
       */
      getSignedCookie: async () => null,
    } as unknown as AuthGuardContext & AuthHookContext;
    const [stored] = await db.select().from(session).where(eq(session.id, sessionId));
    vi.mocked(getSessionFromCtx).mockResolvedValue({
      session: stored,
      user: { id: manager, twoFactorEnabled: false },
    } as unknown as Awaited<ReturnType<typeof getSessionFromCtx>>);

    await beforeAuthRequest(ctx);
    expect(await takeSignInChangeLock({ db }, manager)).toBeNull();

    // The reactions after a request get their own context object; only `context` is shared.
    await afterAuthRequest({ ...ctx, context: ctx.context });
    expect(await takeSignInChangeLock({ db }, manager)).not.toBeNull();
  });
});

describe('a first passkey', () => {
  it('confirms the session of a company Admin whose only other step is email codes', async () => {
    const testCompany = await createCompany(db);
    const admin = await memberActor(db, testCompany.id, 'admin');
    await addPassword(db, admin.id);
    await enableTwoFactor(db, admin.id, 'email');
    const sessionId = await createSession(db, admin.id);
    await addPasskey(admin.id);

    await afterAuthRequest(
      await requestWithSession('/passkey/verify-registration', { sessionId, userId: admin.id }),
    );

    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'passkey' });
    expect(await subjects()).toEqual(['A passkey was added to your Adiutor account']);
  });

  it("doesn't confirm the session of a Manager who already has an authenticator app", async () => {
    const manager = await staffActor(db, 'manager');
    await addPassword(db, manager.id);
    await enableTwoFactor(db, manager.id);
    const sessionId = await createSession(db, manager.id);
    await addPasskey(manager.id);

    await afterAuthRequest(
      await requestWithSession('/passkey/verify-registration', { sessionId, userId: manager.id }),
    );

    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: false, mfaMethod: null });
    expect((await events()).map((event) => event.action)).toEqual(['passkey_added']);
  });

  it('confirms the session of an account with GitHub with 2FA only while GitHub sign-in is on', async () => {
    const [withGitHubOn, withGitHubOff] = await Promise.all([
      createUser(db, 'jane@adiutor.test'),
      createUser(db, 'john@adiutor.test'),
    ]);
    /**
     * Adds a first passkey to a user who signs in only with GitHub (2FA on),
     * from a session that wasn't confirmed.
     *
     * @param userId - The user.
     * @returns The session's MFA facts afterwards.
     */
    const firstPasskey = async (userId: string) => {
      await connectGitHub(db, userId);
      const sessionId = await createSession(db, userId);
      await addPasskey(userId);
      await afterAuthRequest(
        await requestWithSession('/passkey/verify-registration', { sessionId, userId }),
      );
      return sessionMfa(sessionId);
    };

    expect(await firstPasskey(withGitHubOn)).toEqual({ mfaVerified: false, mfaMethod: null });
    // Without GitHub sign-in its 2FA isn't MFA: there was nothing to protect before the passkey.
    turnOffGitHubSignIn();
    expect(await firstPasskey(withGitHubOff)).toEqual({ mfaVerified: true, mfaMethod: 'passkey' });
  });
});
