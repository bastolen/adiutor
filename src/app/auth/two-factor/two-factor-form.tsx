/**
 * @file The code form of the second sign-in step.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { FormEvent } from 'react';

import CodeField from '@/components/auth/code-field';
import ResendCodeButton from '@/components/auth/resend-code-button';
import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import CheckboxField from '@/components/ui/checkbox-field';
import loadFresh from '@/components/ui/load-fresh';
import TextLink from '@/components/ui/text-link';
import { usePageRestored } from '@/components/ui/use-page-restored';
import { useOncePerVisit, useTransientState } from '@/components/ui/use-transient-state';
import { getSafeRedirectPath, signInPath } from '@/lib/redirect';
import { type AuthClientError, authErrorText } from '@/lib/sign-in/auth-error-messages';
import { parseTwoFactorMethod } from '@/lib/sign-in/two-factor-path';
import verifyCode, { type CodeKind } from '@/lib/sign-in/verify-code';

import useEmailCode from '../use-email-code';

/**
 * Asks for the second step: a code from the authenticator app (or a backup
 * code instead), or, without an app, an emailed code, which is sent straight
 * away. With "Trust this device", the step is skipped on this browser until
 * 30 days after the last password sign-in there (Better Auth renews the
 * trusted device each time it skips the step, which the label says), or until
 * the user signs out there (sign-out clears it, see `cookiesToClearAtSignOut`).
 *
 * The form starts over whenever the page is hidden: Next keeps the page alive
 * (React's `<Activity>`), e.g. after going back to the sign-in page, and
 * whoever comes back to it mustn't find the last code, a busy button, or
 * "Trust this device" still ticked, which would trust the browser for someone
 * else. Coming back is usually a new sign-in: going back to the sign-in page
 * and signing in again shows this same page again, for a code step whose
 * code the first email doesn't hold (Better Auth keeps an emailed code with
 * the sign-in it was asked for). So the emailed code is sent once each time
 * the page is shown (`useOncePerVisit`), not once in the page's life; when the
 * server says the last code still works, the form says to use that one.
 * Once a code is accepted, the page the user came for loads afresh
 * (`loadFresh`), which keeps no page alive. A page the browser restores from
 * its back/forward cache is made usable again too.
 *
 * @returns The form.
 */
export default function TwoFactorForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const callbackURL = getSafeRedirectPath(searchParams.get('callbackURL'));
  const method = parseTwoFactorMethod(searchParams.get('methods'));

  const [mode, setMode] = useTransientState<CodeKind>(method);
  const [code, setCode] = useTransientState('');
  const [trustDevice, setTrustDevice] = useTransientState(false);
  const [pending, setPending] = useTransientState(false);
  const [error, setError] = useTransientState<string | null>(null);
  const [expired, setExpired] = useTransientState(false);

  /**
   * Shows the message for a failed request.
   *
   * @param failure - Better Auth's error.
   */
  const showError = (failure: AuthClientError) => {
    setError(authErrorText(t, failure));
    setExpired(failure.code === 'INVALID_TWO_FACTOR_COOKIE');
  };

  // A code sent a moment ago (e.g. before a reload) still works: the notice says to use that one.
  const emailCode = useEmailCode({
    /** Clears the last error as a code is asked for. */
    onStart: () => {
      setError(null);
    },
    onFailure: showError,
  });

  // Send the emailed code straight away: once per visit (also in Strict Mode), so again when the
  // page is shown again, which is usually for a new sign-in.
  useOncePerVisit(() => {
    if (method === 'otp') {
      // It shows its own errors.
      void emailCode.send();
    }
  });

  // Makes the form usable again when the browser shows the page from its
  // back/forward cache.
  usePageRestored(() => setPending(false));

  /**
   * Switches between the authenticator code and backup codes. Only an
   * authenticator app offers that, so there's no emailed code's notice to clear.
   *
   * @param next - The mode to switch to.
   */
  const choose = (next: CodeKind) => {
    setMode(next);
    setCode('');
    setError(null);
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
    // A full load, the button busy until it goes, leaves no page alive, this one included, for the
    // next person to sign in on this browser. The browser's other tabs load their own page afresh
    // too (`everyTab`), signed in.
    loadFresh(callbackURL, { everyTab: true });
  };

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title={t('twoFactor.heading')}
        description={
          mode === 'backup' ? t('twoFactor.backupDescription') : t('twoFactor.description')
        }
      />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>
      {expired && (
        <Button asChild variant="secondary">
          <TextLink standalone href={signInPath(callbackURL)}>
            {t('actions.startAgain')}
          </TextLink>
        </Button>
      )}

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        {mode === 'otp' && <Alert tone="info">{emailCode.notice}</Alert>}
        <CodeField
          key={mode}
          kind={mode}
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <CheckboxField
          label={t('twoFactor.trustDevice')}
          description={t('twoFactor.trustDeviceHint')}
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.target.checked)}
        />
        <Button type="submit" fullWidth loading={pending}>
          {t('twoFactor.submit')}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-3 text-sm">
        {mode === 'otp' && (
          <ResendCodeButton
            onClick={() => emailCode.send(true)}
            sending={emailCode.sending}
            waitSeconds={emailCode.cooldown.waitSeconds}
          />
        )}
        {method === 'totp' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => choose(mode === 'backup' ? 'totp' : 'backup')}
          >
            {mode === 'backup' ? t('actions.useCode') : t('actions.useBackupCode')}
          </Button>
        )}
        <TextLink standalone href="/auth">
          {t('actions.backToSignIn')}
        </TextLink>
      </div>
    </div>
  );
}
