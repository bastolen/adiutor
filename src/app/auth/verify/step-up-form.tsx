/**
 * @file The form of the step-up page: confirms a session that was signed in
 * without a second step, or confirmed too long ago for what the user came to
 * do (changing how they sign in, giving someone a role, resetting someone's
 * two-step verification, signing in as a user), with a code, a passkey or a
 * provider that can prove MFA. Says why a provider didn't confirm it, when
 * that's how the user got back here (`ProviderStepUpNotice`), and why a
 * provider isn't offered for what they came to do (`providersHeldBack`).
 */
'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import CodeField from '@/components/auth/code-field';
import ProviderStepUpNotice, {
  clearProviderStepUpNotice,
} from '@/components/auth/provider-step-up-notice';
import ResendCodeButton from '@/components/auth/resend-code-button';
import signOutAndLeave from '@/components/auth/sign-out';
import PROVIDER_ICONS from '@/components/brand/provider-icons';
import Alert from '@/components/ui/alert';
import AuthDivider from '@/components/ui/auth-divider';
import AuthHeading from '@/components/ui/auth-heading';
import Button, { whileRunning } from '@/components/ui/button';
import { useOncePerVisit, useTransientState } from '@/components/ui/use-transient-state';
import type { StepUpMethods } from '@/lib/authz/mfa';
import authClient from '@/lib/sign-in/auth-client';
import { authErrorText } from '@/lib/sign-in/auth-error-messages';
import {
  type MfaProvider,
  PROVIDER_LABELS,
  providerList,
  REVERIFY_HINT,
} from '@/lib/sign-in/oauth-providers';
import type { TwoFactorMethod } from '@/lib/sign-in/two-factor-path';
import verifyCode, { type CodeKind } from '@/lib/sign-in/verify-code';

import useEmailCode from '../use-email-code';

/** A way of confirming that a button starts: a passkey, the code form, or a provider. */
type StepUpAction = 'passkey' | 'code' | MfaProvider;

/**
 * Why the session needs confirming, as the `reason` of `auth.stepUp.reason`.
 * The two reasons for a session that counts already (`confirmedBefore`, and
 * `secondStep` for an account whose second step isn't MFA) don't name what
 * the user came to do: the page can't tell a change to how they sign in from
 * giving someone a role, resetting someone's two-step verification or signing
 * in as a user.
 *
 * @param roleRequiresMfa - Whether the role requires MFA.
 * @param accountHasMfa - Whether the account has MFA.
 * @param confirmedBefore - Whether this session was confirmed already, but
 *   too long ago for what the user came to do.
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
   * Security page sends them here before changing how they sign in, and other
   * pages before giving someone a role, resetting someone's two-step
   * verification or signing in as a user.
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
  /** The way of confirming that's running: its button is busy, the others wait (`whileRunning`). */
  const [running, setRunning] = useState<StepUpAction | null>(null);
  const [error, setError] = useTransientState(initialError);
  // A code sent a moment ago still works: the code field shows, with the notice to use that one.
  const emailCode = useEmailCode({
    /** Clears the last error as a code is asked for. */
    onStart: () => {
      setError(null);
    },
    /**
     * Says why no code was sent.
     *
     * @param failure - Better Auth's error.
     */
    onFailure: (failure) => {
      setError(authErrorText(t, failure));
    },
    /** Shows the code field. */
    onSent: () => {
      setCodeSent(true);
    },
  });

  /**
   * Continues to the page the user came for. The form starts over, since the
   * page stays alive (React's <Activity>) and the Security page sends users
   * back here each time their 15 minutes have run out. A notice that
   * "Confirm with GitHub" didn't count is answered now, so it doesn't follow
   * them there.
   */
  const finish = () => {
    clearProviderStepUpNotice();
    setRunning(null);
    setCode('');
    setCodeSent(false);
    setMode(codeMethod);
    // A used code ends the guards' wait for a new one too.
    emailCode.cooldown.reset();
    router.replace(callbackURL);
    router.refresh();
  };

  // With email codes as the only option, send one straight away: once per visit (also in Strict
  // Mode), so again when the page is shown again, whether or not the last visit confirmed. The
  // last code may have run out, or belong to a session since replaced; when the server says it
  // still works, the notice says to use that one.
  useOncePerVisit(() => {
    if (emailOnly) {
      // It shows its own errors.
      void emailCode.send();
    }
  });

  /**
   * Switches between the code and backup codes. Only an authenticator app
   * offers that, so there's no emailed code's notice to clear.
   *
   * @param next - The mode to switch to.
   */
  const choose = (next: CodeKind) => {
    setMode(next);
    setCode('');
    setError(null);
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
    setRunning('code');
    setError(null);
    const result = await verifyCode(mode, { code });
    if (result.error) {
      setError(authErrorText(t, result.error));
      setRunning(null);
      return;
    }
    finish();
  };

  /** Confirms with a passkey, letting the browser ask which one. */
  const confirmWithPasskey = async () => {
    setRunning('passkey');
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(authErrorText(t, result.error));
      setRunning(null);
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
    setRunning(provider);
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
      setRunning(null);
    }
  };

  /**
   * Ends the session and loads the sign-in page afresh in every tab
   * (`signOutAndLeave`). When the session didn't end, the form says so and
   * nothing loads, since the sign-in page would only send the user back here.
   */
  const signOut = async () => {
    setError(null);
    if (!(await signOutAndLeave())) {
      setError(t('stepUp.signOutFailed'));
    }
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
            <Button
              variant="secondary"
              fullWidth
              {...whileRunning(running, 'passkey')}
              onClick={confirmWithPasskey}
            >
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
                {...whileRunning(running, provider)}
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
          {mode === 'otp' && <Alert tone="info">{emailCode.notice}</Alert>}
          {showCodeForm ? (
            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
              <CodeField
                key={mode}
                kind={mode}
                autoFocus={codeSent || mode !== 'otp'}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" fullWidth {...whileRunning(running, 'code')}>
                {t('stepUp.submit')}
              </Button>
            </form>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              disabled={running !== null}
              loading={emailCode.sending}
              onClick={() => emailCode.send()}
            >
              {t('stepUp.emailMe')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 text-sm">
        {mode === 'otp' && codeSent && (
          <ResendCodeButton
            onClick={() => emailCode.send(true)}
            sending={emailCode.sending}
            waitSeconds={emailCode.cooldown.waitSeconds}
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
