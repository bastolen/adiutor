/**
 * @file The dialog that adds a webhook, on Settings' Integrations tab, and
 * then shows its signing secret once. Its text comes from
 * `admin.settings.webhooks`, which the page passes through `ClientMessages`.
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

import { addWebhookAction } from './actions';
import WebhookFields, { type WebhookTypeChoice } from './webhook-fields';
import WebhookSecret from './webhook-secret';

/**
 * The form in the dialog, then the secret once it's added.
 *
 * @param props - Component props.
 * @param props.types - The request types to choose from.
 * @param props.onAdded - Called once the webhook is added.
 * @param props.onClose - Closes the dialog.
 */
function AddWebhookForm({
  types,
  onAdded,
  onClose,
}: {
  types: readonly WebhookTypeChoice[];
  onAdded: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin.settings.webhooks');
  const tActions = useTranslations('common.actions');
  // Through the shared hook's `onSubmit`, so a refused submit keeps what was typed.
  const [result, formAction, pending, onSubmit] = useTransientActionState(addWebhookAction, null);
  const secret = result?.ok ? result.data?.secret : undefined;
  useEffect(() => {
    if (secret) {
      onAdded();
    }
  }, [secret, onAdded]);
  if (secret) {
    return <WebhookSecret done={t('add.added')} secret={secret} onClose={onClose} />;
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      <ResultAlert result={result} errorsOnly />
      <WebhookFields types={types} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {tActions('cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {t('add.confirm')}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Add webhook", which sends the user to confirm it's them first when they
 * haven't lately, then opens a dialog with the webhook's fields. Once it's
 * added, the dialog shows its signing secret, once; closing it then, however
 * it's closed, toasts the success (a toast while the dialog is open would
 * take its Escape). A refusal stays in the dialog, with what was typed.
 *
 * @param props - Component props.
 * @param props.types - The request types to choose from, in order.
 */
export default function AddWebhookDialog({ types }: { types: readonly WebhookTypeChoice[] }) {
  const t = useTranslations('admin.settings.webhooks');
  const { askToConfirm } = useRecentConfirmation();
  const showToast = useToast();
  const [open, setOpen] = useTransientState(false);
  const [added, setAdded] = useTransientState(false);
  /**
   * Opens or closes the dialog; closing it once a webhook was added toasts that.
   *
   * @param next - Whether it's open.
   */
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next && added) {
      showToast?.(t('add.added'));
      setAdded(false);
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
        {t('add.button')}
      </Button>
      <Modal
        open={open}
        onOpenChange={openChange}
        title={t('add.title')}
        description={t('add.description')}
      >
        {/* Closing unmounts the form, so each opening starts afresh. */}
        <AddWebhookForm
          types={types}
          onAdded={() => setAdded(true)}
          onClose={() => openChange(false)}
        />
      </Modal>
    </>
  );
}
