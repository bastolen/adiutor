/**
 * @file The two-step verification card on the Security page.
 */
'use client';

import { Mail, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import restoreFocusIfLost from '@/components/ui/focus-fallback';
import IconRow from '@/components/ui/icon-row';
import Modal from '@/components/ui/modal';
import { useSignedInAs } from '@/components/ui/signed-in-as';
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
  const t = useTranslations('account');
  // Nothing changes while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
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
      title={t('security.twoFactor.title')}
      description={t('security.twoFactor.description')}
      actions={
        enabled ? (
          <Badge tone="success">{t('security.twoFactor.on')}</Badge>
        ) : (
          <Badge>{t('security.twoFactor.off')}</Badge>
        )
      }
      flush={enabled}
      footer={
        enabled && (
          <div
            ref={turnOffRef}
            className="flex w-full flex-wrap items-center justify-between gap-3"
          >
            <span id={turnOffNoteId} className="text-xs text-muted-foreground">
              {turnOffBlockedReason ?? t('security.twoFactor.turnOffNote')}
            </span>
            <Button
              variant="danger-subtle"
              size="sm"
              disabled={turnOffBlockedReason !== null || changesOff}
              aria-describedby={turnOffNoteId}
              onClick={() => start('turn-off')}
            >
              {t('security.twoFactor.turnOff')}
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
            title={t('security.twoFactor.emailCodes')}
            control={
              {
                available: <Badge tone="success">{t('security.twoFactor.available')}</Badge>,
                replaced: <Badge>{t('security.twoFactor.notUsed')}</Badge>,
                'not-for-role': <Badge tone="warning">{t('security.twoFactor.notEnough')}</Badge>,
              }[emailCodes]
            }
          >
            {
              {
                available: t('security.twoFactor.emailAvailable', { email }),
                replaced: t('security.twoFactor.emailReplaced'),
                'not-for-role': t('security.twoFactor.emailNotForRole'),
              }[emailCodes]
            }
          </IconRow>
          <IconRow
            icon={<Smartphone className="size-4" />}
            iconClassName="text-muted-foreground"
            title={t('security.twoFactor.authenticator')}
            control={
              authenticatorSetUp ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={changesOff}
                  onClick={() => start('backup')}
                >
                  {t('security.twoFactor.newBackupCodes')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={changesOff}
                  onClick={() => start('authenticator')}
                >
                  {t('security.twoFactor.setUp')}
                </Button>
              )
            }
          >
            {authenticatorSetUp
              ? t('security.twoFactor.authenticatorSetUp')
              : t('security.twoFactor.authenticatorNotSetUp')}
          </IconRow>
        </ul>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={changesOff} onClick={() => start('authenticator')}>
            <Smartphone aria-hidden="true" />
            {t('security.twoFactor.useAuthenticator')}
          </Button>
          {emailCodes === 'available' && (
            <Button variant="secondary" disabled={changesOff} onClick={() => start('email')}>
              <Mail aria-hidden="true" />
              {t('security.twoFactor.useEmailCodes')}
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
        title={t('security.twoFactor.backupTitle')}
        description={t('security.twoFactor.backupDescription')}
        confirmLabel={t('security.twoFactor.backupConfirm')}
        hasPassword={hasPassword}
        action={async (password) => {
          const authClient = await loadAuthClient();
          const result = await authClient.twoFactor.generateBackupCodes(
            password ? { password } : {},
          );
          if (result.data) {
            setNewCodes(result.data.backupCodes);
          }
          return {
            error: result.error ? { code: result.error.code, message: result.error.message } : null,
          };
        }}
        onDone={() => setDialog(null)}
      />
      <Modal
        open={newCodes !== null}
        onOpenChange={(open) => !open && setNewCodes(null)}
        title={t('security.twoFactor.newCodesTitle')}
      >
        <BackupCodes codes={newCodes ?? []} onDone={() => setNewCodes(null)} />
      </Modal>
      <PasswordActionDialog
        open={dialog === 'turn-off'}
        onOpenChange={toggle('turn-off')}
        title={t('security.twoFactor.turnOffTitle')}
        description={t('security.twoFactor.turnOffDescription')}
        confirmLabel={t('security.twoFactor.turnOff')}
        confirmVariant="danger"
        hasPassword={hasPassword}
        action={async (password) => {
          const authClient = await loadAuthClient();
          const result = await authClient.twoFactor.disable(password ? { password } : {});
          return {
            error: result.error ? { code: result.error.code, message: result.error.message } : null,
          };
        }}
        onDone={() => {
          setDialog(null);
          showToast?.(t('security.twoFactor.turnedOff'));
          restoreFocusIfLost(turnOffRef.current);
          router.refresh();
        }}
      />
    </Card>
  );
}
