/**
 * @file Tests for the passkeys card on the Security page: adding and
 * removing a passkey need a recent confirmation with the second step, so
 * without one the card sends the user to the step-up page instead of opening
 * a dialog, and it does the same when the server refuses for that reason.
 * Renaming only needs a confirmed session, so it never asks first. When the
 * only passkey is what gives a role its required MFA, Remove is disabled and
 * linked to the reason. The name field stops at the longest name the server
 * accepts, and a name it refuses shows why.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import type { PasskeySummary } from '@/server/auth/security';

import PasskeysCard from './passkeys-card';

/** The step-up page, coming back to this card on the Security page. */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl('/account/security#passkeys');

/** Mocked Better Auth client methods and router. */
const { addPasskey, deletePasskey, updatePasskey, push, refresh } = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  updatePasskey: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({
  default: { passkey: { addPasskey, deletePasskey, updatePasskey } },
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` and `refresh` are recorded.
   */
  useRouter: () => ({ push, refresh }),
}));

/** A passkey the user added earlier. */
const laptop: PasskeySummary = {
  id: '01970000-0000-7000-8000-000000000011',
  name: 'Work laptop',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: new Date('2026-10-20T09:00:00Z'),
};

/**
 * Renders the card on a Security page that needs a recent confirmation.
 *
 * @param windowOpen - Whether the confirmation window is still open.
 */
function renderCard(windowOpen: boolean) {
  const serverTime = Date.now();
  render(
    <RecentConfirmationProvider
      required
      confirmedUntil={windowOpen ? serverTime + 10 * 60 * 1000 : null}
      serverTime={serverTime}
      returnTo="/account/security"
    >
      <PasskeysCard passkeys={[laptop]} removeLastBlockedReason={null} />
    </RecentConfirmationProvider>,
  );
}

describe('PasskeysCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Add passkey', () => {
    it('sends the user to confirm instead of opening the dialog without a recent confirmation', async () => {
      const user = userEvent.setup();
      renderCard(false);

      await user.click(screen.getByRole('button', { name: 'Add passkey' }));

      expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(addPasskey).not.toHaveBeenCalled();
    });

    it('opens the dialog while the window is open', async () => {
      const user = userEvent.setup();
      renderCard(true);

      await user.click(screen.getByRole('button', { name: 'Add passkey' }));

      expect(screen.getByRole('dialog', { name: 'Add a passkey' })).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });

    it('sends the user to confirm when the server refuses for lack of a recent confirmation', async () => {
      const user = userEvent.setup();
      addPasskey.mockResolvedValue({
        error: { code: 'MFA_VERIFICATION_REQUIRED', message: 'Confirm it’s you first' },
      });
      renderCard(true);

      await user.click(screen.getByRole('button', { name: 'Add passkey' }));
      await user.click(screen.getByRole('button', { name: 'Create passkey' }));

      await waitFor(() => expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Remove', () => {
    it('sends the user to confirm instead of asking to remove without a recent confirmation', async () => {
      const user = userEvent.setup();
      renderCard(false);

      await user.click(screen.getByRole('button', { name: 'Remove Work laptop' }));

      expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(deletePasskey).not.toHaveBeenCalled();
    });

    it('removes the passkey after confirming while the window is open', async () => {
      const user = userEvent.setup();
      deletePasskey.mockResolvedValue({ data: { status: true }, error: null });
      renderCard(true);

      await user.click(screen.getByRole('button', { name: 'Remove Work laptop' }));
      await user.click(screen.getByRole('button', { name: 'Remove passkey' }));

      expect(deletePasskey).toHaveBeenCalledWith({ id: laptop.id });
      expect(await screen.findByRole('status')).toHaveTextContent('Work laptop was removed.');
      expect(push).not.toHaveBeenCalled();
    });

    it('shows the passkey being removed as busy until it’s gone', async () => {
      const user = userEvent.setup();
      /** Settles the removal, which the test holds back while it checks the busy state. */
      let finish: (result: unknown) => void = () => {};
      deletePasskey.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      renderCard(true);

      await user.click(screen.getByRole('button', { name: 'Remove Work laptop' }));
      await user.click(screen.getByRole('button', { name: 'Remove passkey' }));

      const remove = await screen.findByRole('button', { name: 'Remove Work laptop' });
      await waitFor(() => expect(remove).toHaveAttribute('aria-busy', 'true'));
      expect(remove).toBeDisabled();
      finish({ data: { status: true }, error: null });
      expect(await screen.findByRole('status')).toHaveTextContent('Work laptop was removed.');
    });

    it('sends the user to confirm when the server refuses for lack of a recent confirmation', async () => {
      const user = userEvent.setup();
      deletePasskey.mockResolvedValue({
        data: null,
        error: { code: 'MFA_VERIFICATION_REQUIRED', message: 'Confirm it’s you first' },
      });
      renderCard(true);

      await user.click(screen.getByRole('button', { name: 'Remove Work laptop' }));
      await user.click(screen.getByRole('button', { name: 'Remove passkey' }));

      await waitFor(() => expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows other refusals', async () => {
      const user = userEvent.setup();
      deletePasskey.mockResolvedValue({
        data: null,
        error: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' },
      });
      renderCard(true);

      await user.click(screen.getByRole('button', { name: 'Remove Work laptop' }));
      await user.click(screen.getByRole('button', { name: 'Remove passkey' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/isn't linked/);
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('when the role requires MFA and the passkey is what gives it', () => {
    /** Why the only passkey can't be removed. */
    const KEEP_REASON = 'Your role requires MFA, so keep this passkey.';

    /** A second passkey. */
    const phone: PasskeySummary = {
      ...laptop,
      id: '01970000-0000-7000-8000-000000000012',
      name: 'iPhone',
    };

    it('disables Remove for the only passkey and links it to the reason', () => {
      render(<PasskeysCard passkeys={[laptop]} removeLastBlockedReason={KEEP_REASON} />);

      const remove = screen.getByRole('button', { name: 'Remove Work laptop' });
      expect(remove).toBeDisabled();
      expect(remove).toHaveAttribute('aria-describedby', screen.getByText(KEEP_REASON).id);
      expect(remove).toHaveAccessibleDescription(KEEP_REASON);
    });

    it('lets either of two passkeys be removed, without the reason', () => {
      render(<PasskeysCard passkeys={[laptop, phone]} removeLastBlockedReason={KEEP_REASON} />);

      ['Remove Work laptop', 'Remove iPhone'].forEach((name) => {
        const remove = screen.getByRole('button', { name });
        expect(remove).toBeEnabled();
        expect(remove).not.toHaveAttribute('aria-describedby');
      });
      expect(screen.queryByText(KEEP_REASON)).not.toBeInTheDocument();
    });

    it('leaves Remove enabled and undescribed when nothing is blocked', () => {
      render(<PasskeysCard passkeys={[laptop]} removeLastBlockedReason={null} />);

      const remove = screen.getByRole('button', { name: 'Remove Work laptop' });
      expect(remove).toBeEnabled();
      expect(remove).not.toHaveAttribute('aria-describedby');
    });
  });

  it('opens Rename without a recent confirmation', async () => {
    const user = userEvent.setup();
    renderCard(false);

    await user.click(screen.getByRole('button', { name: 'Rename Work laptop' }));

    expect(screen.getByRole('dialog', { name: 'Rename passkey' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('caps the name at 64 characters and explains a name the server refuses', async () => {
    const user = userEvent.setup();
    updatePasskey.mockResolvedValue({
      error: { code: 'INVALID_PASSKEY_NAME', message: 'Invalid passkey name' },
    });
    renderCard(false);

    await user.click(screen.getByRole('button', { name: 'Rename Work laptop' }));
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field).toHaveAttribute('maxlength', '64');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a passkey name of 1 to 64 characters, without line breaks or invisible characters.',
    );
    expect(screen.getByRole('dialog', { name: 'Rename passkey' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
