/**
 * @file The ways to accept an invitation: join as the signed-in user, or sign
 * in or create an account when signed out.
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import accountTag from '@/components/auth/account-tag';
import AuthDivider from '@/components/ui/auth-divider';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH } from '@/lib/input-rules';
import { signInPath } from '@/lib/redirect';

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
  const t = useTranslations('auth');
  const [result, formAction, pending, onSubmit] = useTransientActionState(acceptAction, null);
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <ResultAlert result={result} errorsOnly />
      <p className="text-sm text-muted-foreground">
        {t.rich('invite.signedInAs', { email, account: accountTag })}
      </p>
      <Button type="submit" fullWidth loading={pending}>
        {t('invite.accept')}
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
  const t = useTranslations('auth');
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    createAccountAction,
    null,
  );
  const signInHref = signInPath(`/invite/${token}`);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
        <input type="hidden" name="token" value={token} />
        <h2 className="text-base font-semibold text-foreground">{t('invite.createAccount')}</h2>
        <ResultAlert result={result} errorsOnly />
        <TextField
          label={t('fields.yourName')}
          name="name"
          autoComplete="name"
          required
          maxLength={NAME_MAX_LENGTH}
        />
        <TextField
          label={t('fields.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          description={t('fields.passwordHint', { min: MIN_PASSWORD_LENGTH })}
          required
        />
        <Button type="submit" fullWidth loading={pending}>
          {t('invite.createAndJoin')}
        </Button>
      </form>

      <AuthDivider>{t('invite.or')}</AuthDivider>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('invite.haveAccount')}</p>
        <Button variant="secondary" fullWidth asChild>
          <Link href={signInHref}>{t('invite.signInToAccept')}</Link>
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
