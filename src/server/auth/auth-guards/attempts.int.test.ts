/**
 * @file Integration tests for the limits on attempts: wrong passwords, wrong
 * step-up codes and emailed codes.
 */
import { addOAuthServerContext, getSessionFromCtx } from 'better-auth/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countFailedSignIn,
  endEmailCodeCooldown,
  settlePasswordAttempt,
  settleStepUpAttempt,
} from './attempts';
import { beforeAuthRequest } from './before-request';
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
import {
  createCompany,
  createUser,
  enableTwoFactor,
  inSequence,
  memberActor,
  staffActor,
} from '../../../../tests/integration/helpers';
import { clearFailedSignIns } from '../../rate-limit';

vi.mock('@/db', async (importOriginal) =>
  (await import('../../../../tests/integration/app-modules')).default(await importOriginal()),
);

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: vi.fn(),
  // Better Auth's request state isn't there outside a request; the tests watch what's added.
  addOAuthServerContext: vi.fn(),
}));

// Watched, to check when the checks read a user's MFA state; it still reads it.
vi.mock('../mfa-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mfa-state')>();
  return { ...actual, loadMfaContext: vi.fn(actual.loadMfaContext) };
});

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

    await sendCodesOverTime(5, request('/two-factor/send-otp'), support.id);
    await waitForNextCode(support.id);
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

  it('lets a new code through once the wait is over, or once a code was used', async () => {
    const support = await staffActor(db, 'support');
    await enableTwoFactor(db, support.id, 'email');
    const sendCode = request('/two-factor/send-otp', { pendingUserId: support.id });

    await beforeAuthRequest(sendCode);
    await waitForNextCode(support.id);
    await expect(beforeAuthRequest(sendCode)).resolves.toBeUndefined();

    await endEmailCodeCooldown(support.id);
    await expect(beforeAuthRequest(sendCode)).resolves.toBeUndefined();
  });
});
