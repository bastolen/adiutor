/**
 * @file The two-step verification card on the Security page.
 */
'use client';

import { Mail, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef } from 'react';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import restoreFocusIfLost from '@/components/ui/focus-fallback';
import IconRow from '@/components/ui/icon-row';
import Modal from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useTransientState } from '@/components/ui/use-transient-state';
import type { EmailCodeStatus } from '@/lib/authz/mfa';
import loadAuthClient from '@/lib/sign-in/load-auth-client';

import AuthenticatorSetup from './authenticator-setup';
import BackupCodes from './backup-codes';
import EmailCodesSetup from './email-codes-setup';
import PasswordActionDialog from './password-action-dialog';

/** The card's anchor, which the step-up page comes back to (it renders the card itself). */
const SECTION = 'two-step';

/**
 * Props for {@link TwoFactorCard}.
 */
interface TwoFactorCardProps {
  /** The user's email address (where email codes go). */
  email: string;
  /** Whether two-step verification is on. */
  enabled: boolean;
  /** Whether an authenticator app is set up. */
  authenticatorSetUp: boolean;
  /**
   * How email codes stand: `available`; `replaced` by an authenticator app
   * (they aren't accepted then); or `not-for-role` (roles that require MFA,
   * for whom they don't count).
   */
  emailCodes: EmailCodeStatus;
  /** Whether the user has a password (to confirm changes with). */
  hasPassword: boolean;
  /** Why it can't be turned off, or `null` when it can (e.g. it's the last method a role needs). */
  turnOffBlockedReason: string | null;
}

/**
 * Shows whether two-step verification is on and lets the user set it up
 * with an authenticator app or email codes, add an authenticator later, get
 * new backup codes, or turn it off.
 *
 * With an authenticator app set up, email codes aren't accepted any more, so
 * the inbox alone can't get past the app. For roles that require MFA (staff
 * Admins and Managers, company Admins) email codes don't count, so they're
 * not offered.
 *
 * @param props - Card props.
 * @param props.email - The user's email address.
 * @param props.enabled - Whether it's on.
 * @param props.authenticatorSetUp - Whether an authenticator app is set up.
 * @param props.emailCodes - How email codes stand.
 * @param props.hasPassword - Ask for the password to confirm changes.
 * @param props.turnOffBlockedReason - Why turning off isn't allowed, if so.
 * @returns The card.
 */
export default function TwoFactorCard({
  email,
  enabled,
  authenticatorSetUp,
  emailCodes,
  hasPassword,
  turnOffBlockedReason,
}: TwoFactorCardProps) {
  const router = useRouter();
  const showToast = useToast();
  // Around "Turn off", which turning it off removes: focus then moves to the card's heading.
  const turnOffRef = useRef<HTMLDivElement>(null);
  const { askToConfirm } = useRecentConfirmation(SECTION);
  const turnOffNoteId = useId();
  const [dialog, setDialog] = useTransientState<
    'authenticator' | 'email' | 'backup' | 'turn-off' | null
  >(null);
  const [newCodes, setNewCodes] = useTransientState<string[] | null>(null);

  /**
   * Opens or closes a dialog.
   *
   * @param name - The dialog to open.
   * @returns A handler for the dialog's `onOpenChange`.
   */
  const toggle = (name: NonNullable<typeof dialog>) => (open: boolean) =>
    setDialog(open ? name : null);

  /**
   * Opens a dialog that changes how the user signs in, or first sends them to
   * confirm it's them when that needs a recent confirmation.
   *
   * @param name - The dialog to open.
   */
  const start = (name: NonNullable<typeof dialog>) => {
    if (!askToConfirm()) {
      setDialog(name);
    }
  };

  return (
    <Card
      id={SECTION}
      title="Two-step verification"
      description="After your password, enter a code from an authenticator app or from an email. You also confirm with it after signing in with an email link, or with a connected account that can't prove two-factor authentication."
      actions={enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
      flush={enabled}
      footer={
        enabled && (
          <div
            ref={turnOffRef}
            className="flex w-full flex-wrap items-center justify-between gap-3"
          >
            <span id={turnOffNoteId} className="text-xs text-muted-foreground">
              {turnOffBlockedReason ?? 'Turning it off makes your password enough to sign in.'}
            </span>
            <Button
              variant="danger-subtle"
              size="sm"
              disabled={turnOffBlockedReason !== null}
              aria-describedby={turnOffNoteId}
              onClick={() => start('turn-off')}
            >
              Turn off
            </Button>
          </div>
        )
      }
    >
      {enabled ? (
        <ul className="divide-y divide-border border-t border-border">
          <IconRow
            icon={<Mail className="size-4" />}
            iconClassName="text-muted-foreground"
            title="Email codes"
            control={
              {
                available: <Badge tone="success">Available</Badge>,
                replaced: <Badge>Not used</Badge>,
                'not-for-role': <Badge tone="warning">Not enough</Badge>,
              }[emailCodes]
            }
          >
            {
              {
                available: `Codes are sent to ${email}.`,
                replaced: 'Your authenticator app replaces them, so your inbox alone can’t get in.',
                'not-for-role':
                  'They don’t count for your role. Set up an authenticator app or add a passkey.',
              }[emailCodes]
            }
          </IconRow>
          <IconRow
            icon={<Smartphone className="size-4" />}
            iconClassName="text-muted-foreground"
            title="Authenticator app"
            control={
              authenticatorSetUp ? (
                <Button variant="secondary" size="sm" onClick={() => start('backup')}>
                  New backup codes
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => start('authenticator')}>
                  Set up
                </Button>
              )
            }
          >
            {authenticatorSetUp
              ? 'Set up, with backup codes for when you lose your phone.'
              : 'Codes that work offline, plus backup codes.'}
          </IconRow>
        </ul>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => start('authenticator')}>
            <Smartphone aria-hidden="true" />
            Use an authenticator app
          </Button>
          {emailCodes === 'available' && (
            <Button variant="secondary" onClick={() => start('email')}>
              <Mail aria-hidden="true" />
              Use email codes
            </Button>
          )}
        </div>
      )}

      <AuthenticatorSetup
        open={dialog === 'authenticator'}
        onOpenChange={toggle('authenticator')}
        hasPassword={hasPassword}
      />
      <EmailCodesSetup open={dialog === 'email'} onOpenChange={toggle('email')} email={email} />
      <PasswordActionDialog
        open={dialog === 'backup'}
        onOpenChange={toggle('backup')}
        title="Get new backup codes?"
        description="Your current backup codes stop working."
        confirmLabel="Get new codes"
        hasPassword={hasPassword}
        action={async (password) => {
          const authClient = await loadAuthClient();
          const result = await authClient.twoFactor.generateBackupCodes(
            password ? { password } : {},
          );
          if (result.data) {
            setNewCodes(result.data.backupCodes);
          }
          return { error: result.error ? { code: result.error.code } : null };
        }}
        onDone={() => setDialog(null)}
      />
      <Modal
        open={newCodes !== null}
        onOpenChange={(open) => !open && setNewCodes(null)}
        title="Your new backup codes"
      >
        <BackupCodes codes={newCodes ?? []} onDone={() => setNewCodes(null)} />
      </Modal>
      <PasswordActionDialog
        open={dialog === 'turn-off'}
        onOpenChange={toggle('turn-off')}
        title="Turn off two-step verification?"
        description="Your password alone will be enough to sign in. Your authenticator app and backup codes stop working."
        confirmLabel="Turn off"
        confirmVariant="danger"
        hasPassword={hasPassword}
        action={async (password) => {
          const authClient = await loadAuthClient();
          const result = await authClient.twoFactor.disable(password ? { password } : {});
          return { error: result.error ? { code: result.error.code } : null };
        }}
        onDone={() => {
          setDialog(null);
          showToast?.('Two-step verification is off.');
          restoreFocusIfLost(turnOffRef.current);
          router.refresh();
        }}
      />
    </Card>
  );
}
