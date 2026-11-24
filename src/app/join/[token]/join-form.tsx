/**
 * @file The ways to use an invite link: join as the signed-in user, or enter
 * an email address when signed out.
 */
'use client';

import { MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import accountTag from '@/components/auth/account-tag';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import IconTile from '@/components/ui/icon-tile';
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
 * Once it has gone through, a confirmation takes the form's place and takes
 * keyboard focus: the button that had it is gone, and focus would otherwise
 * fall to `<body>`.
 */
export default function JoinForm({ token, signedInEmail }: JoinFormProps) {
  const t = useTranslations('auth');
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    signedInEmail ? joinAction : claimAction,
    null,
  );

  if (result?.ok) {
    return (
      <div className="flex flex-col items-start gap-4">
        <IconTile icon={MailCheck} tone="success" size="lg" />
        <Alert tone="success" focusOnShow>
          {result.message ?? null}
        </Alert>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <ResultAlert result={result} errorsOnly />
      {signedInEmail ? (
        <p className="text-sm text-muted-foreground">
          {t.rich('join.joinAs', { email: signedInEmail, account: accountTag })}
        </p>
      ) : (
        <TextField
          label={t('fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          placeholder={t('fields.emailPlaceholder')}
          description={t('join.emailHint')}
          required
        />
      )}
      <Button type="submit" fullWidth loading={pending}>
        {signedInEmail ? t('join.join') : t('join.continue')}
      </Button>
    </form>
  );
}
