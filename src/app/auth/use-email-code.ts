/**
 * @file Emails a code for the second step, for the two forms that take one:
 * the code step of signing in and the step-up page. It sends the code,
 * counts down until a new one may be asked for (`useResendCooldown`) and
 * words the notice that says it was sent. In `src/app/auth/`, as the sign-in
 * pages import the auth client directly.
 */
'use client';

import { useTranslations } from 'next-intl';

import useResendCooldown, { type ResendCooldown } from '@/components/auth/use-resend-cooldown';
import { useTransientState } from '@/components/ui/use-transient-state';
import { EMAIL_CODE_MINUTES } from '@/lib/authz/mfa';
import authClient from '@/lib/sign-in/auth-client';
import { type AuthClientError, authCodeText } from '@/lib/sign-in/auth-error-messages';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';

/** What a form does around a code being emailed. */
export interface EmailCodeHandlers {
  /** Runs as a code is asked for, e.g. to clear the last error. */
  onStart: () => void;
  /** Shows why no code was sent: Better Auth's error. */
  onFailure: (failure: AuthClientError) => void;
  /** Runs once there's a code to use: one was sent, or the last one still works. */
  onSent?: () => void;
}

/** The emailed code, as the form shows it. */
export interface EmailCode {
  /**
   * Emails a code, then counts down until a new one may be asked for.
   *
   * @param again - Whether it's a new code after an earlier one, for the notice's wording.
   */
  send: (again?: boolean) => Promise<void>;
  /** Whether a code is being sent. */
  sending: boolean;
  /** What the form says about the code, e.g. that it was sent; `null` until then. */
  notice: string | null;
  /** The countdown until a new code may be asked for. */
  cooldown: ResendCooldown;
}

/**
 * Emails codes for a form. A code sent a moment ago (e.g. before a reload)
 * still works, so the server's refusal to send another so soon
 * (`EMAIL_CODE_SENT_RECENTLY`) counts as sent: its message is the notice,
 * not an error. The notice and the busy state go when the page is hidden
 * (`useTransientState`), like every status message.
 *
 * @param handlers - What the form does as a code is asked for, fails, or is there to use.
 * @param handlers.onStart - Runs as a code is asked for.
 * @param handlers.onFailure - Shows why no code was sent.
 * @param handlers.onSent - Runs once there's a code to use.
 * @returns The emailed code.
 */
export default function useEmailCode({
  onStart,
  onFailure,
  onSent = undefined,
}: EmailCodeHandlers): EmailCode {
  const t = useTranslations('auth');
  const [sending, setSending] = useTransientState(false);
  const [notice, setNotice] = useTransientState<string | null>(null);
  const cooldown = useResendCooldown();

  /**
   * Emails a code, then counts down until a new one may be asked for.
   *
   * @param again - Whether it's a new code after an earlier one.
   */
  const send = async (again = false) => {
    onStart();
    setNotice(null);
    setSending(true);
    const result = await authClient.twoFactor.sendOtp();
    setSending(false);
    if (result.error?.code === EMAIL_CODE_SENT_RECENTLY.code) {
      onSent?.();
      setNotice(authCodeText(t, EMAIL_CODE_SENT_RECENTLY.code));
      cooldown.start();
      return;
    }
    if (result.error) {
      onFailure(result.error);
      return;
    }
    onSent?.();
    cooldown.start();
    setNotice(
      again
        ? t('emailCode.sentAgain', { minutes: EMAIL_CODE_MINUTES })
        : t('emailCode.sent', { minutes: EMAIL_CODE_MINUTES }),
    );
  };

  return { send, sending, notice, cooldown };
}
