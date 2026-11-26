/**
 * @file The dialog that changes a webhook, on its page. Its text comes from
 * `admin.settings.webhooks`, which the page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';

import { updateWebhookAction } from '../actions';
import WebhookFields, { type EditedWebhook, type WebhookTypeChoice } from '../webhook-fields';

/** Props for {@link EditWebhookDialog}. */
interface EditWebhookDialogProps {
  /** The webhook's ID. */
  id: string;
  /** The webhook as it is. */
  webhook: EditedWebhook;
  /** The request types to choose from, in order. */
  types: readonly WebhookTypeChoice[];
}

/**
 * "Edit", which sends the user to confirm it's them first when they haven't
 * lately (any change can send more, or send it elsewhere), then opens a
 * dialog with the webhook's fields as they are; its address is empty, which
 * keeps the saved one. A success is a toast; a refusal stays in the dialog.
 */
export default function EditWebhookDialog({ id, webhook, types }: EditWebhookDialogProps) {
  const t = useTranslations('admin.settings.webhooks.edit');
  return (
    <ActionDialog
      action={updateWebhookAction}
      fields={{ webhook: id }}
      triggerLabel={t('button')}
      title={t('title', { name: webhook.name })}
      description={t('description')}
      confirmLabel={t('confirm')}
      tone="primary"
      confirmFirst
    >
      <WebhookFields types={types} webhook={webhook} />
    </ActionDialog>
  );
}
