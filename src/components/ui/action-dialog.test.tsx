/**
 * @file Tests for the button that opens a dialog with a short form for an
 * action: an opening button that its own action disables keeps keyboard
 * focus and ignores presses, except while signed in as a user; a refused
 * action is shown in the dialog only, anew each time, and one Escape closes
 * the dialog.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ActionDialog from './action-dialog';
import { SignedInAsMarker } from './signed-in-as';
import { Toaster } from './toast';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns The router.
   */
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * "Reset two-step verification", which its own action turns off once nothing
 * is left to reset.
 *
 * @param props - Harness props.
 * @param props.nothingLeft - Whether nothing is left to reset.
 * @returns The action dialog.
 */
function ResetMfa({ nothingLeft }: { nothingLeft: boolean }) {
  return (
    <ActionDialog
      action={vi.fn()}
      triggerLabel="Reset two-step verification"
      title="Reset Jane's two-step verification?"
      description="She signs in with her password only until she sets it up again."
      confirmLabel="Reset"
      disabled={nothingLeft}
      focusableWhenDisabled
    />
  );
}

describe('ActionDialog', () => {
  it('opens its dialog from the button', async () => {
    const user = userEvent.setup();
    render(<ResetMfa nothingLeft={false} />);

    await user.click(screen.getByRole('button', { name: 'Reset two-step verification' }));

    expect(
      screen.getByRole('dialog', { name: "Reset Jane's two-step verification?" }),
    ).toBeInTheDocument();
  });

  it('keeps focus on a button its own action disables, which then opens nothing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ResetMfa nothingLeft={false} />);
    const button = screen.getByRole('button', { name: 'Reset two-step verification' });
    button.focus();

    // The refresh after the action: nothing is left to reset.
    rerender(<ResetMfa nothingLeft />);

    expect(button).toHaveFocus();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('points its button to the text that explains it', () => {
    render(
      <>
        <ActionDialog
          action={vi.fn()}
          triggerLabel="Add to company"
          title="Add Jane to a company"
          description="She becomes a member right away."
          confirmLabel="Add to company"
          disabled
          focusableWhenDisabled
          describedBy="why-off"
        />
        <p id="why-off">This account is deactivated. Reactivate it first.</p>
      </>,
    );

    const button = screen.getByRole('button', { name: 'Add to company' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('This account is deactivated. Reactivate it first.');
  });

  it('has no description unless it’s given one', () => {
    render(<ResetMfa nothingLeft={false} />);

    expect(screen.getByRole('button', { name: 'Reset two-step verification' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('is disabled all the same while signed in as a user', () => {
    render(
      <>
        <SignedInAsMarker />
        <ResetMfa nothingLeft={false} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Reset two-step verification' })).toBeDisabled();
  });

  it('shows a refusal in the dialog only, anew each time, and closes with one Escape', async () => {
    const user = userEvent.setup();
    // The same refusal every time, as a new result, like a wrong password typed twice.
    const action = vi.fn(async () => ({
      ok: false as const,
      message: 'That password is incorrect.',
    }));
    render(
      <>
        <Toaster />
        <ActionDialog
          action={action}
          triggerLabel="Deactivate"
          title="Deactivate your account?"
          description="You're signed out on every device right away."
          confirmLabel="Deactivate my account"
        />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate your account?' });
    const submit = within(dialog).getByRole('button', { name: 'Deactivate my account' });

    await user.click(submit);
    const first = await within(dialog).findByRole('alert');
    expect(first).toHaveTextContent('That password is incorrect.');
    expect(first).toHaveFocus();

    await user.click(submit);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    // A new alert in the old one's place, which is announced and takes focus again.
    await waitFor(() => expect(within(dialog).getByRole('alert')).not.toBe(first));
    expect(within(dialog).getByRole('alert')).toHaveFocus();

    // No toast above the dialog (the region is hidden from assistive technology meanwhile).
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(document.querySelectorAll('[role="region"] li')).toHaveLength(0);
    expect(screen.getAllByText('That password is incorrect.')).toHaveLength(1);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
