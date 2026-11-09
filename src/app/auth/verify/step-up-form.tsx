/**
 * @file The form of the step-up page: confirms a session that was signed in
 * without a second step, or confirmed too long ago to change how the user
 * signs in, with a code, a passkey or a provider that can prove MFA. Says why
 * a provider didn't confirm it, when that's how the user got back here
 * (`ProviderStepUpNotice`), and why a provider isn't offered for a change to
 * how they sign in (`providersHeldBack`).
 */
'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import CodeField from '@/components/auth/code-field';
import ProviderStepUpNotice, {
  clearProviderStepUpNotice,
} from '@/components/auth/provider-step-up-notice';
import ResendCodeButton from '@/components/auth/resend-code-button';
import useResendCooldown from '@/components/auth/use-resend-cooldown';
import PROVIDER_ICONS from '@/components/brand/provider-icons';
import Alert from '@/components/ui/alert';
import AuthDivider from '@/components/ui/auth-divider';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import { useTransientState } from '@/components/ui/use-transient-state';
import type { StepUpMethods } from '@/lib/authz/mfa';
import { EMAIL_CODE_MINUTES } from '@/lib/authz/mfa';
import authClient from '@/lib/sign-in/auth-client';
import { authCodeText, authErrorText } from '@/lib/sign-in/auth-error-messages';
import {
  type MfaProvider,
  PROVIDER_LABELS,
  providerList,
  REVERIFY_HINT,
} from '@/lib/sign-in/oauth-providers';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';
import verifyCode, { type CodeKind } from '@/lib/sign-in/verify-code';

import type { TwoFactorMethod } from '../two-factor/two-factor-path';

/**
 * Why the session needs confirming, as the `reason` of `auth.stepUp.reason`.
 *
 * @param roleRequiresMfa - Whether the role requires MFA.
 * @param accountHasMfa - Whether the account has MFA.
 * @param confirmedBefore - Whether this session was confirmed already, but
 *   too long ago to change how the user signs in.
 * @returns The reason, e.g. `roleRequiresMfa`.
 */
function stepUpReason(
  roleRequiresMfa: boolean,
  accountHasMfa: boolean,
  confirmedBefore: boolean,
): 'confirmedBefore' | 'roleRequiresMfa' | 'accountHasMfa' | 'secondStep' {
  if (confirmedBefore) {
    return 'confirmedBefore';
  }
  if (roleRequiresMfa) {
    return 'roleRequiresMfa';
  }
  if (accountHasMfa) {
    return 'accountHasMfa';
  }
  return 'secondStep';
}

/**
 * Props for {@link StepUpForm}.
 */
export interface StepUpFormProps {
  /**
   * The ways the user can confirm, and for a change to how they sign in the
   * providers left out because they wouldn't allow it (`providersHeldBack`).
   */
  methods: StepUpMethods;
  /** Where to go once confirmed (a safe local path). */
  callbackURL: string;
  /** An error to show first, e.g. after a failed provider sign-in. */
  initialError?: string | null;
  /** Whether the user's role requires MFA (staff Admins and Managers, company Admins), for the wording. */
  roleRequiresMfa?: boolean;
  /**
   * Whether the account has MFA, for the wording; without it (a provider
   * account with 2FA next to a password) they confirm before changing how
   * they sign in.
   */
  accountHasMfa?: boolean;
  /**
   * Whether this session was confirmed already, more than 15 minutes ago: the
   * Security page sends them here before changing how they sign in.
   */
  confirmedBefore?: boolean;
}

/**
 * Asks for a second step for the current session. A passkey and providers are
 * one click; codes go through Better Auth's verify endpoints, limited to a
 * few attempts per quarter hour. Email codes (only offered where allowed) are
 * sent on request, or straight away when they're the only option. Below the
 * heading, a notice says why "Confirm with GitHub" didn't count when it
 * just didn't; confirming removes it. When GitHub was left out because it
 * can't confirm a change next to a passkey or an authenticator app, the
 * heading says so.
 *
 * Errors are worded in the reader's language from their code
 * (`authErrorText`), except the refusals the server words itself (too many
 * attempts, with how long to wait).
 *
 * @param props - Form props.
 * @param props.methods - Available methods.
 * @param props.callbackURL - Where to go afterwards.
 * @param props.initialError - Error to show first.
 * @param props.roleRequiresMfa - Whether the role requires MFA, for the wording.
 * @param props.accountHasMfa - Whether the account has MFA, for the wording.
 * @param props.confirmedBefore - Whether the session was confirmed before, for the wording.
 * @returns The form.
 */
export default function StepUpForm({
  methods,
  callbackURL,
  initialError = null,
  roleRequiresMfa = false,
  accountHasMfa = true,
  confirmedBefore = false,
}: StepUpFormProps) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  // An authenticator app and email codes never count at the same time (see `stepUpMethods`).
  let codeMethod: TwoFactorMethod | null = null;
  if (methods.authenticator) {
    codeMethod = 'totp';
  } else if (methods.email) {
    codeMethod = 'otp';
  }
  const emailOnly = codeMethod === 'otp' && !methods.passkey && methods.providers.length === 0;

  const [mode, setMode] = useState<CodeKind | null>(codeMethod);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const cooldown = useResendCooldown();
  const [error, setError] = useTransientState(initialError);
  const [notice, setNotice] = useTransientState<string | null>(null);
  const sentInitialCode = useRef(false);

  /**
   * Continues to the page the user came for. The form starts over, since the
   * page stays alive (React's <Activity>) and the Security page sends users
   * back here each time their 15 minutes have run out. A notice that
   * "Confirm with GitHub" didn't count is answered now, so it doesn't follow
   * them there.
   */
  const finish = () => {
    clearProviderStepUpNotice();
    setPending(false);
    setCode('');
    setCodeSent(false);
    setMode(codeMethod);
    // A used code ends the guards' wait for a new one too.
    cooldown.reset();
    sentInitialCode.current = false;
    router.replace(callbackURL);
    router.refresh();
  };

  /**
   * Shows the message for a failed request.
   *
   * @param failure - Better Auth's error.
   * @param failure.status - HTTP status.
   * @param failure.code - Error code, if any.
   * @param failure.message - The server's message, shown only for refusals it words itself.
   */
  const showError = (failure: { status: number; code?: string; message?: string }) => {
    setError(authErrorText(t, failure));
  };

  /**
   * Emails a code, then counts down until a new one may be asked for. A code
   * sent a moment ago still works, so that refusal shows the code field with
   * its message as the notice, not as an error.
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
      setCodeSent(true);
      setNotice(authCodeText(t, EMAIL_CODE_SENT_RECENTLY.code));
      cooldown.start();
      return;
    }
    if (result.error) {
      showError(result.error);
      return;
    }
    setCodeSent(true);
    cooldown.start();
    setNotice(
      again
        ? t('emailCode.sentAgain', { minutes: EMAIL_CODE_MINUTES })
        : t('emailCode.sent', { minutes: EMAIL_CODE_MINUTES }),
    );
  };

  useEffect(() => {
    // With email codes as the only option, send one straight away (once per visit, also in Strict
    // Mode; effects run again when the page is shown again).
    if (emailOnly && !sentInitialCode.current) {
      sentInitialCode.current = true;
      // It shows its own errors.
      void sendCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once on mount.
  }, []);

  /**
   * Switches between the code and backup codes.
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
   * Checks the code and continues.
   *
   * @param event - The form submit event.
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The code form only shows with a kind of code to enter.
    if (!mode) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await verifyCode(mode, { code });
    if (result.error) {
      showError(result.error);
      setPending(false);
      return;
    }
    finish();
  };

  /** Confirms with a passkey, letting the browser ask which one. */
  const confirmWithPasskey = async () => {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(authErrorText(t, result.error));
      setPending(false);
      return;
    }
    finish();
  };

  /**
   * Signs in again with a provider that can prove MFA, which redirects there
   * and back. The hint marks it as confirming this session (a re-verify), so
   * the server only lets the user's own confirmed account of that provider
   * answer it; a refusal comes back here with the error and the provider,
   * which the page names in its message.
   *
   * @param provider - The provider.
   */
  const confirmWithProvider = async (provider: MfaProvider) => {
    setPending(true);
    setError(null);
    const errorCallbackURL = `/auth/verify?${new URLSearchParams({ callbackURL, provider })}`;
    const result = await authClient.signIn.social({
      provider,
      callbackURL,
      errorCallbackURL,
      additionalData: { [REVERIFY_HINT]: true },
    });
    if (result.error) {
      setError(
        authErrorText(
          t,
          result.error,
          t('stepUp.providerFailed', { provider: PROVIDER_LABELS[provider] }),
        ),
      );
      setPending(false);
    }
  };

  /** Ends the session and goes back to the sign-in page. */
  const signOut = async () => {
    await authClient.signOut();
    router.replace('/auth');
    router.refresh();
  };

  const showCodeForm = mode === 'totp' || mode === 'backup' || (mode === 'otp' && codeSent);
  // Providers left out because they can't confirm a change next to a passkey or an authenticator
  // app (`windowOpeningMethods`).
  const heldBack = methods.providersHeldBack?.length ? methods.providersHeldBack : null;

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title={t('stepUp.heading')}
        description={
          <>
            {t('stepUp.reason', {
              reason: stepUpReason(roleRequiresMfa, accountHasMfa, confirmedBefore),
            })}{' '}
            {heldBack && (
              <>{t('stepUp.heldBack', { providers: providerList(heldBack, locale) })} </>
            )}
            {t('stepUp.confirmToContinue')}
          </>
        }
      />

      {/* Why "Confirm with GitHub" didn't count, when that's how the user got back here. */}
      <ProviderStepUpNotice />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>

      {(methods.passkey || methods.providers.length > 0) && (
        <div className="flex flex-col gap-3">
          {methods.passkey && (
            <Button variant="secondary" fullWidth disabled={pending} onClick={confirmWithPasskey}>
              <KeyRound aria-hidden="true" />
              {t('stepUp.passkey')}
            </Button>
          )}
          {methods.providers.map((provider) => {
            const Icon = PROVIDER_ICONS[provider];
            return (
              <Button
                key={provider}
                variant="secondary"
                fullWidth
                disabled={pending}
                onClick={() => confirmWithProvider(provider)}
              >
                <Icon />
                {t('stepUp.provider', { provider: PROVIDER_LABELS[provider] })}
              </Button>
            );
          })}
          {mode && <AuthDivider>{t('stepUp.orCode')}</AuthDivider>}
        </div>
      )}

      {mode && (
        <div className="flex flex-col gap-5">
          {mode === 'otp' && <Alert tone="info">{notice}</Alert>}
          {showCodeForm ? (
            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
              <CodeField
                key={mode}
                kind={mode}
                autoFocus={codeSent || mode !== 'otp'}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" fullWidth loading={pending}>
                {t('stepUp.submit')}
              </Button>
            </form>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              disabled={pending}
              loading={sending}
              onClick={() => sendCode()}
            >
              {t('stepUp.emailMe')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 text-sm">
        {mode === 'otp' && codeSent && (
          <ResendCodeButton
            onClick={() => sendCode(true)}
            sending={sending}
            waitSeconds={cooldown.waitSeconds}
          />
        )}
        {methods.authenticator && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => choose(mode === 'backup' ? 'totp' : 'backup')}
          >
            {mode === 'backup' ? t('actions.useCode') : t('actions.useBackupCode')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={signOut}>
          {t('actions.signOut')}
        </Button>
      </div>
    </div>
  );
}
