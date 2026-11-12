/**
 * @file Form to set or change the user's password. Setting a first password
 * on an account with a second step needs a confirmation with that step from
 * the last 15 minutes, so submitting without one sends the user to confirm
 * first (see `useRecentConfirmation`).
 */
'use client';

import { useTranslations } from 'next-intl';

import { ReturnToField, useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/input-rules';

import { passwordAction } from './actions';

/**
 * New password fields, plus the current password when one is already set.
 *
 * @param props - Form props.
 * @param props.hasPassword - Whether the user already has a password.
 * @param props.blockedReason - Why a first password can't be set, if so.
 * @returns The form, or the reason it isn't offered.
 */
export default function PasswordForm({
  hasPassword,
  blockedReason,
}: {
  hasPassword: boolean;
  /**
   * Why a first password can't be set (it would take away the MFA the user's
   * role requires, see `mfaDowngradeBlocks`), or `null` when it can.
   */
  blockedReason: string | null;
}) {
  const t = useTranslations('account');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(passwordAction, null);
  const { askToConfirm } = useRecentConfirmation();

  if (!hasPassword && blockedReason) {
    return <p className="text-sm text-muted-foreground">{blockedReason}</p>;
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // A first password needs a recent confirmation first; otherwise the hook submits it.
        if (!hasPassword && askToConfirm()) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-4"
      key={result?.ok ? 'saved' : 'form'}
    >
      <ChangesFieldset>
        {/* The page and card to come back to, if the action sends the user to confirm first. */}
        <ReturnToField />
        <ResultAlert result={result} />
        {hasPassword && (
          <TextField
            label={t('security.currentPassword')}
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            disabled={changesOff}
          />
        )}
        <TextField
          label={t('security.password.newPassword')}
          type="password"
          name="newPassword"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          description={t('security.password.hint', { min: MIN_PASSWORD_LENGTH })}
          required
          disabled={changesOff}
        />
        <TextField
          label={t('security.password.confirmNew')}
          type="password"
          name="confirmation"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          required
          disabled={changesOff}
        />
        <div>
          <Button type="submit" loading={pending} disabled={changesOff}>
            {hasPassword ? t('security.password.change') : t('security.password.set')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
