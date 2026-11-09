/**
 * @file Tests for the "Deactivate account" card on the Security page:
 * deactivating needs a recent confirmation with the second step, so without
 * one the button sends the user to the step-up page instead of opening the
 * dialog; with one (or without a second step) the dialog opens, asking for
 * the password when the user has one. While they're the last Admin of
 * something, it only says why.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';

import DeactivateCard from './deactivate-card';

/** The step-up page, coming back to this card on the Security page. */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl('/account/security#deactivate');

/** The mocked server action and router. */
const { deactivateAccountAction, push } = vi.hoisted(() => ({
  deactivateAccountAction: vi.fn(),
  push: vi.fn(),
}));

vi.mock('./actions', () => ({ deactivateAccountAction }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

/**
 * Renders the card on a Security page that needs a recent confirmation.
 *
 * @param props - Card props.
 * @param props.hasPassword - Whether the user has a password.
 * @param props.blockedReason - Why deactivating is blocked, if it is.
 * @param windowOpen - Whether the confirmation window is still open.
 */
function renderCard(
  props: { hasPassword: boolean; blockedReason: string | null },
  windowOpen: boolean,
) {
  const serverTime = Date.now();
  render(
    <RecentConfirmationProvider
      required
      confirmedUntil={windowOpen ? serverTime + 10 * 60 * 1000 : null}
      serverTime={serverTime}
      returnTo="/account/security"
    >
      <DeactivateCard {...props} />
    </RecentConfirmationProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  deactivateAccountAction.mockReset();
});

describe('DeactivateCard', () => {
  it('sends the user to confirm it’s them first, without opening the dialog', async () => {
    renderCard({ hasPassword: true, blockedReason: null }, false);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the dialog, asking for the password, within the confirmation window', async () => {
    renderCard({ hasPassword: true, blockedReason: null }, true);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    const dialog = screen.getByRole('dialog', { name: 'Deactivate your account?' });
    expect(dialog).toContainElement(screen.getByLabelText('Current password'));
    expect(push).not.toHaveBeenCalled();
  });

  it('opens the dialog without a password field on an account without one or a second step', async () => {
    render(<DeactivateCard hasPassword={false} blockedReason={null} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(screen.getByRole('dialog', { name: 'Deactivate your account?' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('only says why while the user is the last Admin of something', () => {
    // The page gives the reason and what to do first (`soleAdminError`, in the reader's language).
    const reason = 'You are the only staff Admin. Make someone else an Admin first.';
    renderCard({ hasPassword: true, blockedReason: reason }, true);

    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });
});
