/**
 * @file Integration tests for refusing a re-verify with another account, and the
 * user an incoming identity is for.
 */
import { getOAuthState } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { account, session, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';
import { PROVIDER_STEP_UP_COOKIE } from '@/lib/sign-in/oauth-providers';

import {
  createSession,
  createUser,
  inSequence,
  queuedJobKinds,
} from '../../../../tests/integration/helpers';
import { afterAuthRequest } from './after-request';
import { checkIncomingUser, checkReverify, type IncomingUserInfo } from './reverify';
import { beforeSessionCreate } from './session-hooks';
import {
  db,
  githubCallback,
  markReverify,
  signedInHeaders,
  events,
  mockGitHubApi,
  sessionMfa,
  minutesAgo,
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

describe('refusing a re-verify with another account', () => {
  /** Jane's GitHub account's ID at GitHub. */
  const JANE_GITHUB = 4242;

  /**
   * Connects a GitHub account by its ID at GitHub, as Better Auth stores it.
   *
   * @param userId - The user.
   * @param githubId - The account's ID at GitHub.
   * @param options - Optional details.
   * @param options.confirmed - Whether it counts yet; defaults to `true`.
   * @param options.accessToken - A token left from an earlier request, if any.
   * @returns The account row's ID.
   */
  async function connectGitHubAccount(
    userId: string,
    githubId: number,
    options: { confirmed?: boolean; accessToken?: string } = {},
  ): Promise<string> {
    const created = firstRow(
      await db
        .insert(account)
        .values({
          userId,
          accountId: String(githubId),
          providerId: 'github',
          mfaVerified: true,
          confirmed: options.confirmed ?? true,
          accessToken: options.accessToken,
        })
        .returning({ id: account.id }),
      'the new account',
    );
    return created.id;
  }

  /**
   * What Better Auth hands `user.validateUserInfo` at a GitHub callback.
   *
   * @param resolvedUserId - The Adiutor user Better Auth resolved.
   * @param action - `sign-in` with a connected account, `link-account` for a new one.
   * @param githubId - The GitHub account's ID; none leaves it out of the profile.
   * @returns The user info.
   */
  function githubUserInfo(
    resolvedUserId: string,
    action: 'sign-in' | 'link-account',
    githubId?: number,
  ): IncomingUserInfo {
    return {
      user: { id: resolvedUserId },
      source: {
        method: 'oauth',
        action,
        oauth: { providerId: 'github', profile: { id: githubId, login: 'adiutor-tests' } },
      },
    };
  }

  /**
   * Runs the check of a GitHub callback, and the reactions after it, with one
   * context, as Better Auth does when it refuses: no session is created.
   *
   * @param info - What Better Auth hands over.
   * @param headers - The browser's request headers.
   * @returns What the check returned.
   */
  async function refusedOrNot(info: IncomingUserInfo, headers: Headers) {
    const { ctx } = githubCallback(headers);
    const result = await checkReverify(info, ctx);
    await afterAuthRequest(ctx);
    // Better Auth's after hooks run once per request; a second run records nothing more.
    await afterAuthRequest(ctx);
    return result;
  }

  /**
   * The event a refused re-verify records for the user who started it.
   *
   * @param userId - That user.
   * @returns The event's recorded fields.
   */
  const failedConfirmation = (userId: string) => ({
    action: 'mfa_failed',
    actorUserId: userId,
    targetUserId: userId,
    details: { method: 'github', reason: 'different_account' },
  });

  const refused = { error: 'REVERIFY_WRONG_ACCOUNT' };

  it("lets Jane's own confirmed GitHub account confirm her session, recording nothing yet", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubAccount(jane, JANE_GITHUB);
    const current = await createSession(db, jane);
    markReverify(jane, current);

    expect(
      await refusedOrNot(
        githubUserInfo(jane, 'sign-in', JANE_GITHUB),
        await signedInHeaders(current),
      ),
    ).toBeUndefined();
    expect(await events()).toEqual([]);
  });

  it.each<[string, (jane: string) => Promise<[string, 'sign-in' | 'link-account']>]>([
    [
      'a new GitHub account with her email address, which Better Auth would connect',
      async (jane) => [jane, 'link-account'],
    ],
    [
      "another user's GitHub account, which would sign the browser in as them",
      async () => {
        const john = await createUser(db, 'john@adiutor.test');
        await connectGitHubAccount(john, JANE_GITHUB);
        return [john, 'sign-in'];
      },
    ],
    [
      'one of her own GitHub accounts that she hasn’t confirmed',
      async (jane) => {
        await connectGitHubAccount(jane, JANE_GITHUB, { confirmed: false });
        return [jane, 'sign-in'];
      },
    ],
  ])('refuses %s, and records a failed confirmation for Jane once', async (_, signedInWith) => {
    const jane = await createUser(db, 'jane@adiutor.test');
    // Her own confirmed GitHub account is a different one.
    await connectGitHubAccount(jane, 1);
    const current = await createSession(db, jane);
    markReverify(jane, current);
    const [resolved, action] = await signedInWith(jane);

    expect(
      await refusedOrNot(
        githubUserInfo(resolved, action, JANE_GITHUB),
        await signedInHeaders(current),
      ),
    ).toEqual(refused);
    expect(await events()).toEqual([failedConfirmation(jane)]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedJobKinds(db)).toEqual([]);
  });

  it('refuses her own confirmed account once the browser no longer has the session it confirms', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const bob = await createUser(db, 'bob@adiutor.test');
    await connectGitHubAccount(jane, JANE_GITHUB);
    const started = await createSession(db, jane);
    markReverify(jane, started);

    const results = await inSequence(
      [
        new Headers(),
        await signedInHeaders(started, 'not-the-secret'),
        await signedInHeaders(await createSession(db, jane)),
        await signedInHeaders(await createSession(db, bob)),
      ],
      (headers) => refusedOrNot(githubUserInfo(jane, 'sign-in', JANE_GITHUB), headers),
    );

    expect(results).toEqual([refused, refused, refused, refused]);
    expect(await events()).toEqual(Array.from({ length: 4 }, () => failedConfirmation(jane)));
  });

  it('refuses a profile without an account ID, which finds no account', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await connectGitHubAccount(jane, JANE_GITHUB);
    const current = await createSession(db, jane);
    markReverify(jane, current);

    expect(
      await refusedOrNot(githubUserInfo(jane, 'sign-in'), await signedInHeaders(current)),
    ).toEqual(refused);
  });

  it('leaves every sign-in that isn’t a re-verify to Better Auth, whatever its account', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubAccount(john, JANE_GITHUB);
    const current = await createSession(db, jane);

    const results = await inSequence(
      [
        githubUserInfo(jane, 'link-account', JANE_GITHUB),
        githubUserInfo(john, 'sign-in', JANE_GITHUB),
        githubUserInfo(jane, 'sign-in'),
      ],
      async (info) => refusedOrNot(info, await signedInHeaders(current)),
    );

    expect(results).toEqual([undefined, undefined, undefined]);
    expect(await events()).toEqual([]);
  });

  it("doesn't ask GitHub about a refused re-verify, and still forgets tokens left behind", async () => {
    const fetchSpy = mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    // A token an earlier request left (the hourly clean-up would clear it).
    const leftOver = await connectGitHubAccount(jane, 1, { accessToken: 'jane-token' });
    const current = await createSession(db, jane);
    markReverify(jane, current);

    expect(
      await refusedOrNot(
        githubUserInfo(jane, 'link-account', JANE_GITHUB),
        await signedInHeaders(current),
      ),
    ).toEqual(refused);

    expect(fetchSpy).not.toHaveBeenCalled();
    const stored = firstRow(
      await db
        .select({ accessToken: account.accessToken })
        .from(account)
        .where(eq(account.id, leftOver)),
      'the account',
    );
    expect(stored.accessToken).toBeNull();
    expect(await sessionMfa(current)).toEqual({ mfaVerified: false, mfaMethod: null });
  });

  describe('the backstop when the session is created', () => {
    it("refuses a re-verify's session for another user, before saying anything about them", async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const john = await createUser(db, 'john@adiutor.test');
      await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, john));
      const current = await createSession(db, jane);
      markReverify(jane, current);
      const { ctx } = githubCallback(await signedInHeaders(current));

      await expect(beforeSessionCreate({ userId: john }, ctx)).rejects.toEqual(
        expect.objectContaining({
          statusCode: 403,
          body: expect.objectContaining({ code: 'REVERIFY_WRONG_ACCOUNT' }),
        }),
      );
      await afterAuthRequest(ctx);

      expect(await events()).toEqual([failedConfirmation(jane)]);
    });

    it("lets the re-verifying user's own session through", async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const current = await createSession(db, jane);
      markReverify(jane, current);

      await expect(
        beforeSessionCreate({ userId: jane }, githubCallback(await signedInHeaders(current)).ctx),
      ).resolves.toEqual({
        data: { userId: jane, mfaVerified: false, mfaMethod: null, mfaVerifiedAt: null },
      });
    });

    it('gives it the confirmation of the session it replaces, as it was', async () => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const current = await createSession(db, jane);
      const confirmedAt = minutesAgo(20);
      await storeSessionMfa(current, 'passkey', confirmedAt);
      markReverify(jane, current);

      await expect(
        beforeSessionCreate({ userId: jane }, githubCallback(await signedInHeaders(current)).ctx),
      ).resolves.toEqual({
        data: { userId: jane, mfaVerified: true, mfaMethod: 'passkey', mfaVerifiedAt: confirmedAt },
      });
    });

    it.each([
      ['without a re-verify (a plain sign-in with GitHub)', 'none'],
      ['without a session cookie', 'no-cookie'],
      ['with a forged session cookie', 'forged'],
      ['when the browser has another session than the one marked', 'other-session'],
      ['when the marked session expired', 'expired'],
    ] as const)('keeps no earlier confirmation %s', async (_, browser) => {
      const jane = await createUser(db, 'jane@adiutor.test');
      const marked = await createSession(db, jane);
      const other = await createSession(db, jane);
      await storeSessionMfa(marked, 'passkey', minutesAgo(20));
      await storeSessionMfa(other, 'passkey', minutesAgo(20));
      if (browser !== 'none') {
        markReverify(jane, marked);
      }
      if (browser === 'expired') {
        await db
          .update(session)
          .set({ expiresAt: sql`now() - interval '1 minute'` })
          .where(eq(session.id, marked));
      }
      let headers = new Headers();
      if (browser === 'forged') {
        headers = await signedInHeaders(marked, 'not-the-secret');
      } else if (browser === 'other-session') {
        headers = await signedInHeaders(other);
      } else if (browser !== 'no-cookie') {
        headers = await signedInHeaders(marked);
      }

      await expect(
        beforeSessionCreate({ userId: jane }, githubCallback(headers).ctx),
      ).resolves.toEqual({
        data: { userId: jane, mfaVerified: false, mfaMethod: null, mfaVerifiedAt: null },
      });
    });
  });

  it("drops an earlier attempt's notice when it refuses, and sets none without one", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    // Her own confirmed GitHub account is a different one.
    await connectGitHubAccount(jane, 1);
    const current = await createSession(db, jane);

    /**
     * Refuses a new GitHub account answering Jane's re-verify on a browser.
     *
     * @param earlierNotice - Whether the browser still has an earlier attempt's notice cookie.
     * @returns What the response did with that cookie: `''` when it removed it.
     */
    const stepUpCookieSetBy = async (earlierNotice: boolean) => {
      markReverify(jane, current);
      const headers = await signedInHeaders(current);
      if (earlierNotice) {
        const cookie = `${PROVIDER_STEP_UP_COOKIE}=${encodeURIComponent('github:unchecked')}`;
        headers.set('cookie', `${headers.get('cookie')}; ${cookie}`);
      }
      const { ctx, setCookie } = githubCallback(headers);
      expect(await checkReverify(githubUserInfo(jane, 'link-account', JANE_GITHUB), ctx)).toEqual(
        refused,
      );
      await afterAuthRequest(ctx);
      return setCookie.mock.calls
        .filter(([name]) => name === PROVIDER_STEP_UP_COOKIE)
        .map(([, value]) => value);
    };

    // Otherwise the old reason would show next to the refusal's own message.
    expect(await stepUpCookieSetBy(true)).toEqual(['']);
    expect(await stepUpCookieSetBy(false)).toEqual([]);
    expect(await events()).toEqual([failedConfirmation(jane), failedConfirmation(jane)]);
  });
});

describe('checking the user an incoming identity is for', () => {
  /**
   * What Better Auth hands `user.validateUserInfo` at a GitHub callback.
   *
   * @param resolvedUserId - The Adiutor user Better Auth resolved, if any.
   * @param action - `sign-in` with a connected account, `link-account` for a new one.
   * @returns The user info.
   */
  function githubUserInfo(
    resolvedUserId: string | undefined,
    action: 'sign-in' | 'link-account',
  ): IncomingUserInfo {
    return {
      user: { id: resolvedUserId },
      source: {
        method: 'oauth',
        action,
        oauth: { providerId: 'github', profile: { id: 4242, login: 'adiutor-tests' } },
      },
    };
  }

  /**
   * Deactivates a user.
   *
   * @param userId - The user.
   */
  async function deactivate(userId: string): Promise<void> {
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));
  }

  /** The refusal for a deactivated user, with the message the sign-in page shows. */
  const deactivated = {
    error: 'ACCOUNT_DEACTIVATED',
    errorDescription: 'This account is deactivated. Contact an administrator.',
  };

  it.each(['link-account', 'sign-in'] as const)(
    'refuses a deactivated user (%s), recording nothing',
    async (action) => {
      const jane = await createUser(db, 'jane@adiutor.test');
      await deactivate(jane);
      const { ctx } = githubCallback(new Headers());

      expect(await checkIncomingUser(githubUserInfo(jane, action), ctx)).toEqual(deactivated);
      await afterAuthRequest(ctx);
      expect(await events()).toEqual([]);
    },
  );

  it('lets an active user through, and an identity without a user yet', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const { ctx } = githubCallback(new Headers());

    expect(await checkIncomingUser(githubUserInfo(jane, 'link-account'), ctx)).toBeUndefined();
    expect(await checkIncomingUser(githubUserInfo(undefined, 'sign-in'), ctx)).toBeUndefined();
  });

  it('refuses a re-verify with another user’s account as that, before saying they’re deactivated', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    await db
      .insert(account)
      .values({ userId: john, accountId: '4242', providerId: 'github', mfaVerified: true });
    await deactivate(john);
    const current = await createSession(db, jane);
    markReverify(jane, current);
    const { ctx } = githubCallback(await signedInHeaders(current));

    expect(await checkIncomingUser(githubUserInfo(john, 'sign-in'), ctx)).toEqual({
      error: 'REVERIFY_WRONG_ACCOUNT',
    });
  });

  it('refuses a re-verify’s own user when they were deactivated meanwhile', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db
      .insert(account)
      .values({ userId: jane, accountId: '4242', providerId: 'github', mfaVerified: true });
    const current = await createSession(db, jane);
    markReverify(jane, current);
    await deactivate(jane);
    const { ctx } = githubCallback(await signedInHeaders(current));

    expect(await checkIncomingUser(githubUserInfo(jane, 'sign-in'), ctx)).toEqual(deactivated);
  });
});
