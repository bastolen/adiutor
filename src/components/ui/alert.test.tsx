/**
 * @file Tests for the alert: its role per tone, focus on show, the optional
 * dismiss button (after which focus moves to the main content), and
 * `alsoToast`, which raises no toast inside a dialog.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import nextFrames from '../../../tests/ui/next-frames';
import Alert from './alert';
import { InsideDialog } from './inside-dialog';
import { Toaster } from './toast';

describe('Alert', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<Alert tone="info">{null}</Alert>);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces errors as alerts and other messages as status', () => {
    const { rerender } = render(<Alert tone="error">Name is required.</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.');

    rerender(<Alert tone="success">Saved.</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');

    rerender(<Alert tone="info">Adiutor Tests is deactivated.</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Adiutor Tests is deactivated.');
  });

  it('takes focus when it appears, if asked to', () => {
    render(
      <Alert tone="error" focusOnShow>
        Name is required.
      </Alert>,
    );

    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('has no dismiss button by default', () => {
    render(<Alert tone="info">Adiutor Tests is deactivated.</Alert>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has a dismiss button, named "Dismiss" by default, that calls onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Alert tone="info" onDismiss={onDismiss}>
        Your GitHub account is now connected.
      </Alert>,
    );

    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(screen.getByRole('status')).toContainElement(dismiss);
    expect(dismiss.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('names the dismiss button as asked, and tints it in the message colour', () => {
    render(
      <Alert tone="success" onDismiss={vi.fn()} dismissLabel="Dismiss the GitHub notice">
        Saved.
      </Alert>,
    );

    const dismiss = screen.getByRole('button', { name: 'Dismiss the GitHub notice' });
    expect(dismiss).toHaveClass('text-current');
    expect(dismiss).not.toHaveClass('text-foreground');
  });

  it('moves focus to the main content when its dismissed message goes away', async () => {
    const user = userEvent.setup();
    /**
     * A dismissible notice in the main content.
     *
     * @returns The page.
     */
    function Page() {
      const [shown, setShown] = useState(true);
      return (
        <main id="main" tabIndex={-1}>
          <Alert tone="info" onDismiss={() => setShown(false)}>
            {shown ? 'GitHub is now connected.' : null}
          </Alert>
        </main>
      );
    }
    render(<Page />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await nextFrames();

    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('also toasts its message with alsoToast, once per message', async () => {
    const { rerender } = render(
      <>
        <Toaster />
        <Alert tone="error" alsoToast>
          That code didn’t work.
        </Alert>
      </>,
    );
    const toasts = screen.getByRole('region', { name: /^Notifications/ });
    await waitFor(() => expect(toasts).toHaveTextContent('That code didn’t work.'));

    rerender(
      <>
        <Toaster />
        <Alert tone="error" alsoToast>
          That code didn’t work.
        </Alert>
      </>,
    );
    expect(toasts.querySelectorAll('li')).toHaveLength(1);
  });

  it('raises no toast with alsoToast inside a dialog, where the message stays inline', async () => {
    render(
      <>
        <Toaster />
        <InsideDialog>
          <Alert tone="error" focusOnShow alsoToast>
            That code didn’t work.
          </Alert>
        </InsideDialog>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveFocus();
    // Let the effects and what they queue run: a toast would be raised by now.
    await act(async () => {});
    const toasts = screen.getByRole('region', { name: /^Notifications/ });
    expect(toasts).not.toHaveTextContent('That code didn’t work.');
    expect(toasts.querySelectorAll('li')).toHaveLength(0);
  });
});
