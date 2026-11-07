/**
 * @file The "Account access" card on the user detail page, for Admins
 * (`users:manage`) on someone else's page: reset two-step verification (which
 * also disconnects their GitHub and Google accounts, and can remove their
 * passkeys), and deactivate or reactivate the account.
 */
import type { ReactNode } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import CheckboxField from '@/components/ui/checkbox-field';
import RowAction from '@/components/ui/row-action';
import type { UserDetail } from '@/server/people/user-admin';

import { deactivateUserAction, reactivateUserAction, resetMfaAction } from './actions';

/**
 * One action in the card: what it does on the left, its button on the right
 * (stacked on phones), as a full-width row.
 *
 * @param props - Component props.
 * @param props.title - What the action is.
 * @param props.description - What it does.
 * @param props.children - The button.
 * @returns The row.
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
}

/**
 * The controls over the user's account access.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.mfa - Their MFA details.
 * @param props.connectedAccounts - How many provider accounts they have connected.
 * @param props.deactivatedAt - When the account was deactivated, if it is.
 * @returns The card.
 */
export default function AccountAccessCard({
  userId,
  userName,
  mfa,
  connectedAccounts,
  deactivatedAt,
}: AccountAccessCardProps) {
  const fields = { userId };
  // What an MFA reset can take away: two-step verification, passkeys and connected accounts.
  const hasSomethingToReset = mfa.twoFactorEnabled || mfa.passkeyCount > 0 || connectedAccounts > 0;
  return (
    <Card
      id="account-access"
      title="Account access"
      description="Each change is recorded in the activity log, and the user gets an email."
      flush
    >
      <div className="divide-y divide-border border-t border-border">
        <ManageRow
          title="Reset two-step verification"
          description={
            hasSomethingToReset
              ? 'For a lost phone, or a GitHub or Google account that isn’t theirs: turns off two-step verification and disconnects GitHub and Google, so they can sign in and set it up again.'
              : 'Nothing to reset: they have no two-step verification, passkeys or connected GitHub or Google accounts.'
          }
        >
          <ActionDialog
            disabled={!hasSomethingToReset}
            action={resetMfaAction}
            fields={fields}
            triggerLabel="Reset"
            title={`Reset two-step verification for ${userName}?`}
            description={
              connectedAccounts > 0
                ? "Their authenticator app and backup codes stop working, their connected GitHub and Google accounts are disconnected, and they're signed out everywhere. If their role requires it, they're asked to set up MFA again at their next sign-in."
                : "Their authenticator app and backup codes stop working, and they're signed out everywhere. If their role requires it, they're asked to set up MFA again at their next sign-in."
            }
            confirmLabel="Reset two-step verification"
          >
            {mfa.passkeyCount > 0 && (
              <CheckboxField
                name="removePasskeys"
                label={`Also remove their ${mfa.passkeyCount === 1 ? 'passkey' : `${mfa.passkeyCount} passkeys`}`}
                description="Only when a passkey may be lost or stolen."
              />
            )}
          </ActionDialog>
        </ManageRow>
        <ManageRow
          title={deactivatedAt ? 'Reactivate account' : 'Deactivate account'}
          description={
            deactivatedAt
              ? 'They can sign in again with their existing sign-in methods.'
              : 'Signs them out everywhere and blocks sign-in until reactivated. Their memberships and data stay.'
          }
        >
          {deactivatedAt ? (
            <RowAction
              action={reactivateUserAction}
              fields={fields}
              label="Reactivate"
              confirm={{
                title: `Reactivate ${userName}?`,
                description: 'They can sign in again and get back their access.',
                confirmLabel: 'Reactivate',
              }}
            />
          ) : (
            <RowAction
              action={deactivateUserAction}
              fields={fields}
              label="Deactivate"
              variant="danger-subtle"
              confirm={{
                title: `Deactivate ${userName}?`,
                description:
                  'They are signed out everywhere and can’t sign in until an Admin reactivates the account.',
                confirmLabel: 'Deactivate',
              }}
            />
          )}
        </ManageRow>
      </div>
    </Card>
  );
}
