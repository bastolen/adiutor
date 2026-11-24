/**
 * @file The "Send a new code" button of every form that emails a code (the
 * sign-in code step, the step-up page and setting up email codes): busy while
 * a code is being sent, and counting down while the last one is too recent
 * for a new one (`useResendCooldown`). Counting down, it ignores presses but
 * keeps keyboard focus (`focusableWhenDisabled`): it's usually the button
 * that was just pressed. Its text is in `common`
 * (`common.resendCode`), since the Security page uses it too.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';

/** Props for {@link ResendCodeButton}. */
interface ResendCodeButtonProps {
  /** Sends a new code. */
  onClick: () => void;
  /** Whether a code is being sent. */
  sending: boolean;
  /** Seconds until a new code may be asked for (`useResendCooldown`). */
  waitSeconds: number;
}

/**
 * Formats a wait as minutes and seconds, e.g. 150 → "2:30".
 *
 * @param seconds - The wait.
 * @returns The wait, as m:ss.
 */
export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * "Send a new code", or "Send a new code in 2:30" while the last code is too
 * recent for a new one: then it can't be pressed, yet stays focusable, so
 * pressing it doesn't drop keyboard focus to the top of the page once the
 * new code is sent.
 */
export default function ResendCodeButton({ onClick, sending, waitSeconds }: ResendCodeButtonProps) {
  const t = useTranslations('common');
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={sending}
      disabled={waitSeconds > 0}
      focusableWhenDisabled
      onClick={onClick}
    >
      {waitSeconds > 0
        ? t('resendCode.wait', { wait: formatCountdown(waitSeconds) })
        : t('resendCode.send')}
    </Button>
  );
}
