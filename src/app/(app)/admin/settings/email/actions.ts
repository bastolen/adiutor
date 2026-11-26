/**
 * @file Server action of the Email tab of Settings: saving the mail server,
 * once it's tried, which needs a recent confirmation first (to the step-up
 * page and back to the card).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { saveSmtpSettings } from '@/server/smtp';

import confirmFirstIfNeeded from '../../../_people/confirm-grant';

/**
 * The mail server's fields as the form sent them. The sender's address is
 * `null` when the form didn't send it (`EMAIL_FROM` chooses the sender), so
 * the service can tell that from an empty one.
 *
 * @param formData - The form.
 * @returns The fields, as text.
 */
function mailServerFields(formData: FormData) {
  return {
    host: field(formData, 'host'),
    port: field(formData, 'port'),
    security: field(formData, 'security'),
    username: field(formData, 'username'),
    password: field(formData, 'password'),
    fromName: field(formData, 'fromName'),
    fromAddress: formData.has('fromAddress') ? field(formData, 'fromAddress') : null,
  };
}

/**
 * Tries the mail server (a test email to the staff Admin saving it) and saves
 * it. Without a recent confirmation, the staff Admin is sent to confirm first
 * and back to the card.
 *
 * @param _previous - The previous result (unused).
 * @param formData - The mail server's fields.
 * @returns A confirmation, or why it failed.
 */
export default async function saveMailServerAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await confirmFirstIfNeeded(formData, '/admin/settings/email#mail-server', () =>
      saveSmtpSettings(appContext, actor, mailServerFields(formData)),
    );
    refresh();
    const t = await getTranslations('admin.settings.email.server');
    return { ok: true, message: t('saved') };
  });
}
