/**
 * @file Integration tests for the limits on attempts: wrong passwords, wrong
 * current passwords, wrong step-up codes and emailed codes.
 */
import { addOAuthServerContext, getSessionFromCtx } from 'better-auth/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { rateLimitBucket } from '@/db/schema';

import {
  addPassword,
  createCompany,
  createUser,
  enableTwoFactor,
  inSequence,
  memberActor,
  staffActor,
} from '../../../../tests/integration/helpers';
import { wrongCurrentPasswordsKey } from '../current-password';
import { clearFailedSignIns } from '../failed-sign-ins';
import {
  countFailedSignIn,
  endEmailCodeCooldown,
  sessionCodeChallenge,
  settleCurrentPasswordAttempt,
  settlePasswordAttempt,
  settleStepUpAttempt,
  signInCodeChallenge,
} from './attempts';
import { beforeAuthRequest } from './before-request';
import { releaseSignInChangeLockOf } from './change-lock';
import {
  request,
  refusedWith,
  hits,
  db,
  repeat,
  signedIn,
  sendCodesOverTime,
  waitForNextCode,
} from './test-helpers';

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  // Better Auth's request state isn't there outside a request; the tests watch what's added.
  addOAuthServerContext: vi.fn(),
}));

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(() => {
  vi.mocked(getSessionFromCtx).mockReset().mockResolvedValue(null);
  vi.mocked(addOAuthServerContext).mockReset();
});

describe('sign-in limits', () => {
  /**
   * Sends a password sign-in through the checks before it and settles its
   * attempt as the reactions after it would.
   *
   * @param email - The address, as typed.
   * @param wrongPassword - Whether Better Auth refuses the password.
   * @returns Whether it paused password sign-in, or the refusal.
   */
  const signInWithPassword = async (email: string, wrongPassword: boolean) => {
    const ctx = request('/sign-in/email', { email });
    await beforeAuthRequest(ctx);
    return settlePasswordAttempt(ctx, email.trim().toLowerCase(), wrongPassword);
  };

  it('pauses password sign-in at the tenth wrong password for an address', async () => {
    const paused = await inSequence(Array.from({ length: 10 }), () =>
      signInWithPassword(' Jane@adiutor.test', true),
    );

    // Only the tenth pauses it, so the owner is told once.
    expect(paused).toEqual([...Array.from({ length: 9 }, () => false), true]);
    await expect(
      beforeAuthRequest(request('/sign-in/email', { email: 'JANE@adiutor.test' })),
    ).rejects.toEqual(refusedWith('PASSWORD_SIGN_IN_PAUSED'));
    await expect(
      beforeAuthRequest(request('/sign-in/email', { email: 'john@adiutor.test' })),
    ).resolves.toBeUndefined();
  });

  it("doesn't count the right password, or a request refused before the password was checked", async () => {
    await inSequence(Array.from({ length: 9 }), () =>
      signInWithPassword('jane@adiutor.test', true),
    );

    await inSequence(Array.from({ length: 5 }), () =>
      signInWithPassword('jane@adiutor.test', false),
    );

    expect(await hits('sign-in-failed:email:jane@adiutor.test')).toBe(9);
    expect(await signInWithPassword('jane@adiutor.test', true)).toBe(true);
  });

  it('lets at most ten sign-ins at the same moment check a password', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        beforeAuthRequest(request('/sign-in/email', { email: 'jane@adiutor.test' })),
      ),
    );

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(10);
  });

  it('counts a wrong password whose attempt the checks before never took', async () => {
    const ctx = request('/sign-in/email', { email: 'jane@adiutor.test' });

    await settlePasswordAttempt(ctx, 'jane@adiutor.test', true);
    await settlePasswordAttempt(ctx, 'jane@adiutor.test', false);

    expect(await hits('sign-in-failed:email:jane@adiutor.test')).toBe(1);
  });

  it('says the same for every address, pointing to the other ways in', async () => {
    await createUser(db, 'jane@adiutor.test');
    /**
     * Pauses an address's password sign-in and reads the refusal.
     *
     * @param email - The address.
     * @returns The refusal's message.
     */
    const refusal = async (email: string) => {
      await inSequence(Array.from({ length: 10 }), () => countFailedSignIn(email));
      const error = await beforeAuthRequest(request('/sign-in/email', { email })).catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toEqual(refusedWith('PASSWORD_SIGN_IN_PAUSED'));
      expect(error).toMatchObject({ statusCode: 429 });
      return (error as { body: { message: string } }).body.message;
    };

    const forAccount = await refusal('jane@adiutor.test');
    expect(forAccount).toBe(await refusal('nobody@adiutor.test'));
    expect(forAccount).toBe(
      'Password sign-in for this address is paused for 15 minutes after too many wrong passwords. Sign in with an email link or a passkey, or reset your password to lift the pause.',
    );
  });

  it('lifts the pause for one address only', async () => {
    await inSequence(Array.from({ length: 10 }), () => countFailedSignIn('jane@adiutor.test'));
    await inSequence(Array.from({ length: 10 }), () => countFailedSignIn('john@adiutor.test'));

    await clearFailedSignIns(db, ' JANE@adiutor.test');

    await expect(
      beforeAuthRequest(request('/sign-in/email', { email: 'jane@adiutor.test' })),
    ).resolves.toBeUndefined();
    await expect(
      beforeAuthRequest(request('/sign-in/email', { email: 'john@adiutor.test' })),
    ).rejects.toEqual(refusedWith('PASSWORD_SIGN_IN_PAUSED'));
  });

  it.each([
    ['ten kilobytes of an address', `${'a'.repeat(10_000)}@adiutor.test`],
    ['text that isn’t an address', 'adiutor-tests password typed into the wrong field'],
  ])('takes no attempt and keeps no key for %s', async (_name, email) => {
    await repeat(12, request('/sign-in/email', { email }));
    await repeat(6, request('/sign-in/magic-link', { email }));
    await repeat(6, request('/request-password-reset', { email }));

    expect(await db.select({ key: rateLimitBucket.key }).from(rateLimitBucket)).toEqual([]);
  });

  it('limits email links and password reset emails per address and endpoint', async () => {
    const link = request('/sign-in/magic-link', { email: 'jane@adiutor.test' });
    await repeat(5, link);
    await expect(beforeAuthRequest(link)).rejects.toEqual(refusedWith('TOO_MANY_ATTEMPTS'));
    await expect(
      beforeAuthRequest(request('/request-password-reset', { email: 'jane@adiutor.test' })),
    ).resolves.toBeUndefined();
    expect(await hits('/sign-in/magic-link:email:jane@adiutor.test')).toBe(6);
    expect(await hits('/request-password-reset:email:jane@adiutor.test')).toBe(1);
  });
});

describe('confirming a session (step-up)', () => {
  it('refuses email codes once an authenticator app is set up, without counting', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await signedIn(support.id);

    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
    await expect(beforeAuthRequest(request('/two-factor/verify-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
    expect(await hits(`email-code:user:${support.id}`)).toBeNull();
  });

  it('refuses email codes for Managers with only email codes', async () => {
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id, 'email');
    await signedIn(manager.id);

    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
  });

  it('refuses email codes for company Admins, like staff Admins and Managers', async () => {
    const testCompany = await createCompany(db);
    const owner = await memberActor(db, testCompany.id, 'admin');
    await enableTwoFactor(db, owner.id, 'email');
    await signedIn(owner.id);

    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODES_NOT_ALLOWED'),
    );
  });

  it('limits the email codes sent to a user', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    await signedIn(support.id);

    await sendCodesOverTime(5, request('/two-factor/send-otp'));
    await waitForNextCode();
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('TOO_MANY_ATTEMPTS'),
    );
    // Checking a code doesn't count as sending one.
    await expect(beforeAuthRequest(request('/two-factor/verify-otp'))).resolves.toBeUndefined();
    expect(await hits(`email-code:user:${support.id}`)).toBe(6);
  });

  /**
   * Sends a step-up code through the checks before it and settles its attempt
   * as the reactions after it would.
   *
   * @param userId - The signed-in user.
   * @param wrong - Whether Better Auth refuses the code.
   * @param path - The code endpoint.
   */
  const checkCode = async (userId: string, wrong: boolean, path = '/two-factor/verify-totp') => {
    const ctx = request(path);
    await beforeAuthRequest(ctx);
    await settleStepUpAttempt(ctx, userId, wrong);
  };

  it('refuses every code once the wrong ones are used up', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await signedIn(support.id);

    await inSequence(Array.from({ length: 4 }), () => checkCode(support.id, true));
    await expect(checkCode(support.id, true)).resolves.toBeUndefined();

    await expect(beforeAuthRequest(request('/two-factor/verify-totp'))).rejects.toEqual(
      refusedWith('TOO_MANY_ATTEMPTS'),
    );
    await expect(beforeAuthRequest(request('/two-factor/verify-backup-code'))).rejects.toEqual(
      refusedWith('TOO_MANY_ATTEMPTS'),
    );
  });

  it("doesn't count right codes", async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await signedIn(support.id);

    await inSequence(Array.from({ length: 4 }), () => checkCode(support.id, true));
    await inSequence(Array.from({ length: 6 }), () => checkCode(support.id, false));

    expect(await hits(`step-up-failed:user:${support.id}`)).toBe(4);
    await expect(checkCode(support.id, true)).resolves.toBeUndefined();
  });

  it('lets at most five codes sent at the same moment be checked', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id);
    await signedIn(support.id);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 25 }, () => beforeAuthRequest(request('/two-factor/verify-totp'))),
    );

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(5);
  });

  it('counts a wrong code that took no attempt beforehand, as when setting up two-step verification', async () => {
    const support = await staffActor(db, 'support');
    const ctx = request('/two-factor/verify-totp');

    await settleStepUpAttempt(ctx, support.id, true);
    await settleStepUpAttempt(ctx, support.id, false);

    expect(await hits(`step-up-failed:user:${support.id}`)).toBe(1);
  });
});

describe('current passwords Better Auth checks', () => {
  /** The endpoints that check the current password, as the Security page sends them. */
  const PASSWORD_CHECKS = [
    ['/two-factor/enable', { method: 'totp', password: 'adiutor-tests-guess' }],
    ['/two-factor/disable', { password: 'adiutor-tests-guess' }],
    ['/two-factor/generate-backup-codes', { password: 'adiutor-tests-guess' }],
  ] as const;

  /**
   * Creates a user with a password, signed in as each endpoint needs: a fresh
   * sign-in to turn two-step verification on, a confirmed session with an
   * authenticator app for the others.
   *
   * @param path - The endpoint.
   * @returns The user's ID.
   */
  const signedInWithPassword = async (path: string) => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    if (path === '/two-factor/enable') {
      await signedIn(jane);
    } else {
      await enableTwoFactor(db, jane);
      await signedIn(jane, { verifiedWith: 'authenticator' });
    }
    return jane;
  };

  /**
   * Sends a current password through the checks before the request, and
   * settles its attempt and gives back the lock as the reactions after it would.
   *
   * @param path - The endpoint.
   * @param body - What the Security page sends.
   * @param userId - The signed-in user.
   * @param wrong - Whether Better Auth refuses the password.
   */
  const checkPassword = async (
    path: string,
    body: Record<string, unknown>,
    userId: string,
    wrong: boolean,
  ) => {
    const ctx = request(path, { body });
    await beforeAuthRequest(ctx);
    await releaseSignInChangeLockOf({ context: ctx.context });
    await settleCurrentPasswordAttempt(ctx, userId, wrong);
  };

  it.each(PASSWORD_CHECKS)(
    'counts wrong ones on %s per user, in the password forms’ bucket, and refuses once they’re used up',
    async (path, body) => {
      const jane = await signedInWithPassword(path);

      await inSequence(Array.from({ length: 5 }), () => checkPassword(path, body, jane, true));

      expect(await hits(wrongCurrentPasswordsKey(jane))).toBe(5);
      await expect(beforeAuthRequest(request(path, { body }))).rejects.toEqual(
        refusedWith('TOO_MANY_ATTEMPTS'),
      );
    },
  );

  it.each(PASSWORD_CHECKS)("doesn't count right ones on %s", async (path, body) => {
    const jane = await signedInWithPassword(path);

    await inSequence(Array.from({ length: 2 }), () => checkPassword(path, body, jane, true));
    await inSequence(Array.from({ length: 6 }), () => checkPassword(path, body, jane, false));

    expect(await hits(wrongCurrentPasswordsKey(jane))).toBe(2);
  });

  it('lets at most five checks sent at the same moment through', async () => {
    const [path, body] = PASSWORD_CHECKS[0];
    await signedInWithPassword(path);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 25 }, () => beforeAuthRequest(request(path, { body }))),
    );

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(5);
  });

  it('takes no attempt from a user without a password, who is asked for none', async () => {
    const newcomer = await createUser(db, 'newcomer@adiutor.test');
    await signedIn(newcomer);

    await repeat(8, request('/two-factor/enable', { body: { method: 'totp' } }));

    expect(await hits(wrongCurrentPasswordsKey(newcomer))).toBeNull();
  });

  it('takes no attempt when an earlier check refuses the request', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    await addPassword(db, jane);
    await enableTwoFactor(db, jane);
    // Not confirmed with the second step: the change is refused before the password is checked.
    await signedIn(jane);

    await expect(
      beforeAuthRequest(request('/two-factor/disable', { body: { password: 'guess' } })),
    ).rejects.toEqual(refusedWith('MFA_VERIFICATION_REQUIRED'));

    expect(await hits(wrongCurrentPasswordsKey(jane))).toBeNull();
  });
});

describe('the wait for a new emailed code', () => {
  it('refuses another code within the wait, at sign-in and on the step-up page, without counting it', async () => {
    const atSignIn = await staffActor(db, 'support');
    await enableTwoFactor(db, atSignIn.id, 'email');
    const codeStep = request('/two-factor/send-otp', { pendingUserId: atSignIn.id });
    await beforeAuthRequest(codeStep);
    await expect(beforeAuthRequest(codeStep)).rejects.toEqual(
      refusedWith('EMAIL_CODE_SENT_RECENTLY'),
    );
    expect(await hits(`email-code:user:${atSignIn.id}`)).toBe(1);

    const stepUp = await staffActor(db, 'support');
    await enableTwoFactor(db, stepUp.id, 'email');
    await signedIn(stepUp.id);
    await beforeAuthRequest(request('/two-factor/send-otp'));
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODE_SENT_RECENTLY'),
    );
    expect(await hits(`email-code:user:${stepUp.id}`)).toBe(1);
  });

  it('lets a new code through once the wait is over, or, signed in, once a code was used', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    const sendCode = request('/two-factor/send-otp', { pendingUserId: support.id });

    await beforeAuthRequest(sendCode);
    await waitForNextCode();
    await expect(beforeAuthRequest(sendCode)).resolves.toBeUndefined();

    await signedIn(support.id, { sessionId: 'session-a' });
    await beforeAuthRequest(request('/two-factor/send-otp'));
    await endEmailCodeCooldown(sessionCodeChallenge('session-a'));
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).resolves.toBeUndefined();
  });

  it('waits per sign-in, the code Better Auth keeps with it, not per user', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    /**
     * Asks for a code at a sign-in's code step.
     *
     * @param pendingSignIn - The sign-in.
     * @returns The guards' answer.
     */
    const sendCode = (pendingSignIn: string) =>
      beforeAuthRequest(
        request('/two-factor/send-otp', { pendingUserId: support.id, pendingSignIn }),
      );

    await sendCode('first-sign-in');
    // Signing in again starts a code step the first code can't be used for: it gets its own.
    await expect(sendCode('second-sign-in')).resolves.toBeUndefined();
    await expect(sendCode('first-sign-in')).rejects.toEqual(
      refusedWith('EMAIL_CODE_SENT_RECENTLY'),
    );
    // The wait's key doesn't hold the sign-in's identifier, which lets the sign-in finish.
    expect(await hits('email-code-cooldown:sign-in:first-sign-in')).toBeNull();
    expect(
      await hits(`email-code-cooldown:${signInCodeChallenge('first-sign-in')}`),
    ).not.toBeNull();
  });

  it('waits per session on the step-up page, so another session gets its own code at once', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');

    await signedIn(support.id, { sessionId: 'session-a' });
    await beforeAuthRequest(request('/two-factor/send-otp'));
    await signedIn(support.id, { sessionId: 'session-b' });
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).resolves.toBeUndefined();
    await signedIn(support.id, { sessionId: 'session-a' });
    await expect(beforeAuthRequest(request('/two-factor/send-otp'))).rejects.toEqual(
      refusedWith('EMAIL_CODE_SENT_RECENTLY'),
    );
  });

  it('still limits the codes of all sessions of a user together', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    /**
     * Asks for a step-up code in a session of its own.
     *
     * @param sessionId - The session.
     * @returns The guards' answer.
     */
    const sendCodeIn = async (sessionId: string) => {
      await signedIn(support.id, { sessionId });
      return beforeAuthRequest(request('/two-factor/send-otp'));
    };

    await inSequence(['a', 'b', 'c', 'd', 'e'], sendCodeIn);
    await expect(sendCodeIn('f')).rejects.toEqual(refusedWith('TOO_MANY_ATTEMPTS'));
    expect(await hits(`email-code:user:${support.id}`)).toBe(6);
  });
});
