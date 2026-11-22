/**
 * @file Tests for the MFA reset action on a user's page (without the
 * Admin's recent confirmation it sends them to the step-up page, which
 * returns to the user's page, and otherwise it resets through the service),
 * its sign-in as the user (the same, with a strong second step) and its
 * deletion (which refreshes before it goes to the users list, so the pages
 * Next kept alive are dropped).
 */
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startImpersonation } from '@/server/auth/impersonation';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { deleteUser, resetUserMfa } from '@/server/people/user-admin';

import form from '../../../../../../tests/ui/form';
import { deleteUserAction, resetMfaAction, signInAsAction } from './actions';

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
 * Makes `getActor` return an actor.
 *
 * @param actor - The actor's MFA facts.
 */
function signedInAs(actor: object): void {
  vi.mocked(getActor).mockResolvedValue(actor as Awaited<ReturnType<typeof getActor>>);
}

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(redirect).mockClear();
  vi.mocked(resetUserMfa).mockReset();
  signedInAs(confirmedAdmin);
});

describe('deleteUserAction', () => {
  beforeEach(() => {
    vi.mocked(deleteUser).mockReset();
  });

  it('refreshes, then goes to the users list, which confirms it', async () => {
    await expect(
      deleteUserAction(null, form({ userId: USER_ID, confirmEmail: 'sam@adiutor.test' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(deleteUser).toHaveBeenCalledWith(
      { name: 'app context' },
      confirmedAdmin,
      USER_ID,
      'sam@adiutor.test',
    );
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/admin/users?deleted=1');
    // A redirect alone would leave the deleted user's page for Back to show.
    expect(refresh).toHaveBeenCalledBefore(vi.mocked(redirect));
  });

  it('says why a deletion was refused, and stays on the page as it is', async () => {
    vi.mocked(deleteUser).mockRejectedValue(new ServiceError('forbidden', 'errors.forbidden'));

    expect(
      await deleteUserAction(null, form({ userId: USER_ID, confirmEmail: 'sam@adiutor.test' })),
    ).toMatchObject({ ok: false });

    expect(refresh).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
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

  it("sends the Admin to confirm it's them first, coming back to the user's Manage tab", async () => {
    signedInAs({ ...confirmedAdmin, mfaConfirmedUntil: null });

    await expect(resetMfaAction(null, form({ userId: USER_ID }))).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(
      `/auth/verify?callbackURL=%2Fadmin%2Fusers%2F${USER_ID}%2Fmanage&for=change`,
    );
    expect(resetUserMfa).not.toHaveBeenCalled();
  });

  it('comes back to the card the form was in', async () => {
    signedInAs({ ...confirmedAdmin, mfaConfirmedUntil: null });
    const returnTo = `/admin/users/${USER_ID}/manage#account-access`;

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
      returnTo: `/admin/users/${USER_ID}/manage#sign-in-as`,
    });

  beforeEach(() => {
    vi.mocked(startImpersonation).mockReset();
  });

  it('starts it with the reason and the card to come back to, leaving the page load to the card', async () => {
    signedInAs(confirmedSupport);

    expect(await signInAsAction(null, signInForm())).toEqual({ ok: true });

    expect(startImpersonation).toHaveBeenCalledWith({ name: 'app context' }, confirmedSupport, {
      userId: USER_ID,
      reason: 'Ticket 12',
      returnTo: `/admin/users/${USER_ID}/manage#sign-in-as`,
    });
    // A redirect would be a navigation within the app, which keeps the pages Next kept alive.
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends the staff member to confirm with a strong second step first, back to the card', async () => {
    signedInAs({ ...confirmedSupport, strongMfaConfirmedUntil: null });

    await expect(signInAsAction(null, signInForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith(
      `/auth/verify?callbackURL=${encodeURIComponent(`/admin/users/${USER_ID}/manage#sign-in-as`)}&for=strong`,
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
