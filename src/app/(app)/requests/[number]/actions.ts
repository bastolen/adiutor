/**
 * @file Server actions for a request's page: replying, adding an internal
 * note, changing the status, changing the details, changing who it's
 * assigned to and editing a text. The services check who may do what; these
 * read the form, refresh the page and word the confirmation in the request's
 * language (`requests.reply`, `requests.note`, `requests.saved`).
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
  addNote,
  changeAssignees,
  changeRequestStatus,
  editReply,
  editRequestDescription,
  replyToRequest,
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
 * Adds an internal note to a request, which only the staff read.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number) and `body`.
 * @returns A confirmation, or why it failed.
 */
export async function noteAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await addNote(appContext, actor, {
      request: field(formData, 'request'),
      body: field(formData, 'body'),
    });
    refresh();
    const t = await getTranslations('requests.note');
    return { ok: true, message: t('added') };
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
 * Edits a request's description, or a reply (`entry`). The form sends how
 * many times the text had been edited when it opened (`edits`), so an edit
 * someone made meanwhile isn't overwritten: then nothing is saved, and the
 * page is refreshed all the same, so it shows the text as it is.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number), `entry` (a reply's ID; empty for the
 *   description), `text` and `edits`.
 * @returns A confirmation, or why it failed.
 */
export async function editTextAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const entry = field(formData, 'entry');
    const counted = Number(field(formData, 'edits'));
    const input = {
      request: field(formData, 'request'),
      text: field(formData, 'text'),
      // A count that isn't one can't match: the edit is refused as made meanwhile.
      edits: Number.isSafeInteger(counted) ? counted : -1,
    };
    const { changed } = await (
      entry
        ? editReply(appContext, actor, { ...input, entry })
        : editRequestDescription(appContext, actor, input)
    ).catch((error: unknown) => {
      if (error instanceof ServiceError && error.code === 'conflict') {
        refresh();
      }
      throw error;
    });
    refresh();
    const t = await getTranslations('requests.saved');
    return { ok: true, message: t('text', { changed: changed ? 'yes' : 'no' }) };
  });
}
