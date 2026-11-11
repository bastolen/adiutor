/**
 * @file Integration tests for the reactions to a password sign-in and a sign-in
 * with GitHub.
 */
import { APIError, getOAuthState } from 'better-auth/api';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { auditEvent, session } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';

import {
  createCompany,
  createSession,
  createUser,
  enableTwoFactor,
  lastActiveAt,
  memberActor,
  staffActor,
} from '../../../../tests/integration/helpers';
import { loadActor } from '../../actor';
import { listOwnActivity } from '../../audit';
import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import { afterPasswordSignIn } from './password-sign-in';
import {
  db,
  events,
  expectSetSince,
  sessionMfa,
  sessionVerifiedAt,
  services,
  mockGitHubApi,
  connectGitHubWithToken,
  githubCallback,
  storedGitHubMfa,
  addPasskey,
  signedInHeaders,
  trustDevice,
  withTrustedDevice,
  sessionExists,
  devicesLeft,
  TRUST_DEVICE_COOKIE,
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

describe('a password sign-in', () => {
  /** The browser that typed the password. */
  const FIREFOX =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

  /**
   * Builds the context of a password sign-in once Better Auth's two-step
   * plugin has decided on its session, as the plugin listed after it sees it.
   *
   * @param email - The address typed.
   * @param outcome - What the plugin left: the session it kept, or what the endpoint answers.
   * @param outcome.newSession - The session that stayed, if any.
   * @param outcome.newSession.sessionId - Its ID.
   * @param outcome.newSession.userId - Its user.
   * @param outcome.newSession.twoFactorEnabled - Whether the user has two-step verification.
   * @param outcome.returned - The response; the code step's by default.
   * @returns The context.
   */
  const passwordSignIn = (
    email: string,
    outcome: {
      newSession?: { sessionId: string; userId: string; twoFactorEnabled: boolean };
      returned?: unknown;
    },
  ): AuthHookContext => ({
    path: '/sign-in/email',
    headers: new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': FIREFOX }),
    body: { email, password: 'adiutor-tests-password' },
    context: {
      returned: outcome.returned ?? { twoFactorRedirect: true, twoFactorMethods: ['otp'] },
      session: null,
      newSession: outcome.newSession
        ? {
            session: { id: outcome.newSession.sessionId, ipAddress: '', userAgent: FIREFOX },
            user: {
              id: outcome.newSession.userId,
              twoFactorEnabled: outcome.newSession.twoFactorEnabled,
            },
          }
        : null,
    },
  });

  it('records a sign-in that kept its session, and that the user is active', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);
    const start = new Date();

    await afterPasswordSignIn(
      passwordSignIn('jane@adiutor.test', {
        newSession: { sessionId, userId: jane, twoFactorEnabled: false },
        returned: { redirect: false, token: 'adiutor-tests-token' },
      }),
    );

    expect(await events()).toEqual([
      {
        action: 'sign_in',
        actorUserId: jane,
        targetUserId: jane,
        details: { method: 'password' },
      },
    ]);
    const recorded = firstRow(
      await db.select({ userAgent: auditEvent.userAgent }).from(auditEvent),
      'the audit event',
    );
    expect(recorded.userAgent).toBe(FIREFOX);
    expectSetSince(await lastActiveAt(db, jane), start);
    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: false, mfaMethod: null });
  });

  it('marks the session of a trusted device verified, but not as a confirmation for changing sign-in methods', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const sessionId = await createSession(db, support.id);
    const ctx = passwordSignIn(support.email, {
      newSession: { sessionId, userId: support.id, twoFactorEnabled: true },
      returned: { redirect: false, token: 'adiutor-tests-token' },
    });

    // The app's reactions run before the two-step plugin has decided, so they leave it alone.
    await afterAuthRequest(ctx);
    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: false, mfaMethod: null });
    await afterPasswordSignIn(ctx);

    expect(await sessionMfa(sessionId)).toEqual({ mfaVerified: true, mfaMethod: 'trusted_device' });
    expect(await sessionVerifiedAt(sessionId)).toBeNull();
    expect((await events()).map(({ action, details }) => [action, details])).toEqual([
      ['sign_in', { method: 'password' }],
    ]);
  });

  it('records a password whose sign-in went on to the code step without a sign-in or an actor', async () => {
    const testCompany = await createCompany(db);
    const client = await memberActor(db, testCompany.id, 'client', 'client@adiutor.test');
    await enableTwoFactor(db, client.id, 'email');

    // The plugin deleted the session and asked for a code. Better Auth matches the address in any case.
    await afterPasswordSignIn(passwordSignIn('Client@adiutor.test', {}));

    expect(await events()).toEqual([
      {
        action: 'sign_in_code_pending',
        actorUserId: null,
        targetUserId: client.id,
        details: { method: 'password' },
      },
    ]);
    // Not active until the code step is finished.
    expect(await lastActiveAt(db, client.id)).toBeNull();
    // Whoever typed it may be someone else: the user's own activity leaves out their IP and browser.
    const [own] = await listOwnActivity(services, client);
    expect(own).toMatchObject({ action: 'sign_in_code_pending', ip: null, userAgent: null });
    const recorded = firstRow(
      await db.select({ userAgent: auditEvent.userAgent }).from(auditEvent),
      'the audit event',
    );
    expect(recorded.userAgent).toBe(FIREFOX);
  });

  it('records nothing for a refused password (recorded after the request), or for other endpoints', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const sessionId = await createSession(db, jane);

    await afterPasswordSignIn(
      passwordSignIn('jane@adiutor.test', {
        returned: new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD' }),
      }),
    );
    await afterPasswordSignIn({
      ...passwordSignIn('jane@adiutor.test', {
        newSession: { sessionId, userId: jane, twoFactorEnabled: false },
      }),
      path: '/magic-link/verify',
    });

    expect(await events()).toEqual([]);
    expect(await lastActiveAt(db, jane)).toBeNull();
  });
});

describe('signing in with GitHub', () => {
  it('confirms the new session only with a GitHub account that has 2FA and was confirmed', async () => {
    mockGitHubApi({ 'jane-token': true, 'john-token': true });
    const jane = await createUser(db, 'jane@adiutor.test');
    await enableTwoFactor(db, jane);
    const janeGitHub = await connectGitHubWithToken(jane, 'jane-token', { confirmed: false });
    const janeSession = await createSession(db, jane);
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWithToken(john, 'john-token');
    const johnSession = await createSession(db, john);

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: janeSession, userId: jane }).ctx,
    );
    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: johnSession, userId: john }).ctx,
    );

    expect(await sessionMfa(janeSession)).toEqual({ mfaVerified: false, mfaMethod: null });
    // Its 2FA is still recorded, for when Jane confirms it.
    expect(await storedGitHubMfa(janeGitHub)).toBe(true);
    expect(await sessionMfa(johnSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
  });

  it('starts the window for changing sign-in methods of a session it confirmed', async () => {
    mockGitHubApi({ 'john-token': true });
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWithToken(john, 'john-token');
    const johnSession = await createSession(db, john);
    const start = new Date();

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: johnSession, userId: john }).ctx,
    );

    expect(await sessionMfa(johnSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
    expectSetSince(await sessionVerifiedAt(johnSession), start);
  });

  it('still confirms the session next to a passkey; the window is decided when the session is read', async () => {
    mockGitHubApi({ 'john-token': true });
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWithToken(john, 'john-token');
    await addPasskey(john);
    const johnSession = await createSession(db, john);
    const start = new Date();

    await afterAuthRequest(
      githubCallback(new Headers(), { sessionId: johnSession, userId: john }).ctx,
    );

    expect(await sessionMfa(johnSession)).toEqual({ mfaVerified: true, mfaMethod: 'github' });
    expectSetSince(await sessionVerifiedAt(johnSession), start);
    // `loadActor` then gives it no window to change sign-in methods (see `actor.int.test.ts`).
    const [stored] = await db
      .select({
        mfaVerified: session.mfaVerified,
        mfaMethod: session.mfaMethod,
        mfaVerifiedAt: session.mfaVerifiedAt,
      })
      .from(session)
      .where(eq(session.id, johnSession));
    expect(await loadActor(db, john, stored)).toMatchObject({
      sessionMfaVerified: true,
      mfaConfirmedUntil: null,
    });
  });

  it("ends the browser's previous session of the same user, only from a validly signed cookie", async () => {
    mockGitHubApi({ 'john-token': true });
    const john = await createUser(db, 'john@adiutor.test');
    await connectGitHubWithToken(john, 'john-token');
    const previous = await createSession(db, john);
    const kept = await createSession(db, john);

    await afterAuthRequest(
      githubCallback(await signedInHeaders(kept, 'not-the-secret'), {
        sessionId: await createSession(db, john),
        userId: john,
      }).ctx,
    );
    await afterAuthRequest(
      githubCallback(await signedInHeaders(previous), {
        sessionId: await createSession(db, john),
        userId: john,
      }).ctx,
    );

    const left = await db
      .select({ id: session.id })
      .from(session)
      .where(inArray(session.id, [previous, kept]));
    expect(left).toEqual([{ id: kept }]);
  });

  describe("when someone else signs in on a browser that wasn't signed out", () => {
    it('ends their session and forgets their trusted device, as signing out there would', async () => {
      mockGitHubApi({ 'john-token': true });
      const jane = await createUser(db, 'jane@adiutor.test');
      const john = await createUser(db, 'john@adiutor.test');
      await connectGitHubWithToken(john, 'john-token');
      const janes = await createSession(db, jane);
      const janesDevice = await trustDevice(jane);

      const { ctx, setCookie } = githubCallback(
        withTrustedDevice(await signedInHeaders(janes), janesDevice),
        { sessionId: await createSession(db, john), userId: john },
      );
      await afterAuthRequest(ctx);

      expect(await sessionExists(janes)).toBe(false);
      // A copy of the cookie no longer skips Jane's code step either.
      expect(await devicesLeft([janesDevice])).toEqual([]);
      expect(setCookie).toHaveBeenCalledWith(
        TRUST_DEVICE_COOKIE,
        '',
        expect.objectContaining({ maxAge: 0, path: '/' }),
      );
      // Like signing out, nothing is recorded for Jane: it would name John to her.
      expect((await events()).filter((event) => event.targetUserId === jane)).toEqual([]);
    });

    it('keeps them both with a forged session cookie', async () => {
      mockGitHubApi({ 'john-token': true });
      const jane = await createUser(db, 'jane@adiutor.test');
      const john = await createUser(db, 'john@adiutor.test');
      await connectGitHubWithToken(john, 'john-token');
      const janes = await createSession(db, jane);
      const janesDevice = await trustDevice(jane);

      const { ctx, setCookie } = githubCallback(
        withTrustedDevice(await signedInHeaders(janes, 'not-the-secret'), janesDevice),
        { sessionId: await createSession(db, john), userId: john },
      );
      await afterAuthRequest(ctx);

      expect(await sessionExists(janes)).toBe(true);
      expect(await devicesLeft([janesDevice])).toEqual([janesDevice]);
      expect(setCookie).not.toHaveBeenCalledWith(TRUST_DEVICE_COOKIE, '', expect.anything());
    });

    it("keeps the browser's trusted device of whoever signs in", async () => {
      mockGitHubApi({ 'john-token': true });
      const jane = await createUser(db, 'jane@adiutor.test');
      const john = await createUser(db, 'john@adiutor.test');
      await connectGitHubWithToken(john, 'john-token');
      const janes = await createSession(db, jane);
      const johnsDevice = await trustDevice(john);

      const { ctx, setCookie } = githubCallback(
        withTrustedDevice(await signedInHeaders(janes), johnsDevice),
        { sessionId: await createSession(db, john), userId: john },
      );
      await afterAuthRequest(ctx);

      expect(await sessionExists(janes)).toBe(false);
      expect(await devicesLeft([johnsDevice])).toEqual([johnsDevice]);
      expect(setCookie).not.toHaveBeenCalledWith(TRUST_DEVICE_COOKIE, '', expect.anything());
    });
  });
});
