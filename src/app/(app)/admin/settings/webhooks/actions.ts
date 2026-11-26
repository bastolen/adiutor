/**
 * @file Server actions for the Webhooks tab of Settings: adding a webhook.
 * A change that needs the staff Admin's recent second step sends them to
 * confirm it first, and back to the card (`confirmFirstIfNeeded`).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field, { fieldValues } from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { addWebhook, type WebhookInput } from '@/server/webhooks';

import confirmFirstIfNeeded from '../../../_people/confirm-grant';

/** The tab's address, where the step-up page comes back to without a `returnTo`. */
const WEBHOOKS_PAGE = '/admin/settings/webhooks';

/**
 * The fields of a webhook's form.
 *
 * @param formData - Fields `name`, `url`, `format`, `allTypes`, `types` and `events`.
 * @returns The fields.
 */
function webhookInput(formData: FormData): WebhookInput {
  return {
    name: field(formData, 'name'),
    url: field(formData, 'url'),
    format: field(formData, 'format'),
    events: fieldValues(formData, 'events'),
    allTypes: field(formData, 'allTypes') !== 'false',
    types: fieldValues(formData, 'types'),
  };
}

/**
 * Adds a webhook.
 *
 * @param _previous - The previous result (unused).
 * @param formData - The webhook's fields.
 * @returns Its signing secret (shown once), or why it failed.
 */
export async function addWebhookAction(
  _previous: ActionResult<{ secret: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ secret: string }>> {
  return runAction(async () => {
    const actor = await getActor();
    const { secret } = await confirmFirstIfNeeded(formData, WEBHOOKS_PAGE, () =>
      addWebhook(appContext, actor, webhookInput(formData)),
    );
    refresh();
    const t = await getTranslations('admin.settings.webhooks.add');
    return { ok: true, message: t('added'), data: { secret } };
  });
}
