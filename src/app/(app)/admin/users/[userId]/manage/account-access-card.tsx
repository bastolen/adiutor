/**
 * @file The "Account access" card on the Manage tab of a user's page, for Admins
 * (`users:manage`) on someone else's page: reset two-step verification (which
 * also disconnects their GitHub and Google accounts, and can remove their
 * passkeys), and deactivate or reactivate the account. A reset, and
 * reactivating an account that gets a staff role or a company's Admin role
 * back, need the Admin's confirmation with their own second step from the
 * last 15 minutes, so their buttons send them to confirm before their dialog
 * opens. Text from `admin.user.accountAccess`.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import CheckboxField from '@/components/ui/checkbox-field';
import RowAction from '@/components/ui/row-action';
import type { UserDetail } from '@/server/people/user-admin';

import { deactivateUserAction, reactivateUserAction, resetMfaAction } from '../actions';

/**
 * One action in the card: what it does on the left, its button on the right
 * (stacked on phones), as a full-width row.
 *
 * @param props - Component props.
 * @param props.title - What the action is.
 * @param props.description - What it does.
 * @param props.children - The button.
 */
function ManageRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0 self-start sm:self-auto">{children}</div>
    </div>
  );
}

/**
 * Props for {@link AccountAccessCard}.
 */
interface AccountAccessCardProps {
  /** The user's ID. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** Their MFA details: what a reset can take away. */
  mfa: UserDetail['mfa'];
  /** How many GitHub or Google accounts they have connected. */
  connectedAccounts: number;
  /** When the account was deactivated, if it is. */
  deactivatedAt: Date | null;
  /**
   * Whether reactivating it gives back a role that needs the Admin's recent
   * confirmation (`UserDetail.reactivationNeedsConfirmation`).
   */
  reactivationNeedsConfirmation: boolean;
}

/**
 * The controls over the user's account access. "Reset" asks the Admin to
 * confirm it's them first when they haven't lately (`confirmFirst`), before
 * its dialog opens: asked only once the dialog is submitted (the action's
 * own check, which stays as the backstop), the choice made in it, removing
 * the passkeys too, was lost on the way. "Reactivate" asks the same before
 * its confirmation opens when the account gets a staff role or a company's
 * Admin role back.
 */
export default function AccountAccessCard({
  userId,
  userName,
  mfa,
  connectedAccounts,
  deactivatedAt,
  reactivationNeedsConfirmation,
}: AccountAccessCardProps) {
  const t = useTranslations('admin.user.accountAccess');
  const fields = { userId };
  // What an MFA reset can take away: two-step verification, passkeys and connected accounts.
  const hasSomethingToReset = mfa.twoFactorEnabled || mfa.passkeyCount > 0 || connectedAccounts > 0;
  return (
    <Card id="account-access" title={t('title')} description={t('description')} flush>
      <div className="divide-y divide-border border-t border-border">
        <ManageRow
          title={t('reset.title')}
          description={
            hasSomethingToReset ? t('reset.descriptionAvailable') : t('reset.descriptionNone')
          }
        >
          <ActionDialog
            disabled={!hasSomethingToReset}
            // Its own action leaves nothing to reset; it keeps focus then.
            focusableWhenDisabled
            action={resetMfaAction}
            fields={fields}
            // A reset needs a recent confirmation: ask before the dialog opens, not after its choice.
            confirmFirst
            triggerLabel={t('reset.label')}
            title={t('reset.dialogTitle', { name: userName })}
            description={
              connectedAccounts > 0
                ? t('reset.dialogDescriptionWithAccounts')
                : t('reset.dialogDescription')
            }
            confirmLabel={t('reset.confirmLabel')}
          >
            {mfa.passkeyCount > 0 && (
              <CheckboxField
                name="removePasskeys"
                label={t('reset.removePasskeys', { count: mfa.passkeyCount })}
                description={t('reset.removePasskeysHint')}
              />
            )}
          </ActionDialog>
        </ManageRow>
        <ManageRow
          title={deactivatedAt ? t('reactivate.title') : t('deactivate.title')}
          description={deactivatedAt ? t('reactivate.description') : t('deactivate.description')}
        >
          {deactivatedAt ? (
            <RowAction
              action={reactivateUserAction}
              fields={fields}
              // A staff role or a company's Admin role it gets back needs a recent confirmation.
              confirmFirst={reactivationNeedsConfirmation}
              label={t('reactivate.label')}
              confirm={{
                title: t('reactivate.confirmTitle', { name: userName }),
                description: t('reactivate.confirmDescription'),
                confirmLabel: t('reactivate.confirmLabel'),
              }}
            />
          ) : (
            <RowAction
              action={deactivateUserAction}
              fields={fields}
              label={t('deactivate.label')}
              variant="danger-subtle"
              confirm={{
                title: t('deactivate.confirmTitle', { name: userName }),
                description: t('deactivate.confirmDescription'),
                confirmLabel: t('deactivate.confirmLabel'),
              }}
            />
          )}
        </ManageRow>
      </div>
    </Card>
  );
}
