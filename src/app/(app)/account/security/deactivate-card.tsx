/**
 * @file The "Deactivate account" card at the bottom of the Security page.
 * Like changing how the user signs in, deactivating needs a confirmation
 * with the second step from the last 15 minutes, so starting it without one
 * sends the user to confirm first (see `useRecentConfirmation`). Once it's
 * done, the sign-in page loads afresh in every tab of the browser
 * (`loadOnSuccess`), saying the account is deactivated.
 */
'use client';

import { useTranslations } from 'next-intl';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import TextField from '@/components/ui/text-field';

import { deactivateAccountAction } from './actions';

/** The card's anchor, which the step-up page comes back to (it renders the card itself). */
const SECTION = 'deactivate';

/** The sign-in page, saying the account is deactivated, which loads once it's done. */
const DEACTIVATED_PATH = '/auth?error=ACCOUNT_DEACTIVATED';

/**
 * Props for {@link DeactivateCard}.
 */
interface DeactivateCardProps {
  /** Whether the user has a password, which they then type to confirm. */
  hasPassword: boolean;
  /**
   * Why they can't deactivate (they're the last Admin of something) and what
   * to do first, or `null`.
   */
  blockedReason: string | null;
}

/**
 * Lets users deactivate their own account. They're signed out everywhere and
 * can't sign in until an Admin reactivates it; nothing is deleted. Blocked
 * while they're the only Admin of a company. Without a recent confirmation
 * with their second step, the button sends them to confirm first instead of
 * opening the dialog (the server refuses it too).
 */
export default function DeactivateCard({ hasPassword, blockedReason }: DeactivateCardProps) {
  const t = useTranslations('account');
  const { askToConfirm } = useRecentConfirmation(SECTION);
  const blocked = blockedReason !== null;
  return (
    <Card
      id={SECTION}
      title={t('security.deactivate.title')}
      tone="danger"
      description={blockedReason ?? t('security.deactivate.description')}
      actions={
        blocked ? undefined : (
          <ActionDialog
            action={deactivateAccountAction}
            loadOnSuccess={DEACTIVATED_PATH}
            triggerLabel={t('security.deactivate.trigger')}
            triggerVariant="danger-subtle"
            title={t('security.deactivate.dialogTitle')}
            description={t('security.deactivate.dialogDescription')}
            confirmLabel={t('security.deactivate.confirm')}
            onTriggerClick={(event) => {
              if (askToConfirm()) {
                event.preventDefault();
              }
            }}
          >
            {hasPassword && (
              <TextField
                label={t('security.currentPassword')}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </ActionDialog>
        )
      }
    />
  );
}
