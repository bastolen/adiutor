/**
 * @file Integration tests for connecting and disconnecting provider accounts,
 * also at sign-in.
 */
import { getOAuthState } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { user } from '@/db/schema';
import { defined } from '@/lib/defined';
import { sendEmail } from '@/lib/email';
import { PROVIDER_LINKED_COOKIE } from '@/lib/sign-in/oauth-providers';

import {
  addPassword,
  connectGitHub,
  createCompany,
  createSession,
  createUser,
  enableTwoFactor,
  inSequence,
  memberActor,
  staffActor,
  turnOffGitHubSignIn,
} from '../../../../tests/integration/helpers';
import { holdSignInChangeLock, releaseSignInChangeLockOf } from '../auth-guards';
import { releaseSignInChangeLock, takeSignInChangeLock } from '../sign-in-change-lock';
import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import { afterAccountCreate, afterAccountDelete, beforeAccountCreate } from './provider-accounts';
import {
  db,
  events,
  subjects,
  githubCallback,
  storeSessionMfa,
  signedInHeaders,
  minutesAgo,
  addPasskey,
  mockGitHubApi,
  connectGitHubWithToken,
} from './test-helpers';
import { afterUserUpdate, beforeUserUpdate } from './user-hooks';

vi.mock('@/db', async (importOriginal) =>
  (await import('../../../../tests/integration/app-modules')).default(await importOriginal()),
);

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

describe('disconnecting a provider', () => {
  it('records and names the provider', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    await afterAccountDelete(
      { userId: jane, providerId: 'github' },
      { path: '/unlink-account', headers: new Headers(), context: {} },
    );

    expect(await events()).toEqual([
      {
        action: 'provider_disconnected',
        actorUserId: jane,
        targetUserId: jane,
        details: { providerId: 'github' },
      },
    ]);
    expect(subjects()).toEqual(['GitHub was disconnected from your Adiutor account']);
  });

  it('ignores accounts removed in other ways', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');

    await afterAccountDelete(
      { userId: jane, providerId: 'credential' },
      { path: '/magic-link/verify', headers: new Headers(), context: {} },
    );
    await afterAccountDelete({ userId: jane, providerId: 'github' }, null);

    expect(await events()).toEqual([]);
    expect(subjects()).toEqual([]);
  });
});

describe('connecting a provider account', () => {
  /**
   * Decides whether a connected account counts, as the account hook does,
   * then gives back the lock it may have taken (`holdSignInChangeLock`), as
   * the reactions after the request do.
   *
   * @param data - The account about to be created.
   * @param ctx - The endpoint creating it.
   * @returns The account data to store.
   */
  const decide = async <T extends { userId: string; providerId: string }>(
    data: T,
    ctx: AuthHookContext | null,
  ) => {
    const result = await beforeAccountCreate(data, ctx);
    if (ctx) {
      await releaseSignInChangeLockOf({ context: ctx.context });
    }
    return result;
  };

  /**
   * The GitHub account Better Auth is about to create for a user.
   *
   * @param userId - The user.
   * @returns The account data.
   */
  const githubAccount = (userId: string) => ({
    userId,
    providerId: 'github',
    accountId: 'adiutor-tests-github',
  });

  it('counts right away on an account without a second step', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    const data = githubAccount(jane);

    const result = await decide(data, githubCallback().ctx);

    expect(result).toEqual({ data });
    expect(result.data).not.toHaveProperty('confirmed');
  });

  it('waits for confirmation when connected at sign-in to an account with a second step', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const data = githubAccount(jane);

    expect(await decide(data, githubCallback().ctx)).toEqual({
      data: { ...data, confirmed: false },
    });
    // Without any request context (e.g. a script), it isn't confirmed either.
    expect(await decide(data, null)).toEqual({ data: { ...data, confirmed: false } });
  });

  it('counts right away when connected from a session confirmed with the second step', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const confirmedSession = await createSession(db, jane);
    await storeSessionMfa(confirmedSession, 'authenticator');
    const data = githubAccount(jane);

    expect(await decide(data, githubCallback(await signedInHeaders(confirmedSession)).ctx)).toEqual(
      { data: { ...data, confirmed: true } },
    );
  });

  it('waits for confirmation while another change to how the user signs in is being made', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const confirmedSession = await createSession(db, jane);
    await storeSessionMfa(confirmedSession, 'authenticator');
    const data = githubAccount(jane);
    const held = await takeSignInChangeLock({ db }, jane);

    const { ctx } = githubCallback(await signedInHeaders(confirmedSession));
    expect(await beforeAccountCreate(data, ctx)).toEqual({ data: { ...data, confirmed: false } });

    await releaseSignInChangeLock({ db }, defined(held, 'the sign-in change lock'));
    const next = githubCallback(await signedInHeaders(confirmedSession)).ctx;
    expect(await beforeAccountCreate(data, next)).toEqual({ data: { ...data, confirmed: true } });
    // Held until the request is done, then given back.
    expect(await takeSignInChangeLock({ db }, jane)).toBeNull();
    await afterAuthRequest({ ...next, context: next.context });
    expect(await takeSignInChangeLock({ db }, jane)).not.toBeNull();
  });

  it('decides under the lock the request holds already', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const confirmedSession = await createSession(db, jane);
    await storeSessionMfa(confirmedSession, 'authenticator');
    const data = githubAccount(jane);
    const { ctx } = githubCallback(await signedInHeaders(confirmedSession));
    expect(await holdSignInChangeLock(ctx, jane)).toBe(true);

    expect(await beforeAccountCreate(data, ctx)).toEqual({ data: { ...data, confirmed: true } });
  });

  it("waits when the session cookie's signature doesn't check out (a token read from the database)", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const confirmedSession = await createSession(db, jane);
    await storeSessionMfa(confirmedSession, 'authenticator');
    const data = githubAccount(jane);

    const forged = await signedInHeaders(confirmedSession, 'not-the-secret');

    expect(await decide(data, githubCallback(forged).ctx)).toEqual({
      data: { ...data, confirmed: false },
    });
  });

  it("waits when the session isn't confirmed, has expired or isn't the user's own", async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const unconfirmed = await createSession(db, jane);
    const expired = await createSession(db, jane, { expiresAt: new Date(Date.now() - 1000) });
    await storeSessionMfa(expired, 'authenticator');
    const john = await createUser(db, 'john@adiutor.test');
    await enableTwoFactor(db, john);
    const johnsSession = await createSession(db, john);
    await storeSessionMfa(johnsSession, 'authenticator');
    const data = githubAccount(jane);

    // One after another: at the same moment, all but one would wait for the user's lock anyway.
    const results = await inSequence([unconfirmed, expired, johnsSession], async (sessionId) =>
      decide(data, githubCallback(await signedInHeaders(sessionId)).ctx),
    );

    expect(results.map((result) => result.data.confirmed)).toEqual([false, false, false]);
  });

  it('only counts right away within 15 minutes of the session’s confirmation', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    const recent = await createSession(db, jane, {
      mfaMethod: 'authenticator',
      mfaVerifiedAt: minutesAgo(14),
    });
    // E.g. a stolen session: it can't make the thief's GitHub account count by connecting it.
    const stale = await createSession(db, jane, {
      mfaMethod: 'authenticator',
      mfaVerifiedAt: minutesAgo(16),
    });
    const data = githubAccount(jane);

    const results = await inSequence([recent, stale], async (sessionId) =>
      decide(data, githubCallback(await signedInHeaders(sessionId)).ctx),
    );

    expect(results.map((result) => result.data.confirmed)).toEqual([true, false]);
  });

  it('waits when connected from a trusted device, which proved nothing at its sign-in', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    // Even with a time stored for it (`markSessionVerified` stores none).
    const trusted = await createSession(db, jane, {
      mfaMethod: 'trusted_device',
      mfaVerifiedAt: new Date(),
    });

    const result = await decide(
      githubAccount(jane),
      githubCallback(await signedInHeaders(trusted)).ctx,
    );

    expect(result.data.confirmed).toBe(false);
  });

  it('only accepts a session confirmed with a step that counts for the user’s role', async () => {
    const testCompany = await createCompany(db);
    // A Client may use email codes; a company Admin's email codes don't count (a passkey does).
    const client = await memberActor(db, testCompany.id, 'client');
    await enableTwoFactor(db, client.id, 'email');
    const clientSession = await createSession(db, client.id);
    await storeSessionMfa(clientSession, 'email_code');
    const admin = await memberActor(db, testCompany.id, 'admin');
    await enableTwoFactor(db, admin.id, 'email');
    await addPasskey(admin.id);
    const adminSession = await createSession(db, admin.id);
    await storeSessionMfa(adminSession, 'email_code');

    const forClient = await decide(
      githubAccount(client.id),
      githubCallback(await signedInHeaders(clientSession)).ctx,
    );
    const forAdmin = await decide(
      githubAccount(admin.id),
      githubCallback(await signedInHeaders(adminSession)).ctx,
    );

    expect(forClient.data.confirmed).toBe(true);
    expect(forAdmin.data.confirmed).toBe(false);
  });

  it('waits, even from a recently confirmed session, when counting it would take away required MFA', async () => {
    // Staff who sign in only with GitHub (2FA on, no password): Google next to it would stop
    // GitHub counting as MFA, which an Admin's role requires and a Support user's doesn't.
    const [admin, support] = await Promise.all([
      staffActor(db, 'platform_admin'),
      staffActor(db, 'support'),
    ]);
    const results = await Promise.all(
      [admin.id, support.id].map(async (userId) => {
        await connectGitHub(db, userId);
        const recent = await createSession(db, userId, {
          mfaMethod: 'github',
          mfaVerifiedAt: minutesAgo(1),
        });
        // Signing in with Google in the browser of that session links it.
        const { ctx } = githubCallback(await signedInHeaders(recent));
        return decide(
          { userId, providerId: 'google', accountId: 'adiutor-tests-google' },
          { ...ctx, params: { id: 'google' } },
        );
      }),
    );

    expect(results.map((result) => result.data.confirmed)).toEqual([false, true]);
  });

  it('waits when connected from a session confirmed with GitHub next to a passkey, which opens no window', async () => {
    // Support users who sign in with GitHub (2FA on, no password): Google next to it takes nothing
    // their role requires, so only the window decides.
    const [withPasskey, githubOnly] = await Promise.all([
      staffActor(db, 'support'),
      staffActor(db, 'support'),
    ]);
    await addPasskey(withPasskey.id);
    const results = await inSequence([withPasskey.id, githubOnly.id], async (userId) => {
      await connectGitHub(db, userId);
      const viaGitHub = await createSession(db, userId, {
        mfaMethod: 'github',
        mfaVerifiedAt: minutesAgo(1),
      });
      const { ctx } = githubCallback(await signedInHeaders(viaGitHub));
      return decide(
        { userId, providerId: 'google', accountId: 'adiutor-tests-google' },
        { ...ctx, params: { id: 'google' } },
      );
    });

    expect(results.map((result) => result.data.confirmed)).toEqual([false, true]);
  });

  it('counts right away while GitHub sign-in is off, when GitHub with 2FA was the only second step', async () => {
    // GitHub can't be used then, so the account has no second step to protect yet.
    turnOffGitHubSignIn();
    const admin = await staffActor(db, 'platform_admin');
    await connectGitHub(db, admin.id);
    const data = { userId: admin.id, providerId: 'google', accountId: 'adiutor-tests-google' };

    const result = await decide(data, {
      ...githubCallback().ctx,
      params: { id: 'google' },
    });

    expect(result).toEqual({ data });
  });

  it('leaves passwords alone', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);
    const data = { userId: jane, providerId: 'credential', accountId: jane };

    expect(await decide(data, { path: '/reset-password', context: {} })).toEqual({
      data,
    });
  });
});

describe('a provider connected at sign-in', () => {
  it('is recorded as unconfirmed, and the next page is told', async () => {
    mockGitHubApi({ 'jane-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);
    const github = await connectGitHubWithToken(jane, 'jane-token', { confirmed: false });
    const { ctx, setCookie } = githubCallback();

    await afterAccountCreate(
      { id: github, userId: jane, providerId: 'github', confirmed: false },
      ctx,
    );

    expect(await events()).toEqual([
      {
        action: 'provider_connected',
        actorUserId: jane,
        targetUserId: jane,
        details: { providerId: 'github', atSignIn: true, confirmed: false },
      },
    ]);
    expect(setCookie).toHaveBeenCalledOnce();
    expect(setCookie).toHaveBeenCalledWith(
      PROVIDER_LINKED_COOKIE,
      'github',
      expect.objectContaining({ maxAge: 300, path: '/', httpOnly: false, sameSite: 'lax' }),
    );
    expect(PROVIDER_LINKED_COOKIE).toBe('adiutor-provider-linked');
    expect(subjects()).toEqual(['GitHub was connected to your Adiutor account']);
  });

  it('is recorded as confirmed when it counted right away', async () => {
    mockGitHubApi({});
    const john = await createUser(db, 'john@adiutor.test');
    const github = await connectGitHubWithToken(john, 'john-token');
    const { ctx, setCookie } = githubCallback();

    await afterAccountCreate(
      { id: github, userId: john, providerId: 'github', confirmed: true },
      ctx,
    );

    expect((await events()).map((event) => event.details)).toEqual([
      { providerId: 'github', atSignIn: true, confirmed: true },
    ]);
    expect(setCookie).toHaveBeenCalledWith(PROVIDER_LINKED_COOKIE, 'github', expect.anything());
  });

  it('is recorded without the sign-in facts or the next-page notice when connected from the Security page', async () => {
    mockGitHubApi({});
    const jane = await createUser(db, 'jane@adiutor.test');
    const own = await createSession(db, jane);
    const github = await connectGitHubWithToken(jane, 'jane-token');
    const { ctx, setCookie } = githubCallback(await signedInHeaders(own));

    await afterAccountCreate(
      { id: github, userId: jane, providerId: 'github', confirmed: true },
      ctx,
    );

    expect((await events()).map((event) => event.details)).toEqual([{ providerId: 'github' }]);
    expect(setCookie).not.toHaveBeenCalled();
    expect(subjects()).toEqual(['GitHub was connected to your Adiutor account']);
  });

  it('records that it verified an email address that was not verified yet', async () => {
    mockGitHubApi({});
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, jane));
    const github = await connectGitHubWithToken(jane, 'jane-token');
    const { ctx } = githubCallback();

    // Better Auth connects the account, then marks the address verified.
    await afterAccountCreate(
      { id: github, userId: jane, providerId: 'github', confirmed: true },
      ctx,
    );
    beforeUserUpdate({ emailVerified: true }, ctx);
    await afterUserUpdate({ id: jane }, ctx);

    expect(await events()).toEqual([
      {
        action: 'provider_connected',
        actorUserId: jane,
        targetUserId: jane,
        details: { providerId: 'github', atSignIn: true, confirmed: true },
      },
      {
        action: 'email_verified',
        actorUserId: jane,
        targetUserId: jane,
        details: { providerId: 'github' },
      },
    ]);
  });

  it("doesn't record a verification for an address that was verified already", async () => {
    mockGitHubApi({});
    const john = await createUser(db, 'john@adiutor.test');
    const github = await connectGitHubWithToken(john, 'john-token');

    await afterAccountCreate(
      { id: github, userId: john, providerId: 'github', confirmed: true },
      githubCallback().ctx,
    );

    expect((await events()).map((event) => event.action)).toEqual(['provider_connected']);
  });

  it("doesn't record a verification when connected from the Security page", async () => {
    mockGitHubApi({});
    const jane = await createUser(db, 'jane@adiutor.test');
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, jane));
    const own = await createSession(db, jane);
    const github = await connectGitHubWithToken(jane, 'jane-token');

    await afterAccountCreate(
      { id: github, userId: jane, providerId: 'github', confirmed: true },
      githubCallback(await signedInHeaders(own)).ctx,
    );

    expect((await events()).map((event) => event.action)).toEqual(['provider_connected']);
  });
});
