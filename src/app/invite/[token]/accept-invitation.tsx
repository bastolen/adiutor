/**
 * @file The ways to accept an invitation: join as the signed-in user, or sign
 * in or create an account when signed out.
 */
'use client';

import Link from 'next/link';

import AuthDivider from '@/components/ui/auth-divider';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH } from '@/lib/input-rules';

import { acceptAction, createAccountAction } from './actions';

/**
 * Props for {@link AcceptInvitation}.
 */
interface AcceptInvitationProps {
  /** The token from the link. */
  token: string;
  /** Email of the signed-in user, or `null` when signed out. */
  signedInEmail: string | null;
}

/**
 * The join button for a signed-in user.
 *
 * @param props - Component props.
 * @param props.token - The token from the link.
 * @param props.email - The signed-in user's email.
 * @returns The form.
 */
function JoinAsSignedInUser({ token, email }: { token: string; email: string }) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(acceptAction, null);
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <ResultAlert result={result} errorsOnly />
      <p className="text-sm text-muted-foreground">
        You&apos;re signed in as <span className="font-medium text-foreground">{email}</span>.
      </p>
      <Button type="submit" fullWidth loading={pending}>
        Accept invitation
      </Button>
    </form>
  );
}

/**
 * Sign-in link and create-account form for a signed-out visitor.
 *
 * @param props - Component props.
 * @param props.token - The token from the link.
 * @returns The options.
 */
function SignInOrCreateAccount({ token }: { token: string }) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    createAccountAction,
    null,
  );
  const signInHref = `/auth?callbackURL=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
        <input type="hidden" name="token" value={token} />
        <h2 className="text-base font-semibold text-foreground">Create your account</h2>
        <ResultAlert result={result} errorsOnly />
        <TextField
          label="Your name"
          name="name"
          autoComplete="name"
          required
          maxLength={NAME_MAX_LENGTH}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          required
        />
        <Button type="submit" fullWidth loading={pending}>
          Create account and join
        </Button>
      </form>

      <AuthDivider>or</AuthDivider>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Already have an Adiutor account?</p>
        <Button variant="secondary" fullWidth asChild>
          <Link href={signInHref}>Sign in to accept</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Shows the right way to accept for the visitor.
 *
 * @param props - Component props.
 * @param props.token - The token from the link.
 * @param props.signedInEmail - The signed-in user's email, or `null`.
 * @returns The accept options.
 */
export default function AcceptInvitation({ token, signedInEmail }: AcceptInvitationProps) {
  return signedInEmail ? (
    <JoinAsSignedInUser token={token} email={signedInEmail} />
  ) : (
    <SignInOrCreateAccount token={token} />
  );
}
