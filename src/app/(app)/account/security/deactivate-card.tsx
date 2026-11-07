/**
 * @file The "Deactivate account" card at the bottom of the Security page.
 * Like changing how the user signs in, deactivating needs a confirmation
 * with the second step from the last 15 minutes, so starting it without one
 * sends the user to confirm first (see `useRecentConfirmation`).
 */
'use client';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import ActionDialog from '@/components/ui/action-dialog';
import Card from '@/components/ui/card';
import TextField from '@/components/ui/text-field';

import { deactivateAccountAction } from './actions';

/** The card's anchor, which the step-up page comes back to (it renders the card itself). */
const SECTION = 'deactivate';

/**
 * Props for {@link DeactivateCard}.
 */
interface DeactivateCardProps {
  /** Whether the user has a password, which they then type to confirm. */
  hasPassword: boolean;
  /** Why they can't deactivate (they're the last Admin of something), or `null`. */
  blockedReason: string | null;
}

/**
 * Lets users deactivate their own account. They're signed out everywhere and
 * can't sign in until an Admin reactivates it; nothing is deleted. Blocked
 * while they're the only Admin of a company. Without a recent confirmation
 * with their second step, the button sends them to confirm first instead of
 * opening the dialog (the server refuses it too).
 *
 * @param props - Card props.
 * @param props.hasPassword - Ask for the password to confirm.
 * @param props.blockedReason - Why deactivating is blocked, if it is.
 * @returns The card.
 */
export default function DeactivateCard({ hasPassword, blockedReason }: DeactivateCardProps) {
  const { askToConfirm } = useRecentConfirmation(SECTION);
  const blocked = blockedReason !== null;
  return (
    <Card
      id={SECTION}
      title="Deactivate account"
      tone="danger"
      description={
        blocked
          ? `${blockedReason} Make someone else an Admin before you deactivate your account.`
          : "You're signed out everywhere and can't sign in until an Admin reactivates your account. Nothing is deleted."
      }
      actions={
        blocked ? undefined : (
          <ActionDialog
            action={deactivateAccountAction}
            triggerLabel="Deactivate"
            triggerVariant="danger-subtle"
            title="Deactivate your account?"
            description="You're signed out on every device right away. To use Adiutor again, ask an Admin to reactivate your account."
            confirmLabel="Deactivate my account"
            onTriggerClick={(event) => {
              if (askToConfirm()) {
                event.preventDefault();
              }
            }}
          >
            {hasPassword && (
              <TextField
                label="Current password"
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
