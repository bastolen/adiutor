/**
 * @file Tests for the "Send a new code" button and its countdown: disabled and
 * counting down while the last code is too recent, ready once the wait is
 * over, and busy while a code is being sent.
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
 * @returns The harness.
 */
function Harness({ sending = false }: { sending?: boolean }) {
  const cooldown = useResendCooldown();
  return (
    <>
      <button type="button" onClick={cooldown.start}>
        Sent
      </button>
      <ResendCodeButton onClick={() => {}} sending={sending} waitSeconds={cooldown.waitSeconds} />
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

  it('counts down after a code was sent, and is ready once the wait is over', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Sent' }));
    expect(screen.getByRole('button', { name: 'Send a new code in 2:30' })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole('button', { name: 'Send a new code in 2:00' })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime((EMAIL_CODE_RESEND_SECONDS - 30) * 1000);
    });
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
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
