/**
 * @file Form to request a password reset link by email.
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { FormEvent } from 'react';

import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import TextField from '@/components/ui/text-field';
import { useTransientState } from '@/components/ui/use-transient-state';
import authClient from '@/lib/sign-in/auth-client';
import { authErrorText } from '@/lib/sign-in/auth-error-messages';

/**
 * Asks for an email address and sends a reset link to it. The confirmation
 * is the same whether or not the account exists, so the form can't be used to
 * find out who has an account. A refusal is worded from its code
 * (`authErrorText`), or as the server words it when it says how long to wait.
 *
 * Like the sign-in form, it starts over whenever the page is hidden: Next
 * keeps the page alive (React's `<Activity>`), and the next person on the
 * browser mustn't find the last address typed here, its confirmation, or a
 * button still busy.
 *
 * @returns The form.
 */
export default function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [email, setEmail] = useTransientState('');
  const [pending, setPending] = useTransientState(false);
  const [error, setError] = useTransientState<string | null>(null);
  const [sent, setSent] = useTransientState(false);

  /**
   * Requests the reset link.
   *
   * @param event - The form submit event.
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: '/auth/reset-password',
    });
    setPending(false);
    if (result.error) {
      setError(authErrorText(t, result.error, t('forgotPassword.failed')));
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title={t('forgotPassword.heading')}
        description={t('forgotPassword.description')}
      />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>
      <Alert tone="success">{sent ? t('forgotPassword.sent', { email }) : null}</Alert>

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <TextField
          label={t('fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          placeholder={t('fields.emailPlaceholder')}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" fullWidth loading={pending}>
          {t('forgotPassword.submit')}
        </Button>
      </form>

      <Button variant="ghost" fullWidth asChild>
        <Link href="/auth">
          <ArrowLeft aria-hidden="true" />
          {t('actions.backToSignIn')}
        </Link>
      </Button>
    </div>
  );
}
