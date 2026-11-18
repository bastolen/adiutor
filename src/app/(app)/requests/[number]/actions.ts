/**
 * @file Server actions for a request's page: replying, changing the status
 * and changing the details. The services check who may do what; these read
 * the form, refresh the page and word the confirmation in the request's
 * language (`requests.reply`, `requests.saved`).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { changeRequestStatus, replyToRequest, updateRequestDetails } from '@/server/requests';

/**
 * Replies to a request. The staff's second button sends `status` with it, to
 * wait for the company's answer.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number), `body` and, optionally, `status`.
 * @returns A confirmation, or why it failed.
 */
export async function replyAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await replyToRequest(appContext, actor, {
      request: field(formData, 'request'),
      body: field(formData, 'body'),
      status: field(formData, 'status'),
    });
    refresh();
    const t = await getTranslations('requests.reply');
    return { ok: true, message: t('sent') };
  });
}

/**
 * Changes a request's status: what the staff pick, or done, cancelled or
 * open again from the company's buttons.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number) and `status`.
 * @returns A confirmation that says what happened, or why it failed.
 */
export async function changeStatusAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { reopened, status } = await changeRequestStatus(appContext, actor, {
      request: field(formData, 'request'),
      status: field(formData, 'status'),
    });
    refresh();
    const t = await getTranslations('requests.saved');
    return { ok: true, message: t('status', { change: reopened ? 'reopened' : status }) };
  });
}

/**
 * Changes a request's title, type and priority: the ones the form changed
 * from what it started with (`was_title`, `was_type`, `was_priority`), so a
 * detail its editor left alone keeps what a colleague gave it meanwhile.
 *
 * When a colleague changed the same detail meanwhile, nothing is saved and
 * the page is refreshed all the same: it then shows the request as it is,
 * and the dialog starts from that the next time it's opened, instead of
 * running into the same refusal again.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number), `title`, `type` and `priority`, and the
 *   values the form started from: `was_title`, `was_type` and `was_priority`.
 * @returns A confirmation, or why it failed.
 */
export async function updateDetailsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { changed } = await updateRequestDetails(appContext, actor, {
      request: field(formData, 'request'),
      title: field(formData, 'title'),
      type: field(formData, 'type'),
      priority: field(formData, 'priority'),
      was: {
        title: field(formData, 'was_title'),
        type: field(formData, 'was_type'),
        priority: field(formData, 'was_priority'),
      },
    }).catch((error: unknown) => {
      if (error instanceof ServiceError && error.code === 'conflict') {
        refresh();
      }
      throw error;
    });
    refresh();
    const t = await getTranslations('requests.saved');
    return { ok: true, message: t('details', { changed }) };
  });
}
