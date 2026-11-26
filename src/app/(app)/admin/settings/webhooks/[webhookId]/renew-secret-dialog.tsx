/**
 * @file The dialog that renews a webhook's signing secret, on its page, and
 * then shows the new one once. Its text comes from `admin.settings.webhooks`,
 * which the page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { ReturnToField, useRecentConfirmation } from '@/components/auth/recent-confirmation';
import Button from '@/components/ui/button';
import Modal from '@/components/ui/modal';
import ResultAlert from '@/components/ui/result-alert';
import { useToast } from '@/components/ui/toast';
import { useTransientActionState, useTransientState } from '@/components/ui/use-transient-state';

import { renewWebhookSecretAction } from '../actions';
import WebhookSecret from '../webhook-secret';

/**
 * What the dialog asks, then the new secret once it's renewed.
 *
 * @param props - Component props.
 * @param props.id - The webhook's ID.
 * @param props.onRenewed - Called once the secret is renewed.
 * @param props.onClose - Closes the dialog.
 */
function RenewSecretForm({
  id,
  onRenewed,
  onClose,
}: {
  id: string;
  onRenewed: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.settings.webhooks.renew');
  const tActions = useTranslations('common.actions');
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    renewWebhookSecretAction,
    null,
  );
  const secret = result?.ok ? result.data?.secret : undefined;
  useEffect(() => {
    if (secret) {
      onRenewed();
    }
  }, [secret, onRenewed]);
  if (secret) {
    return <WebhookSecret done={t('renewed')} secret={secret} onClose={onClose} />;
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="webhook" value={id} />
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      <ResultAlert result={result} errorsOnly />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {tActions('cancel')}
        </Button>
        <Button type="submit" variant="danger" loading={pending}>
          {t('confirm')}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Renew secret", which sends the user to confirm it's them first when they
 * haven't lately, then asks before the old secret stops working and shows
 * the new one once. Closing the dialog after that, however it's closed,
 * toasts the success (a toast while the dialog is open would take its Escape).
 *
 * @param props - Component props.
 * @param props.id - The webhook's ID.
 */
export default function RenewSecretDialog({ id }: { id: string }) {
  const t = useTranslations('admin.settings.webhooks.renew');
  const { askToConfirm } = useRecentConfirmation();
  const showToast = useToast();
  const [open, setOpen] = useTransientState(false);
  const [renewed, setRenewed] = useTransientState(false);
  /**
   * Opens or closes the dialog; closing it once the secret was renewed toasts that.
   *
   * @param next - Whether it's open.
   */
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next && renewed) {
      showToast?.(t('renewed'));
      setRenewed(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          if (askToConfirm()) {
            return;
          }
          openChange(true);
        }}
      >
        {t('button')}
      </Button>
      <Modal
        open={open}
        onOpenChange={openChange}
        title={t('title')}
        description={t('description')}
      >
        <RenewSecretForm
          id={id}
          onRenewed={() => setRenewed(true)}
          onClose={() => openChange(false)}
        />
      </Modal>
    </>
  );
}
