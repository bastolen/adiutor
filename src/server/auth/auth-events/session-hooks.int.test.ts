/**
 * @file Integration tests for creating sessions: what a replacement keeps, and
 * what a new session records.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { session } from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import { defined } from '@/lib/defined';

import {
  addMember,
  connectGitHub,
  createCompany,
  createSession,
  createUser,
  enableTwoFactor,
  inSequence,
  lastActiveAt,
  memberActor,
  turnOffGitHubSignIn,
  minutesAgo,
  addPasskey,
} from '../../../../tests/integration/helpers';
import type { AuthHookContext } from './hook-context';
import { afterSessionCreate, beforeSessionCreate } from './session-hooks';
import {
  db,
  events,
  expectSetSince,
  signedCookieReader,
  SESSION_COOKIE,
  COOKIE_SECRET,
  signedInHeaders,
} from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

// The checks before a request read its session from Better Auth, and the reactions read the OAuth
// state (only there during a request); the tests hand both over.
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  getOAuthState: vi.fn(),
}));

describe('a new session', () => {
  /**
   * Builds the context of a request that created a session.
   *
   * @param path - The endpoint path.
   * @param signedIn - The session the request was made with, if any.
   * @param signedIn.sessionId - Its ID.
   * @param signedIn.userId - Its user.
   * @returns The context.
   */
  const created = (path: string, signedIn?: { sessionId: string; userId: string }) => ({
    path,
    context: {
      session: signedIn
        ? {
            session: { id: signedIn.sessionId, mfaVerified: false, mfaMethod: null },
            user: { id: signedIn.userId, twoFactorEnabled: false },
          }
        : null,
    },
  });

  it('records the sign-in of a finished code step, and that the user is active', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);
    const start = new Date();

    await inSequence(
      ['/two-factor/verify-otp', '/two-factor/verify-totp', '/two-factor/verify-backup-code'],
      (path) => afterSessionCreate({ userId: jane, userAgent: 'Firefox' }, created(path)),
    );

    expect(
      (await events()).map(({ action, actorUserId, details }) => [action, actorUserId, details]),
    ).toEqual([
      ['sign_in', jane, { method: 'password_and_email_code' }],
      ['sign_in', jane, { method: 'password_and_authenticator' }],
      ['sign_in', jane, { method: 'backup_code' }],
    ]);
    expectSetSince(await lastActiveAt(db, jane), start);
  });

  it("doesn't call turning on two-step verification a sign-in, though the user is active", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const previous = await createSession(db, jane);
    const start = new Date();

    // A code checked with a session turned two-step verification on, and Better Auth replaced it.
    await inSequence(['/two-factor/verify-otp', '/two-factor/verify-totp'], (path) =>
      afterSessionCreate({ userId: jane }, created(path, { sessionId: previous, userId: jane })),
    );

    expect(await events()).toEqual([]);
    expectSetSince(await lastActiveAt(db, jane), start);
  });

  it('leaves a password sign-in to be recorded once the code step is decided', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    await afterSessionCreate({ userId: jane }, created('/sign-in/email'));

    expect(await events()).toEqual([]);
    expect(await lastActiveAt(db, jane)).toBeNull();
  });

  it('records other sign-ins, also on a browser that was signed in', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const previous = await createSession(db, jane);

    await afterSessionCreate(
      { userId: jane },
      created('/magic-link/verify', { sessionId: previous, userId: jane }),
    );
    await afterSessionCreate({ userId: jane }, created('/magic-link/verify'));

    expect((await events()).map(({ details }) => details)).toEqual([
      { method: 'email_link' },
      { method: 'email_link' },
    ]);
  });

  describe('with a passkey', () => {
    /**
     * Builds the context of `/passkey/verify-authentication`, which Better
     * Auth runs without reading the session: only the request's cookie tells
     * whether the browser was signed in.
     *
     * @param headers - Request headers; without a session cookie by default.
     * @returns The context.
     */
    const passkeyVerified = (headers = new Headers()): AuthHookContext => ({
      path: '/passkey/verify-authentication',
      headers,
      getSignedCookie: signedCookieReader(headers),
      context: {
        authCookies: { sessionToken: { name: SESSION_COOKIE } },
        secret: COOKIE_SECRET,
        session: null,
      },
    });

    /**
     * Lists the recorded events as action, actor and details.
     *
     * @returns The events, oldest first.
     */
    const recorded = async () =>
      (await events()).map(({ action, actorUserId, details }) => [action, actorUserId, details]);

    it('records a step-up on a signed-in browser as confirming the session, not a sign-in', async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const previous = await createSession(db, jane);
      const start = new Date();

      await afterSessionCreate({ userId: jane }, passkeyVerified(await signedInHeaders(previous)));

      expect(await recorded()).toEqual([['mfa_verified', jane, { method: 'passkey' }]]);
      expectSetSince(await lastActiveAt(db, jane), start);
    });

    it('records one sign-in when the browser has no session of theirs', async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const bob = await createUser(db, 'bob@adiutor.test');
      const expired = await createSession(db, jane);
      await db
        .update(session)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(session.id, expired));

      const browsers = [
        new Headers(),
        await signedInHeaders(await createSession(db, jane), 'not-the-secret'),
        await signedInHeaders(expired),
        await signedInHeaders(await createSession(db, bob)),
      ];
      await inSequence(browsers, (headers) =>
        afterSessionCreate({ userId: jane }, passkeyVerified(headers)),
      );

      expect(await recorded()).toEqual(
        browsers.map(() => ['sign_in', jane, { method: 'passkey' }]),
      );
    });
  });
});

describe('creating a session', () => {
  it('stores an email code as it was, even for a role whose email codes don’t count', async () => {
    const testCompany = await createCompany(db);
    const admin = await memberActor(db, testCompany.id, 'admin');
    await enableTwoFactor(db, admin.id, 'email');
    const client = await createUser(db, 'client@adiutor.test');
    await addMember(db, testCompany.id, client, 'client');
    await enableTwoFactor(db, client, 'email');

    const results = await Promise.all(
      [admin.id, client].map((userId) =>
        beforeSessionCreate({ userId }, { path: '/two-factor/verify-otp', context: {} }),
      ),
    );

    expect(results.map(({ data }) => [data.mfaVerified, data.mfaMethod])).toEqual([
      [true, 'email_code'],
      [true, 'email_code'],
    ]);
  });

  it('records when a sign-in proved a second factor, and no time for one without', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);
    const start = new Date();

    const [withCode, withPasskey, withPassword, withLink] = await Promise.all(
      [
        '/two-factor/verify-totp',
        '/passkey/verify-authentication',
        '/sign-in/email',
        '/magic-link/verify',
      ].map((path) => beforeSessionCreate({ userId: jane }, { path, context: {} })),
    );

    expectSetSince(defined(withCode, 'the sign-in with a code').data.mfaVerifiedAt, start);
    expectSetSince(defined(withPasskey, 'the sign-in with a passkey').data.mfaVerifiedAt, start);
    expect(defined(withPassword, 'the sign-in with a password').data).toMatchObject({
      mfaVerified: false,
      mfaVerifiedAt: null,
    });
    expect(defined(withLink, 'the sign-in with an emailed link').data).toMatchObject({
      mfaVerified: false,
      mfaVerifiedAt: null,
    });
  });

  it('records no time when a code step replaces an unconfirmed session of an account with MFA', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPasskey(db, jane);
    const unconfirmed = await createSession(db, jane);

    // Turning on email codes from a session that didn't confirm with the passkey.
    const { data } = await beforeSessionCreate(
      { userId: jane },
      {
        path: '/two-factor/verify-otp',
        context: {
          session: {
            session: { id: unconfirmed, mfaVerified: false, mfaMethod: null },
            user: { id: jane, twoFactorEnabled: false },
          },
        },
      },
    );

    expect(data).toMatchObject({ mfaVerified: false, mfaMethod: null, mfaVerifiedAt: null });
  });

  it('confirms a code step that replaces an unconfirmed session when GitHub, the only MFA, can’t be used', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHub(db, jane);
    const unconfirmed = await createSession(db, jane);
    /**
     * Turns on an authenticator app from Jane's session, which didn't confirm with GitHub.
     *
     * @returns The new session's data.
     */
    const turnOn = async () =>
      (
        await beforeSessionCreate(
          { userId: jane },
          {
            path: '/two-factor/verify-totp',
            context: {
              session: {
                session: { id: unconfirmed, mfaVerified: false, mfaMethod: null },
                user: { id: jane, twoFactorEnabled: false },
              },
            },
          },
        )
      ).data;

    expect(await turnOn()).toMatchObject({ mfaVerified: false, mfaMethod: null });
    // Without GitHub sign-in, its 2FA wasn't MFA: the app is the account's first.
    turnOffGitHubSignIn();
    expect(await turnOn()).toMatchObject({ mfaVerified: true, mfaMethod: 'authenticator' });
  });

  it('keeps the confirmation of the session it replaces after turning off two-step verification or changing the password', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);
    const previous = await createSession(db, jane);
    const verifiedAt = minutesAgo(5);
    /**
     * Builds the context of a request made with Jane's session, confirmed
     * with her authenticator app five minutes ago.
     *
     * @param path - The endpoint path.
     * @param mfaVerifiedAt - The confirmation time as the session hands it over (Better Auth's
     *   cookie cache has it as a string).
     * @returns The context.
     */
    const withSession = (path: string, mfaVerifiedAt: Date | string): AuthHookContext => ({
      path,
      context: {
        session: {
          session: { id: previous, mfaVerified: true, mfaMethod: 'authenticator', mfaVerifiedAt },
          user: { id: jane, twoFactorEnabled: true },
        },
      },
    });

    const [disabled, changed, signedIn] = await Promise.all([
      beforeSessionCreate({ userId: jane }, withSession('/two-factor/disable', verifiedAt)),
      beforeSessionCreate(
        { userId: jane },
        withSession('/change-password', verifiedAt.toISOString()),
      ),
      // Any other new session is a sign-in of its own.
      beforeSessionCreate({ userId: jane }, withSession('/sign-in/email', verifiedAt)),
    ]);

    const kept = { mfaVerified: true, mfaMethod: 'authenticator', mfaVerifiedAt: verifiedAt };
    expect(disabled.data).toMatchObject(kept);
    expect(changed.data).toMatchObject(kept);
    expect(signedIn.data).toMatchObject({
      mfaVerified: false,
      mfaMethod: null,
      mfaVerifiedAt: null,
    });
  });

  describe('that replaces the signed-in one', () => {
    /** How long a session lasts, in milliseconds. */
    const LIFETIME_MS = 7 * 24 * 60 * 60_000;
    /** When the replaced session signed in: three days ago. */
    const signedInAt = minutesAgo(3 * 24 * 60);
    /** When the replaced session ends. */
    const endsAt = new Date(signedInAt.getTime() + LIFETIME_MS);

    /**
     * What Better Auth hands the hook for a new session: fresh times.
     *
     * @param userId - The new session's user.
     * @returns The session data.
     */
    const fresh = (userId: string) => ({
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + LIFETIME_MS),
    });

    /**
     * Builds the context of a request made with a session that signed in
     * three days ago.
     *
     * @param path - The endpoint path.
     * @param signedIn - The session's user and facts.
     * @param signedIn.userId - Its user.
     * @param signedIn.sessionId - Its ID.
     * @param signedIn.verifiedWith - Its second step, if any (five minutes ago).
     * @param signedIn.asStrings - Whether it hands its times over as strings
     *   (Better Auth's cookie cache has them so).
     * @returns The context.
     */
    const withSession = (
      path: string,
      signedIn: {
        userId: string;
        sessionId: string;
        verifiedWith?: MfaMethod;
        asStrings?: boolean;
      },
    ): AuthHookContext => ({
      path,
      context: {
        session: {
          session: {
            id: signedIn.sessionId,
            mfaVerified: Boolean(signedIn.verifiedWith),
            mfaMethod: signedIn.verifiedWith ?? null,
            mfaVerifiedAt: signedIn.verifiedWith ? minutesAgo(5) : null,
            createdAt: signedIn.asStrings ? signedInAt.toISOString() : signedInAt,
            expiresAt: signedIn.asStrings ? endsAt.toISOString() : endsAt,
          },
          user: { id: signedIn.userId, twoFactorEnabled: Boolean(signedIn.verifiedWith) },
        },
      },
    });

    it('keeps its sign-in time and end after changing the password or turning off two-step verification', async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      await enableTwoFactor(db, jane);
      const signedIn = {
        userId: jane,
        sessionId: await createSession(db, jane),
        verifiedWith: 'authenticator' as const,
      };
      const start = new Date();

      const [changed, disabled, other] = await Promise.all([
        beforeSessionCreate(fresh(jane), withSession('/change-password', signedIn)),
        beforeSessionCreate(
          fresh(jane),
          withSession('/two-factor/disable', { ...signedIn, asStrings: true }),
        ),
        // Any other new session is a sign-in of its own.
        beforeSessionCreate(fresh(jane), withSession('/sign-in/email', signedIn)),
      ]);

      // Not renewed: it still ends 7 days after the sign-in, and the one-hour rule still sees
      // a sign-in three days ago.
      const kept = { createdAt: signedInAt, expiresAt: endsAt };
      expect(changed.data).toMatchObject(kept);
      expect(disabled.data).toMatchObject(kept);
      expectSetSince(other.data.createdAt, start);
    });

    it('keeps its sign-in time and end when a code turns two-step verification on', async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const signedIn = { userId: jane, sessionId: await createSession(db, jane) };
      const start = new Date();

      const [withApp, withEmail] = await Promise.all(
        ['/two-factor/verify-totp', '/two-factor/verify-otp'].map((path) =>
          beforeSessionCreate(fresh(jane), withSession(path, signedIn)),
        ),
      );

      expect(defined(withApp, 'the sign-in with an authenticator app code').data).toMatchObject({
        createdAt: signedInAt,
        expiresAt: endsAt,
      });
      expect(defined(withEmail, 'the sign-in with an emailed code').data).toMatchObject({
        createdAt: signedInAt,
        expiresAt: endsAt,
      });
      // The code itself was proven just now.
      expectSetSince(
        defined(withApp, 'the sign-in with an authenticator app code').data.mfaVerifiedAt,
        start,
      );
    });

    it("never carries one user's session over to another user's", async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const sam = await createUser(db, 'sam@adiutor.test');
      await enableTwoFactor(db, sam);
      const samsSession = {
        userId: sam,
        sessionId: await createSession(db, sam),
        verifiedWith: 'authenticator' as const,
      };
      const start = new Date();

      const { data } = await beforeSessionCreate(
        fresh(jane),
        withSession('/change-password', samsSession),
      );

      expectSetSince(data.createdAt, start);
      expect(data).toMatchObject({ mfaVerified: false, mfaMethod: null, mfaVerifiedAt: null });
    });
  });
});
