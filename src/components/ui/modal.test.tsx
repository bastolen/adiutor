/**
 * @file Tests for the modal dialog: its name and description, and that an
 * error it shows stays inline, without a toast above the dialog, so one
 * Escape closes it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import Alert from './alert';
import Modal from './modal';
import { Toaster } from './toast';

/**
 * A page with toasts and a dialog that's open, showing an error the way the
 * Security page's dialogs do (`Alert` with `alsoToast`).
 *
 * @param props - Harness props.
 * @param props.error - The error the dialog shows, or `null`.
 * @returns The page.
 */
function Page({ error }: { error: string | null }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Toaster />
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Turn off two-step verification?"
        description="You sign in with your password only."
      >
        <Alert tone="error" focusOnShow alsoToast>
          {error}
        </Alert>
        <button type="button">Turn off</button>
      </Modal>
    </>
  );
}

/**
 * How many toasts are on screen. The notifications region is hidden from
 * assistive technology while a dialog is open, so it's found by its element.
 *
 * @returns The number of toasts.
 */
function toastCount(): number {
  return document.querySelectorAll('[role="region"] li').length;
}

describe('Modal', () => {
  it('is a dialog named by its title and described by its explanation', () => {
    render(<Page error={null} />);

    const dialog = screen.getByRole('dialog', { name: 'Turn off two-step verification?' });
    expect(dialog).toHaveAccessibleDescription('You sign in with your password only.');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows an error inline only, so one Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page error={null} />);

    rerender(<Page error="That password is incorrect." />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('That password is incorrect.');
    expect(alert).toHaveFocus();
    // Give a toast the moment it would take to show: it would be the newest layer.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(toastCount()).toBe(0);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves the same error outside a dialog its toast', async () => {
    render(
      <>
        <Toaster />
        <Alert tone="error" focusOnShow alsoToast>
          That password is incorrect.
        </Alert>
      </>,
    );

    await waitFor(() => expect(toastCount()).toBe(1));
  });
});
