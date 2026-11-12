/**
 * @file Tests for the user detail page's MFA reset action (without the
 * Admin's recent confirmation it sends them to the step-up page, which
 * returns to the user's page, and otherwise it resets through the service)
 * and its sign-in as the user (the same, with a strong second step).
 */
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startImpersonation } from '@/server/auth/impersonation';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { resetUserMfa } from '@/server/people/user-admin';

import { resetMfaAction, signInAsAction } from './actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
// The real refusal while signed in as someone, so the actions are tried with it.
vi.mock('@/server/authz', async () => ({
  getActor: vi.fn(),
  assertNotSignedInAs: (await import('@/server/signed-in-as')).default,
}));
vi.mock('@/server/auth/impersonation', () => ({ startImpersonation: vi.fn() }));
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
  it('refuses while a staff member is signed in as the Admin, without sending them to confirm', async () => {
    signedInAs({
      ...confirmedAdmin,
      mfaConfirmedUntil: null,
      signedInAs: { staffId: 'staff-1', staffName: 'Sam Lee', endsAt: new Date(), returnTo: '/' },
    });

    expect(await resetMfaAction(null, form({ userId: USER_ID }))).toEqual({
      ok: false,
      message:
        "This can't be changed while you're signed in as someone else. Go back to your own account first.",
    });
    expect(redirect).not.toHaveBeenCalled();
    expect(resetUserMfa).not.toHaveBeenCalled();
  });

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

describe('signInAsAction', () => {
  /** A Support member with a passkey, confirmed with it a minute ago. */
  const confirmedSupport = {
    id: 'support-1',
    strongMfa: true,
    strongMfaConfirmedUntil: new Date(Date.now() + 14 * 60_000),
    signedInAs: null,
  };

  /**
   * Builds the card's form: the user, a reason and the card to come back to.
   *
   * @returns The form data.
   */
  const signInForm = () =>
    form({
      userId: USER_ID,
      reason: 'Ticket 12',
      returnTo: `/admin/users/${USER_ID}#sign-in-as`,
    });

  beforeEach(() => {
    vi.mocked(startImpersonation).mockReset();
  });

  it('starts it with the reason and the card to come back to, then opens the dashboard', async () => {
    signedInAs(confirmedSupport);

    await expect(signInAsAction(null, signInForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(startImpersonation).toHaveBeenCalledWith({ name: 'app context' }, confirmedSupport, {
      userId: USER_ID,
      reason: 'Ticket 12',
      returnTo: `/admin/users/${USER_ID}#sign-in-as`,
    });
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('sends the staff member to confirm with a strong second step first, back to the card', async () => {
    signedInAs({ ...confirmedSupport, strongMfaConfirmedUntil: null });

    await expect(signInAsAction(null, signInForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(
      `/auth/verify?callbackURL=${encodeURIComponent(`/admin/users/${USER_ID}#sign-in-as`)}&for=strong`,
    );
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it("shows the service's refusal, e.g. without strong MFA, where there's nothing to confirm with", async () => {
    signedInAs({ ...confirmedSupport, strongMfa: false, strongMfaConfirmedUntil: null });
    vi.mocked(startImpersonation).mockRejectedValue(
      new ServiceError('forbidden', 'errors.impersonation.needsMfa'),
    );

    expect(await signInAsAction(null, signInForm())).toEqual({
      ok: false,
      message:
        'To sign in as someone, first add a passkey or set up an authenticator app on your Security page.',
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
