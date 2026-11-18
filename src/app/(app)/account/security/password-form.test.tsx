/**
 * @file Tests for the password form: setting a first password on an account
 * with a second step asks to confirm it's the user first, changing an
 * existing one doesn't. When a first password would take away the MFA the
 * user's role requires, only the reason is shown.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';

import ConfirmationWindow from '../../../../../tests/ui/confirmation-window';
import PasswordForm from './password-form';

/** The step-up page, coming back to the Security page (outside a card here). */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl('/account/security');

/** Mocked router and server action. */
const { push, passwordAction } = vi.hoisted(() => ({
  push: vi.fn(),
  passwordAction: vi.fn(async () => ({ ok: true as const, message: 'Password saved.' })),
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

vi.mock('./actions', () => ({ passwordAction }));

beforeEach(() => {
  push.mockClear();
  passwordAction.mockClear();
});

/**
 * Renders the form on a Security page whose confirmation window has run out.
 *
 * @param hasPassword - Whether the user has a password already.
 */
function renderWithoutConfirmation(hasPassword: boolean) {
  render(
    <ConfirmationWindow windowOpen={false} returnTo="/account/security">
      <PasswordForm hasPassword={hasPassword} blockedReason={null} />
    </ConfirmationWindow>,
  );
}

/**
 * Fills in and submits the new password.
 *
 * @param withCurrent - Also fill in the current password.
 */
function submitNewPassword(withCurrent: boolean) {
  if (withCurrent) {
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'adiutor-tests-old-password' },
    });
  }
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'adiutor-tests-new-password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'adiutor-tests-new-password' },
  });
  fireEvent.submit(
    defined(screen.getByRole('button', { name: /password$/ }).closest('form'), 'the form'),
  );
}

describe('PasswordForm', () => {
  it('sends the user to confirm first before a first password, without saving it', () => {
    renderWithoutConfirmation(false);
    submitNewPassword(false);
    expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
    expect(passwordAction).not.toHaveBeenCalled();
  });

  it("doesn't ask before changing an existing password, and submits it", async () => {
    renderWithoutConfirmation(true);
    submitNewPassword(true);
    expect(push).not.toHaveBeenCalled();
    // The form's own check passed, so the shared hook's onSubmit runs the action.
    await vi.waitFor(() => expect(passwordAction).toHaveBeenCalledOnce());
    expect(((passwordAction.mock.calls[0] as unknown[])[1] as FormData).get('newPassword')).toBe(
      'adiutor-tests-new-password',
    );
  });

  describe('when a first password would take away the MFA the role requires', () => {
    /** Why a first password can't be set. */
    const reason = 'Your role requires MFA, and only GitHub with 2FA counts.';

    it('shows only the reason, without the form', () => {
      const { container } = render(<PasswordForm hasPassword={false} blockedReason={reason} />);

      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(container.querySelector('form')).toBeNull();
      expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Confirm new password')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('still lets the user change a password they already have', () => {
      render(<PasswordForm hasPassword blockedReason={reason} />);

      expect(screen.queryByText(reason)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Current password')).toBeInTheDocument();
      expect(screen.getByLabelText('New password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    });

    it('shows the form for a first password when nothing blocks it', () => {
      render(<PasswordForm hasPassword={false} blockedReason={null} />);

      expect(screen.getByLabelText('New password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set password' })).toBeInTheDocument();
    });
  });
});
