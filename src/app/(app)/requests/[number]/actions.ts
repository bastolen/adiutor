/**
 * @file Server actions for a request's page: replying, adding an internal
 * note, changing the status, changing the details, changing who it's
 * assigned to, editing a text, subscribing to it, and saving how the reader
 * reads its activity. The services check who may do what; these read the
 * form, refresh the page and word the confirmation in the request's language
 * (`requests.reply`, `requests.note`, `requests.saved`).
 */
'use server';

import { refresh } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import type { ActionResult } from '@/lib/action-result';
import field, { fieldValues } from '@/lib/form-data';
import runAction from '@/server/action-result';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import {
  addNote,
  answerSolution,
  changeAssignees,
  changeRequestStatus,
  changeSubscribers,
  editReply,
  editRequestDescription,
  replyToRequest,
  setActivityView,
  subscribe,
  unsubscribe,
  updateRequestDetails,
} from '@/server/requests';

import refreshOnConflict from '../../_requests/refresh-on-conflict';

/**
 * Replies to a request. The staff's second button sends `status` with it, to
 * wait for the company's answer.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number), `body`, optionally `status`, and an
 *   `attachment` for each file sent with it.
 * @returns A confirmation, or why it failed.
 */
export async function replyAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const asked = field(formData, 'status');
    await replyToRequest(appContext, actor, {
      request: field(formData, 'request'),
      body: field(formData, 'body'),
      status: asked,
      attachments: fieldValues(formData, 'attachment'),
    });
    refresh();
    const t = await getTranslations('requests.reply');
    return { ok: true, message: asked === 'proposed' ? t('solutionSent') : t('sent') };
  });
}

/**
 * Adds an internal note to a request, which only the staff read.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number) and `body`, and an `attachment` for each file
 *   sent with it.
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
      attachments: fieldValues(formData, 'attachment'),
    });
    refresh();
    const t = await getTranslations('requests.note');
    return { ok: true, message: t('added') };
  });
}

/**
 * Approves or denies the solution a request waits on, from the company's
 * buttons; a denial may say what's still wrong.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number), `answer` and, for a denial, `body`.
 * @returns A confirmation, or why it failed.
 */
export async function answerSolutionAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const answer = field(formData, 'answer');
    await answerSolution(appContext, actor, {
      request: field(formData, 'request'),
      answer,
      body: field(formData, 'body'),
    });
    refresh();
    const t = await getTranslations('requests.solution');
    return { ok: true, message: answer === 'approve' ? t('approved') : t('denied') };
  });
}

/**
 * Changes a request's status: what the staff pick, or done, cancelled or
 * open again from the company's buttons. Both send the status the page showed (`from`), so a
 * change that a colleague's came before is refused: the page is refreshed all the same, and then
 * shows the request as it is.
 *
 * @param _previous - The previous result (unused).
 * @param formData - Fields `request` (its number), `status` and `from` (the status the page showed).
 * @returns A confirmation that says what happened, or why it failed.
 */
export async function changeStatusAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    const { reopened, status } = await refreshOnConflict(
      changeRequestStatus(appContext, actor, {
        request: field(formData, 'request'),
        status: field(formData, 'status'),
        from: field(formData, 'from'),
      }),
    );
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
    const { changed } = await refreshOnConflict(
      updateRequestDetails(appContext, actor, {
        request: field(formData, 'request'),
        title: field(formData, 'title'),
        type: field(formData, 'type'),
        priority: field(formData, 'priority'),
        was: {
          title: field(formData, 'was_title'),
          type: field(formData, 'was_type'),
          priority: field(formData, 'was_priority'),
        },
      }),
    );
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
    const { changed } = await refreshOnConflict(
      entry
        ? editReply(appContext, actor, { ...input, entry })
        : editRequestDescription(appContext, actor, input),
    );
    refresh();
    const t = await getTranslations('requests.saved');
    return { ok: true, message: t('text', { changed: changed ? 'yes' : 'no' }) };
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
 *   a person's key (as the dialog got it) and sent once per person.
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

/**
 * Saves how the reader reads a request's activity, from the menus on its
 * page: its order, the groups it shows, or both. It's saved with their
 * account, so it holds on every request. The page is refreshed so the
 * activity shows that way at once; there's no confirmation, since the
 * activity changing is one.
 *
 * @param view - What the menus chose: `order` and/or `groups` (`null` for everything).
 * @param view.order - The order, `oldest` or `newest`.
 * @param view.groups - The groups shown, or `null` for everything.
 * @returns Success without a message, or why it failed.
 */
export async function saveActivityViewAction(view: {
  order?: string;
  groups?: readonly string[] | null;
}): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await getActor();
    await setActivityView(appContext, actor, view);
    refresh();
    return { ok: true };
  });
}
