/**
 * @file The "Delete account" card on the user detail page, for Admins
 * (`users:delete`) on someone else's page: deletes the account for good,
 * after the Admin types its email address to confirm.
 */
import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import TextField from '@/components/ui/text-field';

import { deleteUserAction } from './actions';

/**
 * Props for {@link DeleteAccountCard}.
 */
interface DeleteAccountCardProps {
  /** The user's ID. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** Their email address, which the Admin types to confirm. */
  email: string;
}

/**
 * Deletes the user's account.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.email - Their email address.
 * @returns The card.
 */
export default function DeleteAccountCard({ userId, userName, email }: DeleteAccountCardProps) {
  return (
    <Card
      title="Delete account"
      tone="danger"
      description="Permanently removes the account, its sign-in methods and memberships, revokes the open invitations and invite links they sent and the open invitations addressed to them, and emails them that it was deleted. This can't be undone."
      actions={
        <ActionDialog
          action={deleteUserAction}
          fields={{ userId }}
          triggerLabel="Delete"
          triggerVariant="danger-subtle"
          title={`Delete ${userName}'s account?`}
          description="This permanently removes the account, revokes the open invitations and invite links they sent and those addressed to them, and emails them that it was deleted. Type their email address to confirm."
          confirmLabel="Delete account"
        >
          <TextField
            label="Email address"
            name="confirmEmail"
            type="email"
            autoComplete="off"
            spellCheck={false}
            required
            description={email}
          />
        </ActionDialog>
      }
    />
  );
}
