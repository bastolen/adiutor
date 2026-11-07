/**
 * @file The code form of the second sign-in step.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useRef } from 'react';

import CodeField from '@/components/auth/code-field';
import ResendCodeButton from '@/components/auth/resend-code-button';
import useResendCooldown from '@/components/auth/use-resend-cooldown';
import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import CheckboxField from '@/components/ui/checkbox-field';
import TextLink from '@/components/ui/text-link';
import { useTransientState } from '@/components/ui/use-transient-state';
import { EMAIL_CODE_MINUTES } from '@/lib/authz/mfa';
import { getSafeRedirectPath } from '@/lib/redirect';
import authClient from '@/lib/sign-in/auth-client';
import { codeStepErrorMessage } from '@/lib/sign-in/auth-error-messages';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';
import verifyCode, { type CodeKind } from '@/lib/sign-in/verify-code';

import { parseTwoFactorMethod } from './two-factor-path';

/**
 * Asks for the second step: a code from the authenticator app (or a backup
 * code instead), or, without an app, an emailed code, which is sent straight
 * away. With "Trust this device", the step is skipped on this browser for 30
 * days, until the user signs out there (sign-out clears it, see
 * `cookiesToClearAtSignOut`).
 *
 * The form starts over whenever the page is hidden, and after a code is
 * accepted: Next keeps the page alive (React's `<Activity>`) and shows it
 * again at the next sign-in, and the next person mustn't find the last code,
 * a busy button, or "Trust this device" still ticked, which would trust the
 * browser for someone else. The first emailed code is sent again then. A page
 * the browser restores from its back/forward cache is made usable again too.
 *
 * @returns The form.
 */
export default function TwoFactorForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = getSafeRedirectPath(searchParams.get('callbackURL'));
  const method = parseTwoFactorMethod(searchParams.get('methods'));

  const [mode, setMode] = useTransientState<CodeKind>(method);
  const [code, setCode] = useTransientState('');
  const [trustDevice, setTrustDevice] = useTransientState(false);
  const [pending, setPending] = useTransientState(false);
  const [error, setError] = useTransientState<string | null>(null);
  const [expired, setExpired] = useTransientState(false);
  const [notice, setNotice] = useTransientState<string | null>(null);
  const [sending, setSending] = useTransientState(false);
  const cooldown = useResendCooldown();
  const sentInitialCode = useRef(false);

  /**
   * Shows the message for a failed request.
   *
   * @param failure - Better Auth's error.
   * @param failure.status - HTTP status.
   * @param failure.code - Error code, if any.
   */
  const showError = (failure: { status: number; code?: string }) => {
    setError(codeStepErrorMessage(failure));
    setExpired(failure.code === 'INVALID_TWO_FACTOR_COOKIE');
  };

  /**
   * Emails a code, then counts down until a new one may be asked for. A code
   * sent a moment ago (e.g. before a reload) still works, so that refusal is
   * shown as the notice, not as an error.
   *
   * @param again - Whether it's a new code after an earlier one.
   */
  const sendCode = async (again = false) => {
    setError(null);
    setNotice(null);
    setSending(true);
    const result = await authClient.twoFactor.sendOtp();
    setSending(false);
    if (result.error?.code === EMAIL_CODE_SENT_RECENTLY.code) {
      setNotice(EMAIL_CODE_SENT_RECENTLY.message);
      cooldown.start();
      return;
    }
    if (result.error) {
      showError(result.error);
      return;
    }
    cooldown.start();
    setNotice(
      `We sent ${again ? 'a new code' : 'a code'} to your email address. It expires in ${EMAIL_CODE_MINUTES} minutes.`,
    );
  };

  useEffect(() => {
    // Send the emailed code straight away (once, also in Strict Mode).
    if (method === 'otp' && !sentInitialCode.current) {
      sentInitialCode.current = true;
      // It shows its own errors.
      void sendCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once on mount.
  }, []);

  useEffect(() => {
    /**
     * Makes the form usable again when the browser shows the page from its
     * back/forward cache.
     *
     * @param event - The page being shown.
     */
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setPending(false);
      }
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, [setPending]);

  /**
   * Continues to the page the user came for. The form starts over, since the
   * page stays alive and comes back at the next sign-in on this browser,
   * which then sends its first emailed code again.
   */
  const finish = () => {
    setPending(false);
    setCode('');
    setTrustDevice(false);
    setMode(method);
    setExpired(false);
    // The code was used, which ends the guards' wait for a new one too.
    cooldown.reset();
    sentInitialCode.current = false;
    router.replace(callbackURL);
    router.refresh();
  };

  /**
   * Switches between the authenticator code and backup codes.
   *
   * @param next - The mode to switch to.
   */
  const choose = (next: CodeKind) => {
    setMode(next);
    setCode('');
    setError(null);
    setNotice(null);
  };

  /**
   * Checks the code and finishes signing in.
   *
   * @param event - The form submit event.
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await verifyCode(mode, { code, trustDevice });
    if (result.error) {
      showError(result.error);
      setPending(false);
      return;
    }
    finish();
  };

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title="Confirm it's you"
        description={
          mode === 'backup'
            ? 'Enter one of the backup codes you saved when you set up your authenticator app. Each works once.'
            : 'Your account has two-step verification. Enter the code to finish signing in.'
        }
      />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>
      {expired && (
        <Button asChild variant="secondary">
          <TextLink href={`/auth?callbackURL=${encodeURIComponent(callbackURL)}`}>
            Start again
          </TextLink>
        </Button>
      )}

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        {mode === 'otp' && <Alert tone="info">{notice}</Alert>}
        <CodeField
          key={mode}
          kind={mode}
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <CheckboxField
          label="Trust this device for 30 days"
          description="Skip this step when you sign in again on this browser, until you sign out. Don't use this on a shared computer."
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.target.checked)}
        />
        <Button type="submit" fullWidth loading={pending}>
          Verify and sign in
        </Button>
      </form>

      <div className="flex flex-col items-center gap-3 text-sm">
        {mode === 'otp' && (
          <ResendCodeButton
            onClick={() => sendCode(true)}
            sending={sending}
            waitSeconds={cooldown.waitSeconds}
          />
        )}
        {method === 'totp' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => choose(mode === 'backup' ? 'totp' : 'backup')}
          >
            {mode === 'backup' ? 'Use a code instead' : 'Use a backup code'}
          </Button>
        )}
        <TextLink href="/auth">Back to sign in</TextLink>
      </div>
    </div>
  );
}
