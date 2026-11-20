/**
 * @file Integration tests for wrong passwords and wrong codes at a password
 * sign-in's code step.
 */
import { APIError, getOAuthState, getSessionFromCtx } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

import { auditEvent, queuedJob, rateLimitBucket, twoFactor, user } from '@/db/schema';
import { defined, firstRow } from '@/lib/defined';
import { sendEmail } from '@/lib/email';

import {
  addPassword,
  createSession,
  createUser,
  enableTwoFactor,
  inSequence,
  staffActor,
} from '../../../../tests/integration/helpers';
import { listOwnActivity } from '../../audit';
import { type AuthGuardContext, beforeAuthRequest } from '../auth-guards';
import { queueSecurityNotice } from '../security-notices';
import { afterAuthRequest } from './after-request';
import type { AuthHookContext } from './hook-context';
import { db, subjects, events, services } from './test-helpers';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

/** The real queueing of security notices, which the test about timing holds back. */
const notices = vi.hoisted(() => ({
  queue: undefined as undefined | typeof import('../security-notices').queueSecurityNotice,
}));

vi.mock('../security-notices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../security-notices')>();
  notices.queue = actual.queueSecurityNotice;
  return { ...actual, queueSecurityNotice: vi.fn(actual.queueSecurityNotice) };
});

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

describe('wrong passwords', () => {
  /**
   * Sends a password sign-in from a browser through the checks before it and
   * the reactions after it, sharing Better Auth's request state like a real
   * request.
   *
   * @param email - The address typed.
   * @param options - Optional details.
   * @param options.returned - What Better Auth answered; a wrong password by default.
   * @param options.runInBackground - Better Auth's background runner, if any.
   */
  const signInWithPassword = async (
    email: string,
    options: {
      returned?: unknown;
      runInBackground?: (task: Promise<unknown>) => void;
    } = {},
  ) => {
    const ctx = {
      path: '/sign-in/email',
      headers: new Headers({
        'x-forwarded-for': '203.0.113.7',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
      }),
      body: { email, password: 'wrong' },
      /**
       * Reads a signed cookie; there's no pending sign-in.
       *
       * @returns Nothing.
       */
      getSignedCookie: async () => null,
      context: {
        runInBackground: options.runInBackground,
      },
    } as unknown as AuthGuardContext & AuthHookContext;
    await beforeAuthRequest(ctx);
    ctx.context.returned =
      options.returned ?? new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD' });
    await afterAuthRequest(ctx);
  };

  /**
   * Sends wrong passwords one after another.
   *
   * @param times - How many.
   * @param email - The address typed.
   */
  const failSignIns = async (times: number, email: string) => {
    await inSequence(Array.from({ length: times }), () => signInWithPassword(email));
  };

  /**
   * Creates a user who signs in with a password.
   *
   * @param email - Their address.
   * @returns Their ID.
   */
  const createUserWithPassword = async (email: string) => {
    const id = await createUser(db, email);
    await addPassword(db, id);
    return id;
  };

  it('records each one, and tells the owner once they pause password sign-in', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');

    await failSignIns(9, 'Jane@adiutor.test');
    expect(await subjects()).toEqual([]);
    await failSignIns(1, 'jane@adiutor.test');

    expect(await subjects()).toEqual(['Password sign-in to your Adiutor account is paused']);
    const [notice] = defined(vi.mocked(sendEmail).mock.calls[0], 'the sent email');
    expect(notice.to).toBe('jane@adiutor.test');
    // Whoever typed them may be someone else: their browser and IP address aren't shared.
    expect(notice.text).not.toMatch(/From:|Firefox|203\.0\.113/);
    expect(notice.html).not.toMatch(/Firefox|203\.0\.113/);
    const recorded = await events();
    expect(recorded).toHaveLength(10);
    expect(recorded[9]).toEqual({
      action: 'sign_in_failed',
      actorUserId: null,
      targetUserId: jane,
      details: { method: 'password', email: 'jane@adiutor.test' },
    });
  });

  it('only counts refused passwords, and links an address sent with spaces to its account', async () => {
    const jane = await createUserWithPassword('jane@adiutor.test');
    const malformed = new APIError('BAD_REQUEST', { code: 'INVALID_EMAIL' });

    // Better Auth refuses an address with spaces before checking a password.
    await inSequence(Array.from({ length: 12 }), () =>
      signInWithPassword(' jane@adiutor.test ', { returned: malformed }),
    );
    await failSignIns(9, 'jane@adiutor.test');
    expect(await subjects()).toEqual([]);
    await failSignIns(1, ' jane@adiutor.test');

    expect(await subjects()).toEqual(['Password sign-in to your Adiutor account is paused']);
    expect((await events()).every(({ targetUserId }) => targetUserId === jane)).toBe(true);
  });

  it('tells the owner at most once a day', async () => {
    await createUserWithPassword('jane@adiutor.test');
    await failSignIns(10, 'jane@adiutor.test');
    // A new window, paused again by another ten.
    await db
      .update(rateLimitBucket)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(rateLimitBucket.key, 'sign-in-failed:email:jane@adiutor.test'));
    await failSignIns(10, 'jane@adiutor.test');

    expect(await subjects()).toHaveLength(1);
  });

  it('tells no one without a password: no account, a deactivated one, or one without a password', async () => {
    const john = await createUserWithPassword('john@adiutor.test');
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, john));
    await createUser(db, 'linkonly@adiutor.test');

    await failSignIns(10, 'nobody@adiutor.test');
    await failSignIns(10, 'john@adiutor.test');
    await failSignIns(10, 'linkonly@adiutor.test');

    expect(await subjects()).toEqual([]);
    const counted = await db
      .select({ key: rateLimitBucket.key, count: rateLimitBucket.count })
      .from(rateLimitBucket)
      .where(eq(rateLimitBucket.key, 'sign-in-failed:email:linkonly@adiutor.test'));
    // The sign-in is still paused the same way for every address.
    expect(counted).toEqual([{ key: 'sign-in-failed:email:linkonly@adiutor.test', count: 10 }]);
  });

  it('sends the notice after the response, so it takes as long for every address', async () => {
    await createUserWithPassword('jane@adiutor.test');
    await failSignIns(9, 'jane@adiutor.test');
    const runInBackground = vi.fn<(task: Promise<unknown>) => void>();
    // The work starts at once in the background: it's held back until the test has checked that
    // nothing went out with the response, so that check doesn't race it.
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const queue = defined(notices.queue, 'the real queueing of notices');
    vi.mocked(queueSecurityNotice).mockImplementationOnce(async (...args) => {
      await gate;
      return queue(...args);
    });

    try {
      await signInWithPassword('jane@adiutor.test', { runInBackground });

      expect(runInBackground).toHaveBeenCalledTimes(1);
      expect(await subjects()).toEqual([]);
    } finally {
      open();
    }
    await defined(runInBackground.mock.calls[0], 'the background task')[0];
    expect(await subjects()).toEqual(['Password sign-in to your Adiutor account is paused']);
  });
});

describe('a code at the code step of a password sign-in', () => {
  /** The browser that typed the code: whoever knows the password, maybe not the user. */
  const FIREFOX =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

  /** The lockout email's subject (`two_factor_locked` in `src/emails/security-notice.tsx`). */
  const LOCKED_SUBJECT = 'Signing in to your Adiutor account with a code is paused';

  /**
   * Builds a request that checks a code at the code step of a password
   * sign-in, as both the checks before it (`auth-guards/`) and the
   * reactions after it see it: there's no session yet, and Better Auth's
   * two-factor cookie names the user.
   *
   * @param path - The endpoint path.
   * @param userId - The user whose sign-in it is.
   * @returns The context; set `context.returned` before the reactions run.
   */
  function codeStep(path: string, userId: string): AuthGuardContext & AuthHookContext {
    return {
      path,
      headers: new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': FIREFOX }),
      body: {},
      /**
       * Reads the two-factor cookie of the pending sign-in.
       *
       * @returns Its identifier.
       */
      getSignedCookie: async () => 'adiutor-tests-pending-sign-in',
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
           * Looks up the user of the pending sign-in.
           *
           * @returns The user's ID as the stored value, expiring in 10 minutes.
           */
          findVerificationValue: async () => ({
            value: userId,
            expiresAt: new Date(Date.now() + 10 * 60_000),
          }),
        },
        session: null,
      },
    };
  }

  /**
   * Runs the checks before a request and the reactions after it, with Better
   * Auth's answer in between.
   *
   * @param ctx - The request.
   * @param returned - Better Auth's answer.
   */
  async function handle(ctx: AuthGuardContext & AuthHookContext, returned: unknown): Promise<void> {
    await beforeAuthRequest(ctx);
    ctx.context.returned = returned;
    // Better Auth gives the hooks after the endpoint their own copy of `ctx`, sharing `context`.
    await afterAuthRequest({ ...ctx, context: ctx.context });
  }

  /**
   * Better Auth's refusal of a code.
   *
   * @param status - Its HTTP status.
   * @param code - Its error code.
   * @returns The error.
   */
  const refusal = (status: 'UNAUTHORIZED' | 'BAD_REQUEST' | 'TOO_MANY_REQUESTS', code: string) =>
    new APIError(status, { message: code, code });

  /**
   * Pauses signing in with a code for a user, as Better Auth does after too many wrong codes.
   *
   * @param userId - The user.
   * @param lockedUntil - Until when.
   */
  async function lockTwoFactor(userId: string, lockedUntil: Date): Promise<void> {
    await db
      .update(twoFactor)
      .set({ failedVerificationCount: 10, lockedUntil })
      .where(eq(twoFactor.userId, userId));
  }

  beforeEach(() => {
    vi.mocked(getSessionFromCtx).mockResolvedValue(null);
  });

  it('records a wrong code without an actor, and only codes Better Auth compared', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);

    await handle(
      codeStep('/two-factor/verify-totp', support.id),
      refusal('UNAUTHORIZED', 'INVALID_CODE'),
    );
    await handle(
      codeStep('/two-factor/verify-backup-code', support.id),
      refusal('UNAUTHORIZED', 'INVALID_BACKUP_CODE'),
    );
    // About the two-factor cookie, or this sign-in's tries, not a code.
    await handle(
      codeStep('/two-factor/verify-totp', support.id),
      refusal('UNAUTHORIZED', 'INVALID_TWO_FACTOR_COOKIE'),
    );
    await handle(
      codeStep('/two-factor/verify-totp', support.id),
      refusal('BAD_REQUEST', 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'),
    );

    expect(await events()).toEqual([
      {
        action: 'mfa_failed',
        actorUserId: null,
        targetUserId: support.id,
        details: { method: 'authenticator', atSignIn: true },
      },
      {
        action: 'mfa_failed',
        actorUserId: null,
        targetUserId: support.id,
        details: { method: 'backup_code', atSignIn: true },
      },
    ]);
    // Staff see who typed them in the audit log; the user's own activity leaves that out.
    const recorded = firstRow(
      await db.select({ userAgent: auditEvent.userAgent }).from(auditEvent),
      'the audit event',
    );
    expect(recorded.userAgent).toBe(FIREFOX);
    const own = await listOwnActivity(services, support);
    expect(own.map(({ ip, userAgent }) => [ip, userAgent])).toEqual([
      [null, null],
      [null, null],
    ]);
    // Nothing counts towards the step-up limit, and the account isn't paused, so no email.
    expect(await db.select().from(rateLimitBucket)).toEqual([]);
    expect(await subjects()).toEqual([]);
  });

  it('records a wrong code on the step-up page once, with the user as its actor, even with a pending sign-in', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    const sessionId = await createSession(db, support.id);
    const signedIn = {
      session: { id: sessionId, mfaVerified: false, mfaMethod: null, createdAt: new Date() },
      user: { id: support.id, twoFactorEnabled: true },
    };
    vi.mocked(getSessionFromCtx).mockResolvedValue(
      signedIn as unknown as Awaited<ReturnType<typeof getSessionFromCtx>>,
    );
    // The browser still has the two-factor cookie of an earlier password sign-in.
    const ctx = codeStep('/two-factor/verify-totp', support.id);
    ctx.context.session = signedIn;
    await lockTwoFactor(support.id, new Date(Date.now() + 15 * 60_000));

    await handle(ctx, refusal('UNAUTHORIZED', 'INVALID_CODE'));

    expect(await events()).toEqual([
      {
        action: 'mfa_failed',
        actorUserId: support.id,
        targetUserId: support.id,
        details: { method: 'authenticator' },
      },
    ]);
    // Counted towards the step-up limit; Better Auth's pause at sign-in isn't about the step-up.
    expect(
      await db
        .select({ key: rateLimitBucket.key, count: rateLimitBucket.count })
        .from(rateLimitBucket),
    ).toEqual([{ key: `step-up-failed:user:${support.id}`, count: 1 }]);
    expect(await subjects()).toEqual([]);
  });

  it('tells the owner once while wrong codes pause signing in with a code, without the browser', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await lockTwoFactor(support.id, new Date(Date.now() + 15 * 60_000));

    // The code that started the pause, then a refusal while it lasts.
    await handle(
      codeStep('/two-factor/verify-totp', support.id),
      refusal('UNAUTHORIZED', 'INVALID_CODE'),
    );
    await handle(
      codeStep('/two-factor/verify-totp', support.id),
      refusal('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED'),
    );

    expect(await subjects()).toEqual([LOCKED_SUBJECT]);
    const [notice] = defined(vi.mocked(sendEmail).mock.calls[0], 'the sent email');
    expect(notice.to).toBe(support.email);
    // Whoever typed the codes may be someone else.
    expect(notice.text).not.toMatch(/Firefox|203\.0\.113\.7|From:/);
    // Only the code Better Auth compared is recorded.
    expect((await events()).map(({ action }) => action)).toEqual(['mfa_failed']);
  });

  it('queues one notice per pause, however many refusals it brings', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await lockTwoFactor(support.id, new Date(Date.now() + 15 * 60_000));
    const locked = refusal('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED');

    await handle(codeStep('/two-factor/verify-totp', support.id), locked);
    await handle(codeStep('/two-factor/verify-totp', support.id), locked);
    await handle(codeStep('/two-factor/verify-totp', support.id), locked);

    expect(await db.select().from(queuedJob)).toHaveLength(1);
    expect(await subjects()).toEqual([LOCKED_SUBJECT]);
  });

  it('tells nobody without a pause, or when the account is deactivated', async () => {
    // A pause that's over (Better Auth clears it at the next code).
    const ended = await staffActor(db, 'support');
    await enableTwoFactor(db, ended.id);
    await lockTwoFactor(ended.id, new Date(Date.now() - 60_000));
    // Only email codes: Better Auth keeps no count without an authenticator app, so never pauses.
    const emailOnly = await staffActor(db, 'support');
    await enableTwoFactor(db, emailOnly.id, 'email');
    // Deactivated accounts get no sign-in emails.
    const deactivated = await staffActor(db, 'support');
    await enableTwoFactor(db, deactivated.id);
    await lockTwoFactor(deactivated.id, new Date(Date.now() + 15 * 60_000));
    await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, deactivated.id));

    await handle(
      codeStep('/two-factor/verify-totp', ended.id),
      refusal('UNAUTHORIZED', 'INVALID_CODE'),
    );
    await handle(
      codeStep('/two-factor/verify-otp', emailOnly.id),
      refusal('UNAUTHORIZED', 'INVALID_CODE'),
    );
    await handle(
      codeStep('/two-factor/verify-totp', deactivated.id),
      refusal('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED'),
    );

    expect(await subjects()).toEqual([]);
    expect((await events()).map(({ targetUserId, details }) => [targetUserId, details])).toEqual([
      [ended.id, { method: 'authenticator', atSignIn: true }],
      [emailOnly.id, { method: 'email_code', atSignIn: true }],
    ]);
  });
});
