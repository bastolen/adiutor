/**
 * @file Tests for the two-step verification card on the Security page:
 * setting it up and turning it off need a recent confirmation with the second
 * step, so without one the card sends the user to the step-up page instead of
 * opening a dialog, and it does the same when the server refuses for that
 * reason. Turn off is described by the note next to it, which says why it's
 * disabled when the role requires MFA and the app is what gives it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import confirmChangeUrl from '@/lib/sign-in/confirm-url';

import ConfirmationWindow from '../../../../../tests/ui/confirmation-window';
import TwoFactorCard from './two-factor-card';

/** The step-up page, coming back to this card on the Security page. */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl('/account/security#two-step');

/** Mocked Better Auth client methods and router. */
const { enable, disable, generateBackupCodes, push, refresh } = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  generateBackupCodes: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({
  default: {
    twoFactor: {
      enable,
      disable,
      generateBackupCodes,
      verifyTotp: vi.fn(),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn(),
    },
  },
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` and `refresh` are recorded.
   */
  useRouter: () => ({ push, refresh }),
}));

/** Two-step verification is off, and email codes can be used. */
const off: ComponentProps<typeof TwoFactorCard> = {
  email: 'jane@adiutor.test',
  enabled: false,
  authenticatorSetUp: false,
  emailCodes: 'available',
  hasPassword: true,
  turnOffBlockedReason: null,
};

/** Two-step verification is on with an authenticator app. */
const on: ComponentProps<typeof TwoFactorCard> = {
  ...off,
  enabled: true,
  authenticatorSetUp: true,
  emailCodes: 'replaced',
};

/**
 * Renders the card on a Security page that needs a recent confirmation.
 *
 * @param props - Card props.
 * @param windowOpen - Whether the confirmation window is still open.
 */
function renderCard(props: ComponentProps<typeof TwoFactorCard>, windowOpen: boolean) {
  render(
    <ConfirmationWindow windowOpen={windowOpen} returnTo="/account/security">
      <TwoFactorCard {...props} />
    </ConfirmationWindow>,
  );
}

describe('TwoFactorCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('without a recent confirmation', () => {
    it.each([
      ['Use an authenticator app', off],
      ['Use email codes', off],
      ['Turn off', on],
      ['New backup codes', on],
    ])('sends the user to confirm instead of opening “%s”', async (name, props) => {
      const user = userEvent.setup();
      renderCard(props, false);

      await user.click(screen.getByRole('button', { name }));

      expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('while the window is open', () => {
    it('opens the authenticator app setup', async () => {
      const user = userEvent.setup();
      renderCard(off, true);

      await user.click(screen.getByRole('button', { name: 'Use an authenticator app' }));

      expect(
        screen.getByRole('dialog', { name: 'Set up an authenticator app' }),
      ).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });

    it('asks before turning it off, and turns it off', async () => {
      const user = userEvent.setup();
      disable.mockResolvedValue({ data: { status: true }, error: null });
      renderCard(on, true);

      await user.click(screen.getByRole('button', { name: 'Turn off' }));
      expect(
        screen.getByRole('dialog', { name: 'Turn off two-step verification?' }),
      ).toBeInTheDocument();
      await user.type(screen.getByLabelText('Current password'), 'adiutor-tests-password');
      await user.click(screen.getByRole('button', { name: 'Turn off' }));

      expect(disable).toHaveBeenCalledWith({ password: 'adiutor-tests-password' });
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('Turn off', () => {
    /** The note next to Turn off when it's allowed. */
    const NOTE = 'Turning it off makes your password enough to sign in.';

    /** Why it can't be turned off. */
    const KEEP_REASON = 'Your role requires MFA, so your authenticator app stays on.';

    it('is described by the note next to it', () => {
      render(<TwoFactorCard {...on} />);

      const turnOff = screen.getByRole('button', { name: 'Turn off' });
      expect(turnOff).toBeEnabled();
      expect(turnOff).toHaveAttribute('aria-describedby', screen.getByText(NOTE).id);
      expect(turnOff).toHaveAccessibleDescription(NOTE);
    });

    it('is disabled, with the reason in the note, when the role needs it', () => {
      render(<TwoFactorCard {...on} turnOffBlockedReason={KEEP_REASON} />);

      const turnOff = screen.getByRole('button', { name: 'Turn off' });
      expect(turnOff).toBeDisabled();
      expect(screen.getByText(KEEP_REASON)).toBeInTheDocument();
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
      expect(turnOff).toHaveAttribute('aria-describedby', screen.getByText(KEEP_REASON).id);
      expect(turnOff).toHaveAccessibleDescription(KEEP_REASON);
    });

    it('isn’t offered while two-step verification is off', () => {
      render(<TwoFactorCard {...off} turnOffBlockedReason={KEEP_REASON} />);

      expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
      expect(screen.queryByText(KEEP_REASON)).not.toBeInTheDocument();
    });
  });

  describe('when the server refuses for lack of a recent confirmation', () => {
    it('sends the user to confirm instead of showing an error when turning it off', async () => {
      const user = userEvent.setup();
      disable.mockResolvedValue({
        data: null,
        error: { code: 'MFA_VERIFICATION_REQUIRED', message: 'Confirm it’s you first' },
      });
      renderCard(on, true);

      await user.click(screen.getByRole('button', { name: 'Turn off' }));
      await user.type(screen.getByLabelText('Current password'), 'adiutor-tests-password');
      await user.click(screen.getByRole('button', { name: 'Turn off' }));

      await waitFor(() => expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sends the user to confirm instead of showing an error when setting up the app', async () => {
      const user = userEvent.setup();
      enable.mockResolvedValue({
        data: null,
        error: { code: 'MFA_VERIFICATION_REQUIRED', message: 'Confirm it’s you first' },
      });
      renderCard(off, true);

      await user.click(screen.getByRole('button', { name: 'Use an authenticator app' }));
      await user.type(screen.getByLabelText('Current password'), 'adiutor-tests-password');
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL));
      expect(enable).toHaveBeenCalledWith({ method: 'totp', password: 'adiutor-tests-password' });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('still shows other refusals, e.g. a wrong password', async () => {
      const user = userEvent.setup();
      disable.mockResolvedValue({
        data: null,
        error: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
      });
      renderCard(on, true);

      await user.click(screen.getByRole('button', { name: 'Turn off' }));
      await user.type(screen.getByLabelText('Current password'), 'wrong-password');
      await user.click(screen.getByRole('button', { name: 'Turn off' }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });
  });
});
