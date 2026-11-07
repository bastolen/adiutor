/**
 * @file Dialog that sets up an authenticator app: confirm password, scan the
 * QR code, enter a code, save the backup codes.
 */
'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';

import CodeField from '@/components/auth/code-field';
import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import Modal from '@/components/ui/modal';
import { authErrorMessage } from '@/lib/sign-in/auth-error-messages';
import loadAuthClient from '@/lib/sign-in/load-auth-client';
import verifyCode from '@/lib/sign-in/verify-code';

import BackupCodes from './backup-codes';
import PasswordField from './password-field';

/** The setup steps. */
type Step = 'password' | 'scan' | 'backup';

/**
 * Props for {@link AuthenticatorSetup}.
 */
interface AuthenticatorSetupProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called to open or close it. */
  onOpenChange: (open: boolean) => void;
  /** Whether the user has a password to confirm with. */
  hasPassword: boolean;
}

/**
 * Formats a setup key in groups of four, for typing it into an app by hand.
 *
 * @param secret - The key.
 * @returns The grouped key.
 */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * The setup steps. Rendered only while the dialog is open, so each opening
 * starts fresh.
 *
 * @param props - Step props.
 * @param props.hasPassword - Ask for the password first.
 * @param props.onStepChange - Reports the current step (for the dialog's title).
 * @param props.onFinish - Called after the backup codes are saved.
 * @returns The current step.
 */
function AuthenticatorSteps({
  hasPassword,
  onStepChange,
  onFinish,
}: {
  hasPassword: boolean;
  onStepChange: (step: Step) => void;
  onFinish: () => void;
}) {
  const { askToConfirmOnRefusal } = useRecentConfirmation();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secret = totpURI ? (new URL(totpURI).searchParams.get('secret') ?? '') : '';

  /**
   * Moves to a step.
   *
   * @param next - The step.
   */
  const go = (next: Step) => {
    setStep(next);
    onStepChange(next);
  };

  useEffect(() => {
    if (!totpURI) {
      return;
    }
    // Loaded only now: the page doesn't need the QR library until someone sets up an app.
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(totpURI, { margin: 1, width: 192 }))
      .then(setQrCode)
      // Without the QR code, the setup key below still works.
      .catch(() => undefined);
  }, [totpURI]);

  /**
   * Creates the authenticator secret and backup codes.
   *
   * @param event - The form submit event.
   */
  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const authClient = await loadAuthClient();
    const result = await authClient.twoFactor.enable({
      method: 'totp',
      ...(hasPassword ? { password } : {}),
    });
    setPending(false);
    if (result.error) {
      if (!askToConfirmOnRefusal(result.error.code)) {
        setError(authErrorMessage(result.error));
      }
      return;
    }
    if ('totpURI' in result.data && result.data.totpURI) {
      setTotpURI(result.data.totpURI);
      setBackupCodes(result.data.backupCodes ?? []);
      go('scan');
    }
  };

  /**
   * Checks the first code from the app, which switches it on.
   *
   * @param event - The form submit event.
   */
  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await verifyCode('totp', { code });
    setPending(false);
    if (result.error) {
      if (!askToConfirmOnRefusal(result.error.code)) {
        setError(authErrorMessage(result.error));
      }
      return;
    }
    go('backup');
  };

  return (
    <>
      <Alert tone="error" focusOnShow alsoToast>
        {error}
      </Alert>
      {step === 'password' && (
        <form className="flex flex-col gap-4" onSubmit={start}>
          {hasPassword && <PasswordField value={password} onChange={setPassword} />}
          <Button type="submit" loading={pending}>
            Continue
          </Button>
        </form>
      )}
      {step === 'scan' && (
        <form className="flex flex-col gap-4" onSubmit={submitCode}>
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-foreground">
            <li>
              Scan this QR code with your app.
              {qrCode && (
                // eslint-disable-next-line @next/next/no-img-element -- A generated data URL, not a static asset.
                <img
                  src={qrCode}
                  alt="QR code to add Adiutor to your authenticator app"
                  width={192}
                  height={192}
                  className="mt-2 rounded-lg border border-border bg-white p-2"
                />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Can&apos;t scan it? Enter this key instead:{' '}
                <code className="font-mono font-medium break-all text-foreground select-all">
                  {groupKey(secret)}
                </code>
              </p>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <CodeField
            kind="totp"
            description=""
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" loading={pending}>
            Turn on
          </Button>
        </form>
      )}
      {step === 'backup' && <BackupCodes codes={backupCodes} onDone={onFinish} />}
    </>
  );
}

/**
 * Walks through setting up an authenticator app. The QR code is drawn in
 * the browser from the setup link, which never leaves the page; the key is
 * also shown as text for entering by hand. The app is only switched on once
 * a code from it has been checked.
 *
 * @param props - Dialog props.
 * @param props.open - Open state.
 * @param props.onOpenChange - Open state handler.
 * @param props.hasPassword - Ask for the password first.
 * @returns The dialog.
 */
export default function AuthenticatorSetup({
  open,
  onOpenChange,
  hasPassword,
}: AuthenticatorSetupProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('password');

  /** Closes the dialog and shows the new state. */
  const finish = () => {
    onOpenChange(false);
    setStep('password');
    router.refresh();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && step !== 'password') {
          // Past the first step something changed on the server, so refresh.
          finish();
          return;
        }
        onOpenChange(next);
      }}
      title={step === 'backup' ? 'Save your backup codes' : 'Set up an authenticator app'}
      description={
        step === 'backup'
          ? 'Your authenticator app is set up.'
          : 'Use an app like 1Password, Google Authenticator or Microsoft Authenticator.'
      }
    >
      <AuthenticatorSteps hasPassword={hasPassword} onStepChange={setStep} onFinish={finish} />
    </Modal>
  );
}
