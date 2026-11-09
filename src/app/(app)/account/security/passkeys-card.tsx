/**
 * @file The passkeys card on the Security page.
 */
'use client';

import { KeyRound, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { type FormEvent, useId, useRef, useState } from 'react';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import restoreFocusIfLost from '@/components/ui/focus-fallback';
import IconRow from '@/components/ui/icon-row';
import Modal from '@/components/ui/modal';
import TextField from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { useTransientState } from '@/components/ui/use-transient-state';
import formatDate from '@/lib/format';
import { PASSKEY_NAME_MAX_LENGTH } from '@/lib/input-rules';
import getAuthErrorMessage, { authErrorMessage } from '@/lib/sign-in/auth-error-messages';
import loadAuthClient from '@/lib/sign-in/load-auth-client';
import type { PasskeySummary } from '@/server/auth/security';

/** The card's anchor, which the step-up page comes back to (it renders the card itself). */
const SECTION = 'passkeys';

/**
 * Props for {@link PasskeysCard}.
 */
interface PasskeysCardProps {
  /** The user's passkeys. */
  passkeys: PasskeySummary[];
  /** Why the only passkey can't be removed, or `null` when it can. */
  removeLastBlockedReason: string | null;
}

/**
 * The name to show for a passkey.
 *
 * @param passkey - The passkey.
 * @returns Its name, or "Passkey".
 */
function passkeyName(passkey: PasskeySummary): string {
  return passkey.name?.trim() || 'Passkey';
}

/**
 * A dialog with a name field, used to add and to rename a passkey. The field
 * stops at the longest name the auth guards accept (`passkeyNameSchema`);
 * a name they refuse anyway shows their message.
 *
 * @param props - Dialog props.
 * @param props.open - Open state.
 * @param props.onOpenChange - Open state handler.
 * @param props.title - Dialog title.
 * @param props.description - Explanation.
 * @param props.initialName - The name to start with.
 * @param props.submitLabel - Submit button text.
 * @param props.onSubmit - Saves the name; resolves to an error code, or `null` when it worked.
 * @returns The dialog.
 */
function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialName: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useTransientState<string | null>(null);

  /**
   * Saves the name.
   *
   * @param event - The form submit event.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const errorCode = await onSubmit(name.trim() || 'Passkey');
    setPending(false);
    if (errorCode) {
      setError(getAuthErrorMessage(errorCode));
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Alert tone="error" focusOnShow alsoToast>
          {error}
        </Alert>
        <TextField
          label="Name"
          name="name"
          autoComplete="off"
          description="So you can tell your passkeys apart, e.g. “Work laptop” or “iPhone”."
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={PASSKEY_NAME_MAX_LENGTH}
        />
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </form>
    </Modal>
  );
}

/**
 * Lists the user's passkeys and lets them add, rename and remove them.
 * Adding asks the browser to create a passkey with the device's fingerprint,
 * face or PIN. Adding and removing need a recent confirmation with the second
 * step (see `useRecentConfirmation`); renaming only a confirmed session.
 *
 * @param props - Card props.
 * @param props.passkeys - The passkeys.
 * @param props.removeLastBlockedReason - Why the only passkey can't be removed, if so.
 * @returns The card.
 */
export default function PasskeysCard({ passkeys, removeLastBlockedReason }: PasskeysCardProps) {
  const locale = useLocale();
  const router = useRouter();
  const { askToConfirm, askToConfirmOnRefusal } = useRecentConfirmation(SECTION);
  const [adding, setAdding] = useTransientState(false);
  const [renaming, setRenaming] = useTransientState<PasskeySummary | null>(null);
  const [status, setStatus] = useTransientState<string | null>(null);
  const [error, setError] = useTransientState<string | null>(null);
  // The passkey being removed, so its Remove button shows it's busy.
  const [removing, setRemoving] = useTransientState<string | null>(null);
  const removeBlocked = passkeys.length === 1 ? removeLastBlockedReason : null;
  const removeBlockedId = useId();
  const showToast = useToast();
  // The list of passkeys, so focus can find the card's heading when a removed row takes it away.
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * Reports a success: a toast in the signed-in app, otherwise a message in the card.
   *
   * @param message - What happened.
   */
  const report = (message: string) => {
    if (showToast) {
      showToast(message);
    } else {
      setStatus(message);
    }
  };

  /**
   * Removes a passkey.
   *
   * @param passkey - The passkey to remove.
   */
  const remove = async (passkey: PasskeySummary) => {
    setError(null);
    setRemoving(passkey.id);
    const authClient = await loadAuthClient();
    const result = await authClient.passkey.deletePasskey({ id: passkey.id });
    if (result.error) {
      setRemoving(null);
      if (!askToConfirmOnRefusal(result.error.code)) {
        setError(authErrorMessage(result.error));
      }
      return;
    }
    report(`${passkeyName(passkey)} was removed.`);
    // The row goes with the refresh: focus moves to the card's heading instead of <body>.
    restoreFocusIfLost(listRef.current);
    router.refresh();
  };

  return (
    <Card
      id={SECTION}
      title="Passkeys"
      description="Sign in with your fingerprint, face or device PIN instead of a password. A passkey can't be phished and counts as two-step protection on its own."
      actions={
        <Button
          size="sm"
          onClick={() => {
            if (!askToConfirm()) {
              setAdding(true);
            }
          }}
        >
          <Plus aria-hidden="true" />
          Add passkey
        </Button>
      }
      flush
    >
      <div className="flex flex-col gap-2 px-6 empty:hidden">
        <Alert tone="success">{status}</Alert>
        <Alert tone="error" focusOnShow alsoToast>
          {error}
        </Alert>
      </div>
      {passkeys.length === 0 ? (
        <p className="border-t border-border px-6 py-4 text-sm text-muted-foreground">
          No passkeys yet.
        </p>
      ) : (
        <ul ref={listRef} className="divide-y divide-border border-t border-border">
          {passkeys.map((passkey) => (
            <IconRow
              key={passkey.id}
              icon={<KeyRound className="size-4" />}
              iconClassName="text-muted-foreground"
              title={passkeyName(passkey)}
              truncateTitle
              control={
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Rename ${passkeyName(passkey)}`}
                    onClick={() => setRenaming(passkey)}
                  >
                    Rename
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="danger-subtle"
                        size="sm"
                        aria-label={`Remove ${passkeyName(passkey)}`}
                        disabled={removeBlocked !== null}
                        loading={removing === passkey.id}
                        aria-describedby={removeBlocked ? removeBlockedId : undefined}
                        onClick={(event) => {
                          if (askToConfirm()) {
                            event.preventDefault();
                          }
                        }}
                      >
                        Remove
                      </Button>
                    }
                    title={`Remove ${passkeyName(passkey)}?`}
                    description="You won't be able to sign in with this passkey anymore. Also remove it from your device or password manager."
                    confirmLabel="Remove passkey"
                    onConfirm={() => remove(passkey)}
                  />
                </div>
              }
            >
              {passkey.backedUp ? 'Synced across your devices' : 'On this device only'}
              {passkey.createdAt && ` · Added ${formatDate(passkey.createdAt, locale)}`}
            </IconRow>
          ))}
        </ul>
      )}
      {removeBlocked && (
        <p
          id={removeBlockedId}
          className="border-t border-border px-6 py-3 text-xs text-muted-foreground"
        >
          {removeBlocked}
        </p>
      )}

      <NameDialog
        key={adding ? 'adding' : 'idle'}
        open={adding}
        onOpenChange={setAdding}
        title="Add a passkey"
        description="Give it a name, then follow your browser's prompt."
        initialName="Passkey"
        submitLabel="Create passkey"
        onSubmit={async (name) => {
          const authClient = await loadAuthClient();
          const result = await authClient.passkey.addPasskey({ name });
          if (result?.error) {
            const code = 'code' in result.error ? result.error.code : 'unknown';
            if (!askToConfirmOnRefusal(code)) {
              return code ?? 'unknown';
            }
            setAdding(false);
            return null;
          }
          setAdding(false);
          report(`${name} was added. You can now sign in with it.`);
          router.refresh();
          return null;
        }}
      />
      <NameDialog
        key={renaming?.id ?? 'none'}
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename passkey"
        description="Only you see this name."
        initialName={renaming ? passkeyName(renaming) : ''}
        submitLabel="Save name"
        onSubmit={async (name) => {
          if (!renaming) {
            return null;
          }
          const authClient = await loadAuthClient();
          const result = await authClient.passkey.updatePasskey({ id: renaming.id, name });
          if (result.error) {
            if (!askToConfirmOnRefusal(result.error.code)) {
              return result.error.code ?? 'unknown';
            }
            setRenaming(null);
            return null;
          }
          setRenaming(null);
          router.refresh();
          return null;
        }}
      />
    </Card>
  );
}
