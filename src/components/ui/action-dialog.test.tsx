/**
 * @file Tests for the button that opens a dialog with a short form for an
 * action: an opening button that its own action disables keeps keyboard
 * focus and ignores presses, except while signed in as a user.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ActionDialog from './action-dialog';
import { SignedInAsMarker } from './signed-in-as';

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

  it('is disabled all the same while signed in as a user', () => {
    render(
      <>
        <SignedInAsMarker />
        <ResetMfa nothingLeft={false} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Reset two-step verification' })).toBeDisabled();
  });
});
