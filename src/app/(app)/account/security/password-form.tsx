/**
 * @file Form to set or change the user's password. Setting a first password
 * on an account with a second step needs a confirmation with that step from
 * the last 15 minutes, so submitting without one sends the user to confirm
 * first (see `useRecentConfirmation`).
 */
'use client';

import { ReturnToField, useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { MIN_PASSWORD_LENGTH } from '@/lib/input-rules';

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
  blockedReason = null,
}: {
  hasPassword: boolean;
  /**
   * Why a first password can't be set (it would take away the MFA the user's
   * role requires, see `mfaDowngradeBlocks`), or `null` when it can.
   */
  blockedReason?: string | null;
}) {
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
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      <ResultAlert result={result} />
      {hasPassword && (
        <TextField
          label="Current password"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      )}
      <TextField
        label="New password"
        type="password"
        name="newPassword"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        required
      />
      <TextField
        label="Confirm new password"
        type="password"
        name="confirmation"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
      />
      <div>
        <Button type="submit" loading={pending}>
          {hasPassword ? 'Change password' : 'Set password'}
        </Button>
      </div>
    </form>
  );
}
