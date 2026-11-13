/**
 * @file Tests for toasts: shown through `useToast`, in a named region, with
 * an icon per tone and a dismiss button; a success is announced, an error
 * (announced where it's shown inline) isn't announced again. A toast left
 * for the next page shows there once, unless that page comes too late.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { showToastAfterLoad, Toaster, type ToastTone, useToast } from './toast';

/**
 * A button that shows a toast, standing in for an action's result.
 *
 * @param props - Test props.
 * @param props.message - The toast's message.
 * @param props.tone - Its tone.
 * @returns The button.
 */
function ShowButton({ message, tone }: { message: string; tone: ToastTone }) {
  const showToast = useToast();
  return (
    <button type="button" onClick={() => showToast?.(message, { tone })}>
      Show
    </button>
  );
}

/**
 * A button that shows a numbered toast per click.
 *
 * @returns The button.
 */
function Counter() {
  const showToast = useToast();
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setCount(count + 1);
        showToast?.(`Toast ${count + 1}`);
      }}
    >
      More
    </button>
  );
}

/**
 * The text screen readers are told: what Radix puts in its live regions.
 *
 * @returns The announced text.
 */
function announced(): string {
  return Array.from(document.querySelectorAll('[aria-live="assertive"], [aria-live="polite"]'))
    .map((region) => region.textContent ?? '')
    .join(' ');
}

describe('Toasts', () => {
  it('are offered only inside a provider', () => {
    /**
     * Shows whether a toast can be shown here.
     *
     * @returns The answer.
     */
    function Probe() {
      return <p>{useToast() ? 'toasts' : 'no toasts'}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('no toasts')).toBeInTheDocument();
  });

  it('show a success in the notifications region, announced, until dismissed', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <ShowButton message="Name saved." tone="success" />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Show' }));

    const region = screen.getByRole('region', { name: /^Notifications/ });
    expect(region).toHaveTextContent('Name saved.');
    await waitFor(() => expect(announced()).toContain('Name saved.'));

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    await waitFor(() => expect(region).not.toHaveTextContent('Name saved.'));
  });

  it('show an error without announcing it again', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <ShowButton message="That password is incorrect." tone="error" />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Show' }));

    const region = screen.getByRole('region', { name: /^Notifications/ });
    expect(region).toHaveTextContent('That password is incorrect.');
    // Give Radix the frame it waits before announcing; nothing of the error is said.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(announced()).not.toContain('That password is incorrect.');
  });

  it('keep the newest three', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <Counter />
      </>,
    );

    for (let index = 0; index < 4; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- One click after the other.
      await user.click(screen.getByRole('button', { name: 'More' }));
    }

    const region = screen.getByRole('region', { name: /^Notifications/ });
    expect(region).not.toHaveTextContent('Toast 1');
    expect(region).toHaveTextContent('Toast 4');
  });

  describe('left for the next page', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      window.sessionStorage.clear();
    });

    it('show once the next page has loaded, and only once', async () => {
      showToastAfterLoad("You're back in your own account.");

      const { unmount } = render(<Toaster />);

      const region = screen.getByRole('region', { name: /^Notifications/ });
      await waitFor(() => expect(region).toHaveTextContent("You're back in your own account."));
      expect(window.sessionStorage.length).toBe(0);
      unmount();
      render(<Toaster />);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(screen.getByRole('region', { name: /^Notifications/ })).toHaveTextContent('');
    });

    it('are dropped when the next page comes more than 30 seconds later', async () => {
      const past = Date.now() - 31_000;
      vi.spyOn(Date, 'now').mockReturnValueOnce(past);
      showToastAfterLoad("You're back in your own account.");

      render(<Toaster />);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });

      expect(screen.getByRole('region', { name: /^Notifications/ })).toHaveTextContent('');
      expect(window.sessionStorage.length).toBe(0);
    });
  });
});
