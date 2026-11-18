/**
 * @file Dialog that asks for the password (when the user has one) before a
 * sensitive two-step verification change.
 */
'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import Alert from '@/components/ui/alert';
import Button, { type ButtonProps } from '@/components/ui/button';
import Modal from '@/components/ui/modal';

import PasswordField from './password-field';
import useRefusalText from './use-refusal-text';

/** What the action returns: nothing when it worked, or Better Auth's error. */
interface ActionOutcome {
  /** The error's code (and message, shown only for refusals the server words), or `null`. */
  error: { code?: string; message?: string } | null;
}

/**
 * Props for {@link PasswordActionDialog}.
 */
interface PasswordActionDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called to open or close it. */
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Turn off two-step verification?". */
  title: string;
  /** What will happen. */
  description: ReactNode;
  /** Text of the confirming button. */
  confirmLabel: string;
  /** Style of the confirming button. Defaults to `primary`. */
  confirmVariant?: ButtonProps['variant'];
  /** Whether to ask for the password. */
  hasPassword: boolean;
  /** Runs the change with the password (if any). */
  action: (password: string | undefined) => Promise<ActionOutcome>;
  /** Called after the change worked. */
  onDone: () => void;
}

/** Props for {@link PasswordActionForm}: the dialog's, without its open state and texts. */
type PasswordActionFormProps = Pick<
  PasswordActionDialogProps,
  'confirmLabel' | 'confirmVariant' | 'hasPassword' | 'action' | 'onDone'
> & {
  /** Closes the dialog. */
  onCancel: () => void;
};

/**
 * The dialog's form: the password field (for users who have one), any error
 * (such as a wrong password), Cancel and the confirm button. It's the
 * dialog's content, which Radix unmounts when the dialog closes, so each
 * opening starts with an empty field and no error.
 *
 * @param props - Form props.
 * @param props.confirmLabel - Confirm button text.
 * @param props.confirmVariant - Confirm button style.
 * @param props.hasPassword - Ask for the password.
 * @param props.action - The change to run.
 * @param props.onDone - Called after it worked.
 * @param props.onCancel - Closes the dialog.
 * @returns The form.
 */
function PasswordActionForm({
  confirmLabel,
  confirmVariant = 'primary',
  hasPassword,
  action,
  onDone,
  onCancel,
}: PasswordActionFormProps) {
  const tCommon = useTranslations('common');
  const refusalText = useRefusalText();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Runs the change.
   *
   * @param event - The form submit event.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await action(hasPassword ? password : undefined);
    setPending(false);
    if (result.error) {
      const text = refusalText(result.error);
      if (text !== null) {
        setError(text);
      }
      return;
    }
    onDone();
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Alert tone="error" focusOnShow alsoToast>
        {error}
      </Alert>
      {hasPassword && <PasswordField value={password} onChange={setPassword} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button type="submit" variant={confirmVariant} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * A short form in a dialog: the password field (for users who have one) and a
 * confirm button. Errors such as a wrong password are shown in the dialog,
 * and the form starts afresh each time it opens ({@link PasswordActionForm}).
 *
 * @param props - Dialog props.
 * @param props.open - Open state.
 * @param props.onOpenChange - Open state handler.
 * @param props.title - Title.
 * @param props.description - Explanation.
 * @param props.confirmLabel - Confirm button text.
 * @param props.confirmVariant - Confirm button style.
 * @param props.hasPassword - Ask for the password.
 * @param props.action - The change to run.
 * @param props.onDone - Called after it worked.
 * @returns The dialog.
 */
export default function PasswordActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  hasPassword,
  action,
  onDone,
}: PasswordActionDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <PasswordActionForm
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        hasPassword={hasPassword}
        action={action}
        onDone={onDone}
        onCancel={() => onOpenChange(false)}
      />
    </Modal>
  );
}
