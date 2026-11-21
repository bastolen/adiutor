/**
 * @file Tests for the modal dialog: its name and description, its sizes,
 * where the focus goes when it opens and closes, and that an error it shows
 * stays inline, without a toast above the dialog, so one Escape closes it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

/**
 * A page whose dialog is opened to go on with the text in it, and gives the
 * focus to another button on the page than the one that opened it when it
 * closes.
 *
 * @returns The page.
 */
function WritingPage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open large
      </button>
      <button type="button" id="after">
        Where it goes on
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Your reply"
        size="large"
        initialFocus={() => document.getElementById('text')?.focus()}
        finalFocus={() => document.getElementById('after')?.focus()}
      >
        <button type="button">First control</button>
        <textarea id="text" aria-label="Text" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is a dialog named by its title and described by its explanation', () => {
    render(<Page error={null} />);

    const dialog = screen.getByRole('dialog', { name: 'Turn off two-step verification?' });
    expect(dialog).toHaveAccessibleDescription('You sign in with your password only.');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('is as wide as a short form by default, and fills most of the window when it’s large', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Page error={null} />);
    expect(screen.getByRole('dialog')).toHaveClass('max-w-md', 'overflow-y-auto');
    unmount();

    render(<WritingPage />);
    await user.click(screen.getByRole('button', { name: 'Open large' }));

    // The whole screen where it's narrow; from there on most of the window.
    const dialog = screen.getByRole('dialog', { name: 'Your reply' });
    expect(dialog).toHaveClass('h-dvh', 'w-full', 'sm:max-w-[60rem]');
    expect(dialog).not.toHaveClass('max-w-md');
  });

  it('gives the focus to what it’s told to, when it opens and when it closes', async () => {
    const user = userEvent.setup();
    render(<WritingPage />);

    await user.click(screen.getByRole('button', { name: 'Open large' }));
    // Not its first control, and not the close button.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Text' })).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Not the button that opened it.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Where it goes on' })).toHaveFocus(),
    );
  });

  it('gives the focus back to what opened it when what it was told has nothing to focus', async () => {
    const user = userEvent.setup();
    const finalFocus = vi.fn(() => false);
    /**
     * A page with a button that opens a dialog, which has nothing of its own to focus on closing.
     *
     * @returns The page.
     */
    function NothingToFocusPage() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Add a link
          </button>
          <Modal open={open} onOpenChange={setOpen} title="Link" finalFocus={finalFocus}>
            <button type="button">Save</button>
          </Modal>
        </>
      );
    }
    render(<NothingToFocusPage />);

    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a link' })).toHaveFocus());
    expect(finalFocus).toHaveBeenCalledOnce();
  });

  it('gives the focus back to what opened it when it’s told nothing else', async () => {
    const user = userEvent.setup();
    /**
     * A page with a button that opens a dialog.
     *
     * @returns The page.
     */
    function OpenerPage() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Edit details
          </button>
          <Modal open={open} onOpenChange={setOpen} title="Edit details">
            <button type="button">Save</button>
          </Modal>
        </>
      );
    }
    render(<OpenerPage />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit details' })).toHaveFocus());
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
