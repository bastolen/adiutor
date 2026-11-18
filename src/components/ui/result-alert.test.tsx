/**
 * @file Tests for the action result alert: inline without toasts; in the
 * signed-in app a success is a toast and an error is inline and a toast,
 * except inside a dialog, where it stays inline. Each new result gets an
 * alert of its own, so the same error twice is announced and focused twice.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InsideDialog } from './inside-dialog';
import ResultAlert from './result-alert';
import { Toaster } from './toast';

/**
 * The toasts on screen.
 *
 * @returns The notifications region.
 */
const toasts = () => screen.getByRole('region', { name: /^Notifications/ });

describe('ResultAlert', () => {
  it('renders nothing without a result', () => {
    const { container } = render(<ResultAlert result={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a confirmation for a success, without taking focus', () => {
    render(<ResultAlert result={{ ok: true, message: 'Saved.' }} />);

    const alert = screen.getByRole('status');
    expect(alert).toHaveTextContent('Saved.');
    expect(alert).not.toHaveFocus();
  });

  it('renders nothing for a success without a message', () => {
    const { container } = render(<ResultAlert result={{ ok: true }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows an error and moves focus to it', () => {
    render(<ResultAlert result={{ ok: false, message: 'Name is required.' }} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Name is required.');
    expect(alert).toHaveFocus();
  });

  it('with errorsOnly, hides a success but still shows an error', () => {
    const { container, rerender } = render(
      <ResultAlert result={{ ok: true, message: 'Saved.' }} errorsOnly />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<ResultAlert result={{ ok: false, message: 'Name is required.' }} errorsOnly />);
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.');
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('gives the same error a second time an alert of its own, which takes focus again', () => {
    /**
     * A form's submit button and its action's refusal, a new result each time
     * it's called (as each submit gives one).
     *
     * @returns The form's parts.
     */
    const refused = () => (
      <>
        <button type="button">Deactivate my account</button>
        <ResultAlert result={{ ok: false, message: 'That password is incorrect.' }} />
      </>
    );
    const { rerender } = render(refused());
    const first = screen.getByRole('alert');
    expect(first).toHaveFocus();

    // The user goes back to the button and submits again: the same refusal, as a new result.
    screen.getByRole('button').focus();
    rerender(refused());

    const second = screen.getByRole('alert');
    // A new node, which screen readers announce; the old one is gone.
    expect(second).not.toBe(first);
    expect(first).not.toBeInTheDocument();
    expect(second).toHaveTextContent('That password is incorrect.');
    expect(second).toHaveFocus();
  });

  it('keeps its alert, and leaves focus alone, while the result stays the same', () => {
    const result = { ok: false as const, message: 'That password is incorrect.' };
    const { rerender } = render(
      <>
        <button type="button">Deactivate my account</button>
        <ResultAlert result={result} />
      </>,
    );
    const alert = screen.getByRole('alert');

    screen.getByRole('button').focus();
    rerender(
      <>
        <button type="button">Deactivate my account</button>
        <ResultAlert result={result} />
      </>,
    );

    expect(screen.getByRole('alert')).toBe(alert);
    expect(screen.getByRole('button')).toHaveFocus();
  });

  describe('with toasts', () => {
    it('toasts a success instead of showing it', async () => {
      render(
        <>
          <Toaster />
          <ResultAlert result={{ ok: true, message: 'Name saved.' }} />
        </>,
      );

      await waitFor(() => expect(toasts()).toHaveTextContent('Name saved.'));
      expect(screen.queryByRole('status', { name: 'Name saved.' })).not.toBeInTheDocument();
      expect(document.querySelectorAll('[role="status"]:not(li)').length).toBeLessThanOrEqual(1);
    });

    it('shows an error inline, taking focus, and as a toast', async () => {
      render(
        <>
          <Toaster />
          <ResultAlert result={{ ok: false, message: 'Name is required.' }} />
        </>,
      );

      expect(screen.getByRole('alert')).toHaveFocus();
      await waitFor(() => expect(toasts()).toHaveTextContent('Name is required.'));
    });

    it('toasts the same error again when it comes a second time', async () => {
      const { rerender } = render(
        <>
          <Toaster />
          <ResultAlert result={{ ok: false, message: 'Name is required.' }} />
        </>,
      );
      await waitFor(() => expect(toasts().querySelectorAll('li')).toHaveLength(1));

      rerender(
        <>
          <Toaster />
          <ResultAlert result={{ ok: false, message: 'Name is required.' }} />
        </>,
      );

      await waitFor(() => expect(toasts().querySelectorAll('li')).toHaveLength(2));
    });

    it('keeps an error inside a dialog inline, without a toast, and still toasts a success', async () => {
      const { rerender } = render(
        <>
          <Toaster />
          <InsideDialog>
            <ResultAlert result={{ ok: false, message: 'That password is incorrect.' }} />
          </InsideDialog>
        </>,
      );

      expect(screen.getByRole('alert')).toHaveFocus();
      // Give the toast the moment it would take to show; a toast would take the first Escape.
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(toasts()).not.toHaveTextContent('That password is incorrect.');
      expect(toasts().querySelectorAll('li')).toHaveLength(0);

      // A success isn't shown inline with toasts, so it's a toast in a dialog too.
      rerender(
        <>
          <Toaster />
          <InsideDialog>
            <ResultAlert result={{ ok: true, message: 'Name saved.' }} />
          </InsideDialog>
        </>,
      );
      await waitFor(() => expect(toasts()).toHaveTextContent('Name saved.'));
    });

    it('toasts each result once, and not a success errorsOnly leaves out', async () => {
      const result = { ok: false as const, message: 'Name is required.' };
      const { rerender } = render(
        <>
          <Toaster />
          <ResultAlert result={result} />
        </>,
      );
      await waitFor(() => expect(toasts()).toHaveTextContent('Name is required.'));
      rerender(
        <>
          <Toaster />
          <ResultAlert result={result} />
        </>,
      );
      expect(toasts().querySelectorAll('li')).toHaveLength(1);

      rerender(
        <>
          <Toaster />
          <ResultAlert result={{ ok: true, message: 'Company added.' }} errorsOnly />
        </>,
      );
      expect(toasts()).not.toHaveTextContent('Company added.');
    });
  });
});
