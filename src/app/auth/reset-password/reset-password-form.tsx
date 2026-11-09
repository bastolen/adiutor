/**
 * @file Form to choose a new password, opened from a reset email.
 */
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import TextField from '@/components/ui/text-field';
import { useTransientState } from '@/components/ui/use-transient-state';
import { MIN_PASSWORD_LENGTH } from '@/lib/input-rules';
import authClient from '@/lib/sign-in/auth-client';
import { authErrorText, signInErrorText } from '@/lib/sign-in/auth-error-messages';

/**
 * Sets a new password using the `token` from the reset link. Better Auth
 * sends invalid or expired links here with `?error=INVALID_TOKEN`. With
 * `?welcome=1` (the link in the welcome email of a registered account), the
 * texts talk about choosing a first password. A refused password is worded
 * from its code (`authErrorText`), except a link that would end the
 * account's provider MFA (`RESET_ENDS_PROVIDER_MFA`), whose message the
 * server words with the provider's name and what to do instead.
 *
 * @returns The form.
 */
export default function ResetPasswordForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const welcome = searchParams.get('welcome') === '1';
  const linkError = signInErrorText(t, searchParams.get('error'));

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useTransientState<string | null>(null);
  const [done, setDone] = useState(false);

  /**
   * Saves the new password.
   *
   * @param event - The form submit event.
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError(t('resetPassword.mismatch'));
      return;
    }
    if (!token) {
      return;
    }

    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) {
      setError(authErrorText(t, result.error, t('resetPassword.failed')));
      return;
    }
    setDone(true);
  };

  if (linkError || !token) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('resetPassword.invalidHeading')}
        </h1>
        <Alert tone="error">{linkError ?? t('resetPassword.incomplete')}</Alert>
        <Button variant="secondary" fullWidth asChild>
          <Link href="/auth/forgot-password">{t('resetPassword.requestNew')}</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {welcome ? t('resetPassword.savedHeading') : t('resetPassword.changedHeading')}
        </h1>
        <Alert tone="success">
          {welcome ? t('resetPassword.saved') : t('resetPassword.changed')}
        </Alert>
        <Button fullWidth asChild>
          <Link href="/auth">{t('resetPassword.signIn')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title={welcome ? t('resetPassword.chooseFirst') : t('resetPassword.chooseNew')}
        description={t('resetPassword.rules', { min: MIN_PASSWORD_LENGTH })}
      />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <TextField
          label={welcome ? t('fields.password') : t('resetPassword.newPassword')}
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label={welcome ? t('resetPassword.confirm') : t('resetPassword.confirmNew')}
          type="password"
          name="confirmation"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <Button type="submit" fullWidth loading={pending}>
          {t('resetPassword.submit')}
        </Button>
      </form>
    </div>
  );
}
