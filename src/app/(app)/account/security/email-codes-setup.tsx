/**
 * @file Dialog that turns on email codes: send a code, enter it.
 */
'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import CodeField from '@/components/auth/code-field';
import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import ResendCodeButton from '@/components/auth/resend-code-button';
import useResendCooldown from '@/components/auth/use-resend-cooldown';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import Modal from '@/components/ui/modal';
import { EMAIL_CODE_MINUTES } from '@/lib/authz/mfa';
import { authErrorMessage } from '@/lib/sign-in/auth-error-messages';
import loadAuthClient from '@/lib/sign-in/load-auth-client';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';
import verifyCode from '@/lib/sign-in/verify-code';

/**
 * Props for {@link EmailCodesSetup}.
 */
interface EmailCodesSetupProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called to open or close it. */
  onOpenChange: (open: boolean) => void;
  /** The user's email address, where codes go. */
  email: string;
}

/**
 * The send-and-verify steps. Rendered only while the dialog is open, so each
 * opening starts fresh.
 *
 * @param props - Step props.
 * @param props.email - Where codes are sent.
 * @param props.onDone - Called once email codes are on.
 * @returns The steps.
 */
function EmailCodesSteps({ email, onDone }: { email: string; onDone: () => void }) {
  const { askToConfirmOnRefusal } = useRecentConfirmation();
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useResendCooldown();

  /**
   * Emails a code, then counts down until a new one may be asked for. A code
   * sent a moment ago still works, so that refusal shows the code field with
   * its message as the notice, not as an error.
   *
   * @param again - Whether it's a new code after an earlier one.
   */
  const send = async (again = false) => {
    setSending(true);
    setError(null);
    const authClient = await loadAuthClient();
    const result = await authClient.twoFactor.sendOtp();
    setSending(false);
    if (result.error?.code === EMAIL_CODE_SENT_RECENTLY.code) {
      setSent(true);
      setNotice(EMAIL_CODE_SENT_RECENTLY.message);
      cooldown.start();
      return;
    }
    if (result.error) {
      if (!askToConfirmOnRefusal(result.error.code)) {
        setError(authErrorMessage(result.error));
      }
      return;
    }
    setSent(true);
    cooldown.start();
    setNotice(
      `We sent ${again ? 'a new code' : 'a code'} to ${email}. It expires in ${EMAIL_CODE_MINUTES} minutes.`,
    );
  };

  /**
   * Checks the code, which turns email codes on.
   *
   * @param event - The form submit event.
   */
  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await verifyCode('otp', { code });
    setPending(false);
    if (result.error) {
      if (!askToConfirmOnRefusal(result.error.code)) {
        setError(authErrorMessage(result.error));
      }
      return;
    }
    onDone();
  };

  return (
    <>
      <Alert tone="error" focusOnShow alsoToast>
        {error}
      </Alert>
      {sent ? (
        <form className="flex flex-col gap-4" onSubmit={verify}>
          <Alert tone="info">{notice}</Alert>
          <CodeField kind="otp" value={code} onChange={(event) => setCode(event.target.value)} />
          <Button type="submit" loading={pending}>
            Turn on
          </Button>
          <ResendCodeButton
            onClick={() => send(true)}
            sending={sending}
            waitSeconds={cooldown.waitSeconds}
          />
        </form>
      ) : (
        <Button loading={sending} onClick={() => send()}>
          Send a code to check it works
        </Button>
      )}
    </>
  );
}

/**
 * Turns on two-step verification with email codes. Entering a code sent to
 * the user's address proves the codes arrive before relying on them.
 *
 * @param props - Dialog props.
 * @param props.open - Open state.
 * @param props.onOpenChange - Open state handler.
 * @param props.email - Where codes are sent.
 * @returns The dialog.
 */
export default function EmailCodesSetup({ open, onOpenChange, email }: EmailCodesSetupProps) {
  const router = useRouter();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Use email codes"
      description={`After your password, you'll enter a code we email to ${email}.`}
    >
      <EmailCodesSteps
        email={email}
        onDone={() => {
          onOpenChange(false);
          router.refresh();
        }}
      />
    </Modal>
  );
}
