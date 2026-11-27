/**
 * @file Server actions for the webhooks card of Settings' Integrations tab
 * and a webhook's page: adding, changing, renewing the secret, turning off
 * and on and removing a webhook, sending it a test and sending a delivery
 * again. A change that needs the staff Admin's recent second step sends them
 * to confirm it first, and back to the card (`confirmFirstIfNeeded`).
 */
'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field, { fieldValues } from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import {
  addWebhook,
  removeWebhook,
  renewWebhookSecret,
  resendDelivery,
  sendTestEvent,
  setWebhookOn,
  updateWebhook,
  type WebhookInput,
} from '@/server/webhooks';

import confirmFirstIfNeeded from '../../../_people/confirm-grant';

/** The list's card, where the step-up page comes back to without a `returnTo`. */
const WEBHOOKS_CARD = '/admin/settings/integrations#webhooks';

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
    const { secret } = await confirmFirstIfNeeded(formData, WEBHOOKS_CARD, () =>
      addWebhook(appContext, actor, webhookInput(formData)),
    );
    refresh();
    const t = await getTranslations('admin.settings.webhooks.add');
    return { ok: true, message: t('added'), data: { secret } };
  });
}

/**
 * A webhook's page, where its step-up comes back to without a `returnTo`.
 *
 * @param formData - Field `webhook`.
 * @returns The page's path.
 */
function webhookPage(formData: FormData): string {
  return `/admin/settings/webhooks/${encodeURIComponent(field(formData, 'webhook'))}`;
}

/**
 * Changes a webhook; an empty address keeps the saved one.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `webhook`, and the webhook's fields.
 * @returns A confirmation, or why it failed.
 */
export async function updateWebhookAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { changed } = await confirmFirstIfNeeded(formData, webhookPage(formData), () =>
      updateWebhook(appContext, actor, {
        ...webhookInput(formData),
        webhook: field(formData, 'webhook'),
      }),
    );
    refresh();
    const t = await getTranslations('admin.settings.webhooks.edit');
    return { ok: true, message: changed ? t('saved') : t('unchanged') };
  });
}

/**
 * Renews a webhook's signing secret.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `webhook`.
 * @returns The new secret (shown once), or why it failed.
 */
export async function renewWebhookSecretAction(
  _previous: ActionResult<{ secret: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ secret: string }>> {
  return runAction(async () => {
    const actor = await getActor();
    const { secret } = await confirmFirstIfNeeded(formData, webhookPage(formData), () =>
      renewWebhookSecret(appContext, actor, { webhook: field(formData, 'webhook') }),
    );
    refresh();
    const t = await getTranslations('admin.settings.webhooks.renew');
    return { ok: true, message: t('renewed'), data: { secret } };
  });
}

/**
 * Turns a webhook off or on.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `webhook` and `on` (`true` or `false`).
 * @returns A confirmation, or why it failed.
 */
export async function setWebhookOnAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const on = field(formData, 'on') === 'true';
    await confirmFirstIfNeeded(formData, webhookPage(formData), () =>
      setWebhookOn(appContext, actor, { webhook: field(formData, 'webhook'), on }),
    );
    refresh();
    const t = await getTranslations('admin.settings.webhooks.onOff');
    return { ok: true, message: on ? t('turnedOn') : t('turnedOff') };
  });
}

/**
 * Removes a webhook, then goes back to the list, which says so.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `webhook`.
 * @returns Why it failed; on success it goes to the list.
 */
export async function removeWebhookAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await getActor();
    await removeWebhook(appContext, actor, { webhook: field(formData, 'webhook') });
    return { ok: true };
  });
  if (result.ok) {
    refresh();
    redirect('/admin/settings/integrations?removed=1#webhooks');
  }
  return result;
}

/**
 * Sends a test to a webhook while the Admin waits, and says how it went: a
 * test that wasn't delivered is shown as an error, with why.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `webhook`.
 * @returns How it went.
 */
export async function sendTestEventAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const result = await sendTestEvent(appContext, actor, { webhook: field(formData, 'webhook') });
    refresh();
    const t = await getTranslations('admin.settings.webhooks');
    if (result.delivered) {
      return { ok: true, message: t('test.delivered', { status: result.status ?? 0 }) };
    }
    return {
      ok: false,
      message: t('test.failed', {
        reason: t(`outcome.${result.error ?? 'connection'}`, { status: result.status ?? 0 }),
      }),
    };
  });
}

/**
 * Sends a delivery again, at the next tick.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `webhook` and `delivery`.
 * @returns A confirmation, or why it failed.
 */
export async function resendDeliveryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await resendDelivery(appContext, actor, {
      webhook: field(formData, 'webhook'),
      delivery: field(formData, 'delivery'),
    });
    refresh();
    const t = await getTranslations('admin.settings.webhooks.deliveries');
    return { ok: true, message: t('resent') };
  });
}
