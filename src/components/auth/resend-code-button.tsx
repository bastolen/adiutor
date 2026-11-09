/**
 * @file The "Send a new code" button of every form that emails a code (the
 * sign-in code step, the step-up page and setting up email codes): busy while
 * a code is being sent, and counting down while the last one is too recent
 * for a new one (`useResendCooldown`). Its text is in `common`
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
 * "Send a new code", or "Send a new code in 2:30" (disabled) while the last
 * code is too recent for a new one.
 *
 * @param props - Button props.
 * @param props.onClick - Sends a new code.
 * @param props.sending - Whether a code is being sent.
 * @param props.waitSeconds - Seconds until a new code may be asked for.
 * @returns The button.
 */
export default function ResendCodeButton({ onClick, sending, waitSeconds }: ResendCodeButtonProps) {
  const t = useTranslations('common');
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={sending}
      disabled={waitSeconds > 0}
      onClick={onClick}
    >
      {waitSeconds > 0
        ? t('resendCode.wait', { wait: formatCountdown(waitSeconds) })
        : t('resendCode.send')}
    </Button>
  );
}
