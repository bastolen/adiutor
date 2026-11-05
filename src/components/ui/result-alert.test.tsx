/**
 * @file Tests for the action result alert: inline without toasts; in the
 * signed-in app a success is a toast and an error is inline and a toast.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
