/**
 * @file Tests for the confirmation dialog, opened from its trigger or by the
 * caller.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Button from './button';
import ConfirmDialog from './confirm-dialog';

/**
 * Renders a dialog behind a "Remove" button.
 *
 * @param onConfirm - Called when confirmed.
 */
function renderDialog(onConfirm = vi.fn()) {
  render(
    <ConfirmDialog
      trigger={<Button>Remove</Button>}
      title="Remove Jane?"
      description="She'll lose access to Adiutor Tests."
      confirmLabel="Remove member"
      onConfirm={onConfirm}
    />,
  );
}

describe('ConfirmDialog', () => {
  it('opens as an alert dialog with focus on Cancel, the safe choice', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Remove Jane?' });
    expect(dialog).toHaveAccessibleDescription("She'll lose access to Adiutor Tests.");
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('keeps focus inside while open', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Remove member' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('cancels with Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog(onConfirm);

    const trigger = screen.getByRole('button', { name: 'Remove' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('runs the action when confirmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove member' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  describe('opened by the caller, without a trigger', () => {
    /**
     * Renders an open dialog the caller controls.
     *
     * @param onOpenChange - Called when it opens or closes.
     * @param onCloseAutoFocus - Called as it closes.
     * @returns The rendered dialog, to re-render with other props.
     */
    const renderOpen = (onOpenChange = vi.fn(), onCloseAutoFocus = vi.fn()) =>
      render(
        <ConfirmDialog
          open
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
          title="Step down to Manager?"
          description="You can't raise your own role again."
          confirmLabel="Step down"
          onConfirm={vi.fn()}
        />,
      );

    it('shows while `open` is set, with no trigger of its own', () => {
      const { rerender } = renderOpen();

      expect(screen.getByRole('alertdialog', { name: 'Step down to Manager?' })).toBeVisible();
      rerender(
        <ConfirmDialog
          open={false}
          title="Step down to Manager?"
          description="You can't raise your own role again."
          confirmLabel="Step down"
          onConfirm={vi.fn()}
        />,
      );
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('asks the caller to close it on Escape, and lets it place focus', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const onCloseAutoFocus = vi.fn();
      const { rerender } = renderOpen(onOpenChange, onCloseAutoFocus);

      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);

      rerender(
        <ConfirmDialog
          open={false}
          onOpenChange={onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
          title="Step down to Manager?"
          description="You can't raise your own role again."
          confirmLabel="Step down"
          onConfirm={vi.fn()}
        />,
      );
      // Radix moves focus just after the dialog is gone.
      await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
    });
  });
});
