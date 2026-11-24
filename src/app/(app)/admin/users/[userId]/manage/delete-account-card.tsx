/**
 * @file The "Delete account" card on the Manage tab of a user's page, for Admins
 * (`users:delete`) on someone else's page: deletes the account for good,
 * after the Admin types its email address to confirm. Text from
 * `admin.user.deleteAccount`.
 */
import { useTranslations } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import TextField from '@/components/ui/text-field';

import { deleteUserAction } from '../actions';

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
 * @returns The card.
 */
export default function DeleteAccountCard({ userId, userName, email }: DeleteAccountCardProps) {
  const t = useTranslations('admin.user.deleteAccount');
  return (
    <Card
      title={t('title')}
      tone="danger"
      description={t('description')}
      actions={
        <ActionDialog
          action={deleteUserAction}
          fields={{ userId }}
          triggerLabel={t('label')}
          triggerVariant="danger-subtle"
          title={t('dialogTitle', { name: userName })}
          description={t('dialogDescription')}
          confirmLabel={t('confirmLabel')}
        >
          <TextField
            label={t('emailLabel')}
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
