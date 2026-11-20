/**
 * @file Server actions for a request's page: replying, changing the status,
 * changing the details, changing who it's assigned to, and subscribing to
 * it. The services check who may do what; these read the form, refresh the
 * page and word the confirmation in the request's language
 * (`requests.reply`, `requests.saved`).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field, { fieldValues } from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import {
  changeAssignees,
  changeRequestStatus,
  changeSubscribers,
  replyToRequest,
  subscribe,
  unsubscribe,
  updateRequestDetails,
} from '@/server/requests';

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

/**
 * Changes who a request is assigned to: the people to add (`add`, as
 * "Assign to me" sends it), and what the dialog's checkboxes changed. The
 * dialog sends who's ticked (`assignee`) and who was assigned when it
 * opened (`was_assignee`), so only what its editor changed is saved: someone
 * a colleague assigned or removed meanwhile, whom the editor left alone,
 * stays as the colleague left them.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `request` (its number), and any of `add`, `assignee` and
 *   `was_assignee`, each a user ID and sent once per person.
 * @returns A confirmation, or why it failed.
 */
export async function changeAssigneesAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const ticked = fieldValues(formData, 'assignee');
    const was = fieldValues(formData, 'was_assignee');
    const { added, removed } = await changeAssignees(appContext, actor, {
      request: field(formData, 'request'),
      add: [...fieldValues(formData, 'add'), ...ticked.filter((id) => !was.includes(id))],
      remove: was.filter((id) => !ticked.includes(id)),
    });
    refresh();
    const t = await getTranslations('requests.saved');
    return { ok: true, message: t('assignees', { changed: added + removed }) };
  });
}

/**
 * Subscribes the actor to a request, or unsubscribes them: the one button
 * under a request's subscribers sends `subscribe` with `yes` to follow it,
 * and with anything else to stop.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number) and `subscribe`.
 * @returns A confirmation that says which it was, or why it failed.
 */
export async function changeSubscriptionAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const input = { request: field(formData, 'request') };
    const subscribing = field(formData, 'subscribe') === 'yes';
    if (subscribing) {
      await subscribe(appContext, actor, input);
    } else {
      await unsubscribe(appContext, actor, input);
    }
    refresh();
    const t = await getTranslations('requests.saved');
    return {
      ok: true,
      message: t('subscription', { change: subscribing ? 'subscribed' : 'unsubscribed' }),
    };
  });
}

/**
 * Changes who is subscribed to a request, from the dialog's checkboxes. It
 * sends who's ticked (`subscriber`) and who was subscribed when it opened
 * (`was_subscriber`), so only what its editor changed is saved: someone who
 * subscribed or unsubscribed meanwhile, whom the editor left alone, stays as
 * they are.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Field `request` (its number), and `subscriber` and `was_subscriber`, each
 *   a user ID and sent once per person.
 * @returns A confirmation, or why it failed.
 */
export async function changeSubscribersAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const ticked = fieldValues(formData, 'subscriber');
    const was = fieldValues(formData, 'was_subscriber');
    const { added, removed } = await changeSubscribers(appContext, actor, {
      request: field(formData, 'request'),
      add: ticked.filter((id) => !was.includes(id)),
      remove: was.filter((id) => !ticked.includes(id)),
    });
    refresh();
    const t = await getTranslations('requests.saved');
    return { ok: true, message: t('subscribers', { changed: added + removed }) };
  });
}
