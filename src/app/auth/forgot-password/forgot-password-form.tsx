/**
 * @file Form to request a password reset link by email.
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';

import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import TextField from '@/components/ui/text-field';
import { useTransientState } from '@/components/ui/use-transient-state';
import authClient from '@/lib/sign-in/auth-client';

/**
 * Asks for an email address and sends a reset link to it. The confirmation
 * is the same whether or not the account exists, so the form can't be used to
 * find out who has an account.
 *
 * @returns The form.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
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
      setError(result.error.message ?? 'Sending the link failed. Please try again.');
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        title="Forgot your password?"
        description="Enter your email address and we'll send you a link to choose a new one."
      />

      <Alert tone="error" focusOnShow>
        {error}
      </Alert>
      <Alert tone="success">
        {sent ? `If ${email} has an account, a reset link is on its way. Check your inbox.` : null}
      </Alert>

      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@adiutor.dev"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" fullWidth loading={pending}>
          Send reset link
        </Button>
      </form>

      <Button variant="ghost" fullWidth asChild>
        <Link href="/auth">
          <ArrowLeft aria-hidden="true" />
          Back to sign in
        </Link>
      </Button>
    </div>
  );
}
