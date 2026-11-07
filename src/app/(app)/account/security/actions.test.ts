/**
 * @file Tests for the Security page's actions: a first password goes through
 * `setFirstPassword` (which applies the MFA rules under the user's lock) and
 * a change through `changeOwnPassword` (which limits wrong current
 * passwords), never straight through Better Auth, and refusals are shown.
 * Deactivating the account sends the user to confirm it's them first when
 * that's needed.
 */
import { APIError } from 'better-auth/api';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/lib/auth';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import { changeOwnPassword, hasPassword, setFirstPassword } from '@/server/auth/accounts';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { deactivateOwnAccount } from '@/server/people/user-admin';

import { deactivateAccountAction, passwordAction } from './actions';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      setPassword: vi.fn(),
      changePassword: vi.fn(),
      unlinkAccount: vi.fn(),
      signOut: vi.fn(async () => undefined),
    },
  },
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/auth/accounts', () => ({
  changeOwnPassword: vi.fn(),
  confirmConnectedProvider: vi.fn(),
  hasPassword: vi.fn(),
  listConnectedProviders: vi.fn(),
  setFirstPassword: vi.fn(),
}));
vi.mock('@/server/auth/sessions', () => ({}));
vi.mock('@/server/people/user-admin', () => ({ deactivateOwnAccount: vi.fn() }));

/** The signed-in user, without a second step. */
const actor = { id: 'user-1', canConfirmSessions: false, mfaConfirmedUntil: null };

/**
 * Builds the form a user submits.
 *
 * @param fields - The fields.
 * @returns The form data.
 */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([name, value]) => data.set(name, value));
  return data;
}

/** A first password, typed twice. */
const firstPassword = form({
  newPassword: 'adiutor-tests-password',
  confirmation: 'adiutor-tests-password',
});

/** A changed password: the current one, and the new one typed twice. */
const changedPassword = form({
  currentPassword: 'adiutor-tests-old-password',
  newPassword: 'adiutor-tests-password',
  confirmation: 'adiutor-tests-password',
});

beforeEach(() => {
  vi.mocked(getActor).mockResolvedValue(actor as Awaited<ReturnType<typeof getActor>>);
  vi.mocked(hasPassword).mockResolvedValue(false);
  vi.mocked(auth.api.setPassword).mockReset();
  vi.mocked(auth.api.changePassword).mockReset();
  vi.mocked(redirect).mockClear();
  vi.mocked(setFirstPassword).mockReset();
  // The services make the change themselves once their checks pass.
  vi.mocked(setFirstPassword).mockImplementation(async (_ctx, _actor, setPassword) => {
    await setPassword();
  });
  vi.mocked(changeOwnPassword).mockReset();
  vi.mocked(changeOwnPassword).mockImplementation(async (_ctx, _actor, change) => {
    await change();
  });
  vi.mocked(deactivateOwnAccount).mockReset();
});

describe('passwordAction', () => {
  it('sets a first password through setFirstPassword, which checks the MFA rules', async () => {
    const result = await passwordAction(null, firstPassword);

    expect(result).toEqual({ ok: true, message: 'Password saved.' });
    expect(setFirstPassword).toHaveBeenCalledWith(
      { name: 'app context' },
      actor,
      expect.any(Function),
    );
    expect(auth.api.setPassword).toHaveBeenCalledTimes(1);
    expect(auth.api.setPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newPassword: 'adiutor-tests-password' } }),
    );
  });

  it("doesn't set it when the service refuses, and says why", async () => {
    vi.mocked(setFirstPassword).mockRejectedValue(
      new ServiceError('forbidden', 'Your role requires MFA, and this would leave you without it.'),
    );

    expect(await passwordAction(null, firstPassword)).toEqual({
      ok: false,
      message: 'Your role requires MFA, and this would leave you without it.',
    });
    expect(auth.api.setPassword).not.toHaveBeenCalled();
  });

  it('says when another change to how the user signs in is still being made', async () => {
    vi.mocked(auth.api.setPassword).mockRejectedValue(
      new APIError('CONFLICT', { code: 'SIGN_IN_CHANGE_IN_PROGRESS', message: 'Conflict' }),
    );

    expect(await passwordAction(null, firstPassword)).toEqual({
      ok: false,
      message: 'Another change to how you sign in is still in progress. Try again in a moment.',
    });
  });

  it("doesn't blame a current password the form doesn't have for Better Auth's other errors", async () => {
    // E.g. a first password set in another tab meanwhile.
    vi.mocked(auth.api.setPassword).mockRejectedValue(
      new APIError('BAD_REQUEST', { code: 'PASSWORD_ALREADY_SET', message: 'Already set' }),
    );

    expect(await passwordAction(null, firstPassword)).toEqual({
      ok: false,
      message: 'Saving the password failed. Please try again.',
    });
  });

  it('sends the user to sign in again when their session ended meanwhile', async () => {
    vi.mocked(auth.api.setPassword).mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'Unauthorized' }),
    );

    await expect(passwordAction(null, firstPassword)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/auth');
  });
});

describe('passwordAction when changing the password', () => {
  beforeEach(() => {
    vi.mocked(hasPassword).mockResolvedValue(true);
  });

  it('changes it through changeOwnPassword, which limits wrong current passwords', async () => {
    const result = await passwordAction(null, changedPassword);

    expect(result).toEqual({ ok: true, message: 'Password saved.' });
    expect(changeOwnPassword).toHaveBeenCalledWith(
      { name: 'app context' },
      actor,
      expect.any(Function),
    );
    expect(auth.api.changePassword).toHaveBeenCalledTimes(1);
    expect(auth.api.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          currentPassword: 'adiutor-tests-old-password',
          newPassword: 'adiutor-tests-password',
          revokeOtherSessions: true,
        },
      }),
    );
  });

  it('shows a wrong password and the limit as the service words them', async () => {
    vi.mocked(changeOwnPassword).mockRejectedValueOnce(
      new ServiceError('invalid', 'Your current password is incorrect.'),
    );
    expect(await passwordAction(null, changedPassword)).toEqual({
      ok: false,
      message: 'Your current password is incorrect.',
    });

    vi.mocked(changeOwnPassword).mockRejectedValueOnce(
      new ServiceError('rate_limited', 'Too many attempts. Try again in 15 minutes.'),
    );
    expect(await passwordAction(null, changedPassword)).toEqual({
      ok: false,
      message: 'Too many attempts. Try again in 15 minutes.',
    });
    expect(auth.api.changePassword).not.toHaveBeenCalled();
  });

  it("doesn't blame the current password for Better Auth's other errors", async () => {
    // E.g. the password removed meanwhile; a wrong current password is the service's to word.
    vi.mocked(auth.api.changePassword).mockRejectedValue(
      new APIError('BAD_REQUEST', { code: 'CREDENTIAL_ACCOUNT_NOT_FOUND', message: 'Not found' }),
    );

    expect(await passwordAction(null, changedPassword)).toEqual({
      ok: false,
      message: 'Saving the password failed. Please try again.',
    });
  });

  it("still words Better Auth's other refusals", async () => {
    vi.mocked(auth.api.changePassword).mockRejectedValue(
      new APIError('CONFLICT', { code: 'SIGN_IN_CHANGE_IN_PROGRESS', message: 'Conflict' }),
    );

    expect(await passwordAction(null, changedPassword)).toEqual({
      ok: false,
      message: 'Another change to how you sign in is still in progress. Try again in a moment.',
    });
  });
});

describe('deactivateAccountAction', () => {
  it('sends the user to confirm first when the account has a second step to confirm with', async () => {
    vi.mocked(getActor).mockResolvedValue({
      ...actor,
      canConfirmSessions: true,
      mfaConfirmedUntil: null,
    } as unknown as Awaited<ReturnType<typeof getActor>>);

    await expect(deactivateAccountAction(null, form({ password: '' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(redirect).toHaveBeenCalledWith(confirmChangeUrl('/account/security'));
    expect(deactivateOwnAccount).not.toHaveBeenCalled();
  });

  it('comes back to the card the form was in, with the tables as they were', async () => {
    vi.mocked(getActor).mockResolvedValue({
      ...actor,
      canConfirmSessions: true,
      mfaConfirmedUntil: null,
    } as unknown as Awaited<ReturnType<typeof getActor>>);

    await expect(
      deactivateAccountAction(
        null,
        form({ password: '', returnTo: '/account/security?devices-page=2#deactivate' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(
      '/auth/verify?callbackURL=%2Faccount%2Fsecurity%3Fdevices-page%3D2%23deactivate&for=change',
    );
  });

  it('deactivates through the service with the typed password, then signs out', async () => {
    await expect(
      deactivateAccountAction(null, form({ password: 'adiutor-tests-password' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(deactivateOwnAccount).toHaveBeenCalledWith(
      { name: 'app context' },
      actor,
      'adiutor-tests-password',
    );
    expect(auth.api.signOut).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/auth?error=ACCOUNT_DEACTIVATED');
  });

  it("shows the service's refusal, e.g. a sign-in that's too old", async () => {
    vi.mocked(deactivateOwnAccount).mockRejectedValue(
      new ServiceError(
        'forbidden',
        'For your security, sign out and in again before changing this.',
      ),
    );

    expect(await deactivateAccountAction(null, form({ password: '' }))).toEqual({
      ok: false,
      message: 'For your security, sign out and in again before changing this.',
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
