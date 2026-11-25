/**
 * @file Runs Better Auth's real GitHub flows (the OAuth callback, with
 * GitHub's API stood in for) to check the contracts between its hooks that
 * the hook tests can't prove. The provider account's name is stored and
 * refreshed: Better Auth hands the profile only to `user.validateUserInfo`,
 * and the account hooks of the same request store it
 * (`noteProviderProfile`). "Confirm with GitHub" on the step-up page is
 * recorded as confirming the session: the session hook leaves it for the
 * reactions after the request (`afterSessionCreate`, `afterAuthRequest`),
 * which share the request's `ctx.context`; when GitHub's 2FA is off, the new
 * session keeps the earlier confirmation as it was. A plain GitHub sign-in on
 * a browser where someone else is signed in ends their session there
 * (`replacePreviousSession`). And it only accepts the user's own
 * confirmed GitHub account: the marker set before `/sign-in/social` rides
 * the OAuth state to the callback, where `user.validateUserInfo` refuses any
 * other account before anything is stored (`markReverify`, `checkReverify`).
 * A deactivated account is refused there too, after that check, so nothing
 * gets connected to it, verified or stored (`checkIncomingUser`).
 */
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { account, session as sessionTable, user } from '@/db/schema';
import { auth } from '@/lib/auth';
import { firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { REVERIFY_HINT } from '@/lib/sign-in/oauth-providers';
import { ACCOUNT_DEACTIVATED } from '@/lib/sign-in/sign-in-refusals';

import {
  createUser,
  queuedJobKinds,
  setupTestContext,
  auditEvents,
  addPassword,
  connectProvider,
} from '../../../tests/integration/helpers';
import { authRequest, cookieJar } from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

const { db } = setupTestContext();

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Stands in for GitHub: its token endpoint and its user API, answering with
 * the given profile (the real `fetch` for anything else).
 *
 * @param profile - What GitHub's `/user` answers.
 * @param profile.id - The GitHub account's ID.
 * @param profile.login - Its username.
 * @param profile.email - Its primary email address (verified).
 * @param twoFactor - Whether the account has two-factor authentication on.
 */
function mockGitHub(profile: { id: number; login?: string; email: string }, twoFactor = true) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === 'https://github.com/login/oauth/access_token') {
      return Response.json({
        access_token: 'adiutor-tests-github-token',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      });
    }
    if (url.href === 'https://api.github.com/user') {
      return Response.json({
        ...profile,
        name: 'Jane Tester',
        two_factor_authentication: twoFactor,
      });
    }
    if (url.href === 'https://api.github.com/user/emails') {
      return Response.json([{ email: profile.email, primary: true, verified: true }]);
    }
    return realFetch(input, init);
  });
}

/**
 * Reads the cookies a response sets, as a `Cookie` header would send them.
 *
 * @param response - The response.
 * @returns E.g. `a=1; b=2`.
 */
function cookiesOf(response: Response): string {
  const jar = cookieJar();
  jar.keep(response);
  return jar.cookie();
}

/** The password of the users who sign in with one. */
const PASSWORD = 'adiutor-tests-password';

/** Where "Confirm with GitHub" on the step-up page comes back to when it fails. */
const STEP_UP_ERROR_URL = '/auth/verify?callbackURL=%2Fdashboard&provider=github';

/**
 * What "Confirm with GitHub" on the step-up page sends with its sign-in
 * (`StepUpForm`): the hint, and the step-up page to come back to on failure.
 */
const REVERIFY = {
  errorCallbackURL: STEP_UP_ERROR_URL,
  additionalData: { [REVERIFY_HINT]: true },
};

/**
 * Starts a GitHub OAuth flow at a Better Auth endpoint, then calls back as
 * GitHub would, with the state cookie it set.
 *
 * @param path - `sign-in/social`, or `link-social` to connect it to the signed-in user.
 * @param cookie - The cookies to send, e.g. a session's.
 * @param body - More of the starting request's body, e.g. {@link REVERIFY}.
 * @returns The callback's response.
 */
async function githubFlow(
  path: string,
  cookie = '',
  body: Record<string, unknown> = {},
): Promise<Response> {
  const start = await authRequest(path, {
    body: { provider: 'github', callbackURL: '/dashboard', ...body },
    cookie,
  });
  expect(start.ok).toBe(true);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  const callbackCookie = [cookie, cookiesOf(start)].filter(Boolean).join('; ');
  return auth.handler(
    new Request(
      `${env.BETTER_AUTH_URL}/api/auth/callback/github?code=adiutor-tests-code&state=${state}`,
      { headers: { cookie: callbackCookie } },
    ),
  );
}

/**
 * Signs a user in with their password through Better Auth.
 *
 * @param email - Their address.
 * @param password - Their password.
 * @returns The session cookie.
 */
async function signInWithPassword(email: string, password: string): Promise<string> {
  const response = await authRequest('sign-in/email', { body: { email, password } });
  expect(response.ok).toBe(true);
  return cookiesOf(response);
}

/**
 * Checks that a callback finished without an error.
 *
 * @param response - The callback's response.
 */
function expectSucceeded(response: Response): void {
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).not.toContain('error');
}

/**
 * Reads the names of a user's GitHub accounts.
 *
 * @param userId - The user.
 * @returns Their stored `accountName`s.
 */
async function githubAccountNames(userId: string): Promise<(string | null)[]> {
  const rows = await db
    .select({ accountName: account.accountName })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')));
  return rows.map((row) => row.accountName);
}

describe('signing in with GitHub', () => {
  it('stores the username when it connects the account, and refreshes it at the next sign-in', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    mockGitHub({ id: 4242, login: 'adiutor-tests', email: 'jane@adiutor.test' });
    expectSucceeded(await githubFlow('sign-in/social'));
    expect(await githubAccountNames(jane)).toEqual(['adiutor-tests']);

    vi.restoreAllMocks();
    mockGitHub({ id: 4242, login: 'adiutor-tests-renamed', email: 'jane@adiutor.test' });
    expectSucceeded(await githubFlow('sign-in/social'));
    expect(await githubAccountNames(jane)).toEqual(['adiutor-tests-renamed']);
  });

  it('keeps the stored name when GitHub sends none, and never refuses the sign-in over it', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    mockGitHub({ id: 4242, login: 'adiutor-tests', email: 'jane@adiutor.test' });
    expectSucceeded(await githubFlow('sign-in/social'));

    vi.restoreAllMocks();
    mockGitHub({ id: 4242, email: 'jane@adiutor.test' });
    expectSucceeded(await githubFlow('sign-in/social'));

    expect(await githubAccountNames(jane)).toEqual(['adiutor-tests']);
  });
});

describe('signing in with GitHub to a deactivated account', () => {
  /** Where the sign-in page comes back to when a sign-in fails (`SignInForm`). */
  const SIGN_IN_ERROR_URL = '/auth?callbackURL=%2Fdashboard';

  /**
   * Creates Jane, deactivated, with an address staff registered and she
   * never verified.
   *
   * @returns Her ID.
   */
  async function deactivatedJane(): Promise<string> {
    const jane = await createUser(db, 'jane@adiutor.test');
    await db
      .update(user)
      .set({ deactivatedAt: new Date(), emailVerified: false })
      .where(eq(user.id, jane));
    return jane;
  }

  /**
   * Checks that the callback sent the browser back to the sign-in page with
   * the deactivated account's code and message, without signing it in.
   *
   * @param response - The callback's response.
   */
  function expectDeactivated(response: Response): void {
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    // Better Auth adds the error to the sign-in page's own query.
    expect(location).toMatch(/^\/auth\?callbackURL=%2Fdashboard&error=ACCOUNT_DEACTIVATED(&|$)/);
    expect(new URL(location, env.BETTER_AUTH_URL).searchParams.get('error_description')).toBe(
      ACCOUNT_DEACTIVATED.message,
    );
    expect(response.headers.getSetCookie().some((set) => set.includes('session_token='))).toBe(
      false,
    );
  }

  it('refuses a new GitHub account with her verified address before connecting it, verifying her address or storing a token', async () => {
    const jane = await deactivatedJane();

    mockGitHub({ id: 9999, login: 'adiutor-tests-planted', email: 'jane@adiutor.test' });
    expectDeactivated(
      await githubFlow('sign-in/social', '', { errorCallbackURL: SIGN_IN_ERROR_URL }),
    );

    // Nothing connected (so no token either), her address isn't marked verified, and no session.
    expect(await db.select().from(account)).toEqual([]);
    const found = firstRow(
      await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, jane)),
      'the user',
    );
    expect(found.emailVerified).toBe(false);
    expect(await db.select().from(sessionTable)).toEqual([]);
    expect(await auditEvents(db, { fields: ['action'] })).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedJobKinds(db)).toEqual([]);
  });

  it('refuses the GitHub account she connected before, without storing its token', async () => {
    const jane = await deactivatedJane();
    await db.insert(account).values({
      userId: jane,
      accountId: '4242',
      providerId: 'github',
      accountName: 'adiutor-tests',
    });
    const before = await db.select().from(account);

    mockGitHub({ id: 4242, login: 'adiutor-tests-renamed', email: 'jane@adiutor.test' });
    expectDeactivated(
      await githubFlow('sign-in/social', '', { errorCallbackURL: SIGN_IN_ERROR_URL }),
    );

    // Unchanged: no token, and the name it had.
    expect(await db.select().from(account)).toEqual(before);
    expect(await db.select().from(sessionTable)).toEqual([]);
  });
});

describe('connecting GitHub from the Security page', () => {
  it('stores the username of the account it connects, whatever its email address', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane, PASSWORD);
    const session = await signInWithPassword('jane@adiutor.test', PASSWORD);

    mockGitHub({ id: 5151, login: 'adiutor-tests-work', email: 'jane.work@adiutor.test' });
    expectSucceeded(await githubFlow('link-social', session));

    expect(await githubAccountNames(jane)).toEqual(['adiutor-tests-work']);
  });
});

describe('confirming a session with GitHub on the step-up page', () => {
  it('records that the session was confirmed, not another sign-in', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane, PASSWORD);
    // Her GitHub account, connected and confirmed earlier.
    await connectProvider(db, jane, { accountId: '4242', mfaVerified: false });
    const session = await signInWithPassword('jane@adiutor.test', PASSWORD);

    // "Confirm with GitHub" signs in with GitHub on the signed-in browser; GitHub says it has 2FA.
    mockGitHub({ id: 4242, login: 'adiutor-tests', email: 'jane@adiutor.test' });
    expectSucceeded(await githubFlow('sign-in/social', session, REVERIFY));

    const recorded = await auditEvents(db, { actorUserId: jane, fields: ['action', 'details'] });
    expect(recorded).toEqual([
      { action: 'sign_in', details: { method: 'password' } },
      { action: 'mfa_verified', details: { method: 'github' } },
    ]);
    // The confirmed session replaced the one the password started.
    expect(
      await db
        .select({ mfaVerified: sessionTable.mfaVerified, mfaMethod: sessionTable.mfaMethod })
        .from(sessionTable)
        .where(eq(sessionTable.userId, jane)),
    ).toEqual([{ mfaVerified: true, mfaMethod: 'github' }]);
  });

  it("keeps the session's earlier confirmation as it was when GitHub's 2FA is off", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane, PASSWORD);
    await connectProvider(db, jane, { accountId: '4242', mfaVerified: false });
    const session = await signInWithPassword('jane@adiutor.test', PASSWORD);
    // Confirmed with a passkey 20 minutes ago: too long ago to change how she signs in.
    const confirmedAt = new Date(Date.now() - 20 * 60_000);
    await db
      .update(sessionTable)
      .set({ mfaVerified: true, mfaMethod: 'passkey', mfaVerifiedAt: confirmedAt })
      .where(eq(sessionTable.userId, jane));

    mockGitHub({ id: 4242, login: 'adiutor-tests', email: 'jane@adiutor.test' }, false);
    expectSucceeded(await githubFlow('sign-in/social', session, REVERIFY));

    // A new session replaced hers, with the same confirmation: nothing taken away, nothing new.
    expect(
      await db
        .select({
          mfaVerified: sessionTable.mfaVerified,
          mfaMethod: sessionTable.mfaMethod,
          mfaVerifiedAt: sessionTable.mfaVerifiedAt,
        })
        .from(sessionTable)
        .where(eq(sessionTable.userId, jane)),
    ).toEqual([{ mfaVerified: true, mfaMethod: 'passkey', mfaVerifiedAt: confirmedAt }]);
  });
});

describe('"Confirm with GitHub" with another GitHub account than her own confirmed one', () => {
  /**
   * Sets up Jane with a password and her own confirmed GitHub account
   * (4242), and John with his (7777), and signs Jane in with her password.
   *
   * @returns Jane's and John's IDs, and Jane's session cookie.
   */
  async function janeSignedIn(): Promise<{ jane: string; john: string; session: string }> {
    const jane = await createUser(db, 'jane@adiutor.test');
    const john = await createUser(db, 'john@adiutor.test');
    await addPassword(db, jane, PASSWORD);
    await connectProvider(db, jane, { accountId: '4242' });
    await connectProvider(db, john, { accountId: '7777' });
    const session = await signInWithPassword('jane@adiutor.test', PASSWORD);
    return { jane, john, session };
  }

  /**
   * Reads what's stored about accounts and sessions, to tell that nothing changed.
   *
   * @returns The accounts (with whether they hold a token) and the sessions.
   */
  async function stored() {
    const accounts = await db
      .select({
        userId: account.userId,
        accountId: account.accountId,
        confirmed: account.confirmed,
        accountName: account.accountName,
      })
      .from(account)
      .orderBy(asc(account.accountId));
    const tokens = await db
      .select({ id: account.id })
      .from(account)
      .where(isNotNull(account.accessToken));
    const sessions = await db
      .select({
        id: sessionTable.id,
        userId: sessionTable.userId,
        mfaVerified: sessionTable.mfaVerified,
      })
      .from(sessionTable)
      .orderBy(asc(sessionTable.id));
    return { accounts, tokens, sessions };
  }

  /**
   * Reads the audit log after the password sign-in.
   *
   * @returns The events' action, user and details, oldest first.
   */
  async function recordedSinceSignIn() {
    const rows = await auditEvents(db, { fields: ['action', 'actorUserId', 'details'] });
    return rows.filter((row) => row.action !== 'sign_in' || row.details.method !== 'password');
  }

  /**
   * Checks that the callback sent the browser back to the step-up page with
   * the refusal, without setting a session cookie.
   *
   * @param response - The callback's response.
   */
  function expectRefused(response: Response): void {
    expect(response.status).toBe(302);
    // Better Auth adds the error to the step-up page's own query.
    expect(response.headers.get('location')).toMatch(
      /^\/auth\/verify\?callbackURL=%2Fdashboard&provider=github&error=REVERIFY_WRONG_ACCOUNT(&|$)/,
    );
    expect(response.headers.getSetCookie().some((set) => set.includes('session_token='))).toBe(
      false,
    );
  }

  it.each([
    // Whoever controls her inbox could create one.
    ['a new GitHub account with her email address', { id: 9999, email: 'jane@adiutor.test' }],
    ["John's GitHub account", { id: 7777, email: 'john@adiutor.test' }],
  ])(
    'refuses %s: nothing is connected, stored or sent, and she stays signed in as herself',
    async (_, profile) => {
      const { jane, session } = await janeSignedIn();
      const before = await stored();

      mockGitHub({ ...profile, login: 'adiutor-tests-other' });
      expectRefused(await githubFlow('sign-in/social', session, REVERIFY));

      expect(await stored()).toEqual(before);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await queuedJobKinds(db)).toEqual([]);
      expect(await recordedSinceSignIn()).toEqual([
        {
          action: 'mfa_failed',
          actorUserId: jane,
          details: { method: 'github', reason: 'different_account' },
        },
      ]);
    },
  );

  it('refuses one of her own GitHub accounts that she hasn’t confirmed', async () => {
    const { jane, session } = await janeSignedIn();
    await db.insert(account).values({
      userId: jane,
      accountId: '5555',
      providerId: 'github',
      mfaVerified: true,
      confirmed: false,
    });
    const before = await stored();

    mockGitHub({ id: 5555, login: 'adiutor-tests-unconfirmed', email: 'jane@adiutor.test' });
    expectRefused(await githubFlow('sign-in/social', session, REVERIFY));

    expect(await stored()).toEqual(before);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedJobKinds(db)).toEqual([]);
    expect(await recordedSinceSignIn()).toEqual([
      {
        action: 'mfa_failed',
        actorUserId: jane,
        details: { method: 'github', reason: 'different_account' },
      },
    ]);
  });

  it("refuses John's GitHub account as another account when John is deactivated, saying nothing about him", async () => {
    const { john, session } = await janeSignedIn();
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, john));
    const before = await stored();

    mockGitHub({ id: 7777, login: 'adiutor-tests-john', email: 'john@adiutor.test' });
    expectRefused(await githubFlow('sign-in/social', session, REVERIFY));

    expect(await stored()).toEqual(before);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await queuedJobKinds(db)).toEqual([]);
  });

  describe('without the hint (a plain sign-in with GitHub), as before', () => {
    it('connects a new GitHub account with her email address and signs her in', async () => {
      const { jane, session } = await janeSignedIn();

      mockGitHub({ id: 9999, login: 'adiutor-tests-new', email: 'jane@adiutor.test' });
      expectSucceeded(await githubFlow('sign-in/social', session));

      expect(
        await db
          .select({ userId: account.userId })
          .from(account)
          .where(eq(account.accountId, '9999')),
      ).toEqual([{ userId: jane }]);
      expect((await recordedSinceSignIn()).map(({ action }) => action)).toEqual([
        'provider_connected',
        'sign_in',
      ]);
    });

    it("signs the browser in as John with John's GitHub account, which ends Jane's session there", async () => {
      const { jane, john, session } = await janeSignedIn();

      mockGitHub({ id: 7777, login: 'adiutor-tests-john', email: 'john@adiutor.test' });
      expectSucceeded(await githubFlow('sign-in/social', session));

      expect(await recordedSinceSignIn()).toEqual([
        { action: 'sign_in', actorUserId: john, details: { method: 'github' } },
      ]);
      // As if she had signed out there.
      expect(await db.select().from(sessionTable).where(eq(sessionTable.userId, jane))).toEqual([]);
    });

    it('signs her in with her own GitHub account that she hasn’t confirmed', async () => {
      const { jane, session } = await janeSignedIn();
      await db.insert(account).values({
        userId: jane,
        accountId: '5555',
        providerId: 'github',
        confirmed: false,
      });

      mockGitHub({ id: 5555, login: 'adiutor-tests-unconfirmed', email: 'jane@adiutor.test' });
      expectSucceeded(await githubFlow('sign-in/social', session));

      expect(await recordedSinceSignIn()).toEqual([
        { action: 'sign_in', actorUserId: jane, details: { method: 'github' } },
      ]);
    });
  });
});
