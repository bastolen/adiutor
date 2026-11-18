/**
 * @file Tests for the "Send a new code" button and its countdown: counting
 * down while the last code is too recent, ignoring presses but keeping focus,
 * ready once the wait is over, and busy while a code is being sent.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMAIL_CODE_RESEND_SECONDS } from '@/lib/authz/mfa';

import ResendCodeButton, { formatCountdown } from './resend-code-button';
import useResendCooldown from './use-resend-cooldown';

/**
 * A form with a code just sent: the button with its countdown, started by
 * "Sent".
 *
 * @param props - Harness props.
 * @param props.sending - Whether a code is being sent.
 * @param props.onResend - Called when the button sends a new code.
 * @returns The harness.
 */
function Harness({
  sending = false,
  onResend = () => {},
}: {
  sending?: boolean;
  onResend?: () => void;
}) {
  const cooldown = useResendCooldown();
  return (
    <>
      <button type="button" onClick={cooldown.start}>
        Sent
      </button>
      <ResendCodeButton onClick={onResend} sending={sending} waitSeconds={cooldown.waitSeconds} />
    </>
  );
}

describe('formatCountdown', () => {
  it.each([
    [150, '2:30'],
    [61, '1:01'],
    [9, '0:09'],
  ])('shows %i seconds as %s', (seconds, shown) => {
    expect(formatCountdown(seconds)).toBe(shown);
  });
});

describe('ResendCodeButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down after a code was sent, keeping focus, and is ready once the wait is over', () => {
    const onResend = vi.fn();
    render(<Harness onResend={onResend} />);
    const button = screen.getByRole('button', { name: 'Send a new code' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled');

    button.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Sent' }));
    button.focus();
    expect(button).toHaveAccessibleName('Send a new code in 2:30');
    // It can't be pressed, but it isn't disabled: a disabled button would drop keyboard focus.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onResend).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(button).toHaveAccessibleName('Send a new code in 2:00');
    expect(button).toHaveFocus();

    act(() => {
      vi.advanceTimersByTime((EMAIL_CODE_RESEND_SECONDS - 30) * 1000);
    });
    expect(button).toHaveAccessibleName('Send a new code');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('is busy while a code is being sent', () => {
    render(<Harness sending />);
    const button = screen.getByRole('button', { name: /Send a new code/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    // Busy rather than disabled, so it keeps keyboard focus while the code is sent.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeEnabled();
  });
});
