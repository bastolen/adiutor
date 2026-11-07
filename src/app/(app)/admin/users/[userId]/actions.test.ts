/**
 * @file Tests for the user detail page's MFA reset action: without the
 * Admin's recent confirmation it sends them to the step-up page, which
 * returns to the user's page, and otherwise it resets through the service.
 */
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { resetUserMfa } from '@/server/people/user-admin';

import { resetMfaAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/people/user-admin', () => ({
  deactivateUser: vi.fn(),
  deleteUser: vi.fn(),
  reactivateUser: vi.fn(),
  resetUserMfa: vi.fn(),
  signOutUserEverywhere: vi.fn(),
}));

/** The user being reset. */
const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

/** A staff Admin with an authenticator app, confirmed with it a minute ago. */
const confirmedAdmin = {
  id: 'admin-1',
  canConfirmSessions: true,
  mfaConfirmedUntil: new Date(Date.now() + 14 * 60_000),
};

/**
 * Builds the reset dialog's form.
 *
 * @param fields - The fields.
 * @returns The form data.
 */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([name, value]) => data.set(name, value));
  return data;
}

/**
 * Makes `getActor` return an actor.
 *
 * @param actor - The actor's MFA facts.
 */
function signedInAs(actor: object): void {
  vi.mocked(getActor).mockResolvedValue(actor as Awaited<ReturnType<typeof getActor>>);
}

beforeEach(() => {
  vi.mocked(redirect).mockClear();
  vi.mocked(resetUserMfa).mockReset();
  signedInAs(confirmedAdmin);
});

describe('resetMfaAction', () => {
  it("sends the Admin to confirm it's them first, coming back to the user's page", async () => {
    signedInAs({ ...confirmedAdmin, mfaConfirmedUntil: null });

    await expect(resetMfaAction(null, form({ userId: USER_ID }))).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(
      `/auth/verify?callbackURL=%2Fadmin%2Fusers%2F${USER_ID}&for=change`,
    );
    expect(resetUserMfa).not.toHaveBeenCalled();
  });

  it('comes back to the card the form was in, with the tables as they were', async () => {
    signedInAs({ ...confirmedAdmin, mfaConfirmedUntil: null });
    const returnTo = `/admin/users/${USER_ID}?companies-page=2#account-access`;

    await expect(resetMfaAction(null, form({ userId: USER_ID, returnTo }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(redirect).toHaveBeenCalledWith(
      `/auth/verify?callbackURL=${encodeURIComponent(returnTo)}&for=change`,
    );
  });

  it('puts only an ID into the return address', async () => {
    signedInAs({ ...confirmedAdmin, mfaConfirmedUntil: null });

    expect(await resetMfaAction(null, form({ userId: '/api/auth/sign-out' }))).toEqual({
      ok: false,
      message: "This page doesn't exist or you don't have access to it.",
    });
    expect(redirect).not.toHaveBeenCalled();
    expect(resetUserMfa).not.toHaveBeenCalled();
  });

  it('resets through the service once confirmed, with or without the passkeys', async () => {
    expect(await resetMfaAction(null, form({ userId: USER_ID, removePasskeys: 'on' }))).toEqual({
      ok: true,
      message: 'Two-step verification was reset.',
    });
    await resetMfaAction(null, form({ userId: USER_ID }));

    const appContext = { name: 'app context' };
    expect(resetUserMfa).toHaveBeenNthCalledWith(1, appContext, confirmedAdmin, USER_ID, {
      removePasskeys: true,
    });
    expect(resetUserMfa).toHaveBeenNthCalledWith(2, appContext, confirmedAdmin, USER_ID, {
      removePasskeys: false,
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
