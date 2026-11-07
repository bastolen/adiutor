/**
 * @file The ways to use an invite link: join as the signed-in user, or enter
 * an email address when signed out.
 */
'use client';

import { MailCheck } from 'lucide-react';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';

import { claimAction, joinAction } from './actions';

/**
 * Props for {@link JoinForm}.
 */
interface JoinFormProps {
  /** The token from the link. */
  token: string;
  /** Email of the signed-in user, or `null` when signed out. */
  signedInEmail: string | null;
}

/**
 * A join button when signed in; otherwise an email field. After entering an
 * email, the person gets an invitation there, which proves they own it.
 *
 * @param props - Form props.
 * @param props.token - The token from the link.
 * @param props.signedInEmail - The signed-in user's email, or `null`.
 * @returns The form.
 */
export default function JoinForm({ token, signedInEmail }: JoinFormProps) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    signedInEmail ? joinAction : claimAction,
    null,
  );

  if (result?.ok) {
    return (
      <div className="flex flex-col items-start gap-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-success-soft text-success">
          <MailCheck aria-hidden="true" className="size-5" />
        </span>
        <Alert tone="success">{result.message ?? null}</Alert>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <ResultAlert result={result} errorsOnly />
      {signedInEmail ? (
        <p className="text-sm text-muted-foreground">
          You&apos;ll join as <span className="font-medium text-foreground">{signedInEmail}</span>.
        </p>
      ) : (
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@adiutor.dev"
          description="We'll email you a link to finish joining. This invite link works only once."
          required
        />
      )}
      <Button type="submit" fullWidth loading={pending}>
        {signedInEmail ? 'Join' : 'Continue'}
      </Button>
    </form>
  );
}
