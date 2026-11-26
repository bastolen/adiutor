/**
 * @file Which webhooks hear of what happens to a request: the one place that
 * decides it, beside `tellPeopleOnRequest` for the people on it
 * (decision 0046). A webhook that's on hears of the events it chose, on the
 * request types it covers; unlike a person, it also hears of whoever made
 * the change. Each piece of news is a `request-update` job for the webhook,
 * queued in the transaction of the change, so it exists exactly when the
 * change was saved; the jobs of one webhook and request in a tick go out as
 * one delivery. The payload holds IDs only: what's sent is read when it's
 * sent (`readWebhookNews`).
 *
 * The webhooks are only read here, never locked: a change to a webhook
 * doesn't hold up a change to a request.
 */
import { inArray, isNull } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { webhook, webhookRequestType } from '@/db/schema';
import { webhookCovers, type WebhookEvent } from '@/lib/webhooks';

import { queueJobs, requestUpdateJob } from '../queue';

/** One piece of news for webhooks: what happened, and the entry it's about. */
export interface WebhookNewsPiece {
  /** What happened. */
  event: WebhookEvent;
  /** The entry of the request's history; `null` for the request being raised. */
  entryId: string | null;
}

/**
 * Queues news about several requests for every webhook that hears of it, in
 * one statement: for a change that touches many requests at once (taking
 * someone off every request they're assigned to).
 *
 * @param tx - The change's transaction.
 * @param requests - Each request, its type (and the type it had) and its news, in order.
 * @returns How many jobs it queued.
 */
export async function tellWebhooksAbout(
  tx: DatabaseTransaction,
  requests: readonly {
    requestId: string;
    typeKey: string;
    previousTypeKey?: string;
    news: readonly WebhookNewsPiece[];
  }[],
): Promise<number> {
  if (requests.every(({ news }) => news.length === 0)) {
    return 0;
  }
  const webhooks = await tx
    .select({ id: webhook.id, events: webhook.events, allTypes: webhook.allTypes })
    .from(webhook)
    .where(isNull(webhook.turnedOffAt));
  if (webhooks.length === 0) {
    return 0;
  }
  const chosen = webhooks.filter(({ allTypes }) => !allTypes).map(({ id }) => id);
  const typeRows =
    chosen.length === 0
      ? []
      : await tx
          .select({
            webhookId: webhookRequestType.webhookId,
            key: webhookRequestType.requestTypeKey,
          })
          .from(webhookRequestType)
          .where(inArray(webhookRequestType.webhookId, chosen));
  const jobs = requests.flatMap(({ requestId, typeKey, previousTypeKey, news }) =>
    webhooks.flatMap((hook) => {
      const choices = {
        events: hook.events,
        allTypes: hook.allTypes,
        types: typeRows.filter(({ webhookId }) => webhookId === hook.id).map(({ key }) => key),
      };
      return news.flatMap(({ event, entryId }) => {
        // A change of type is news for webhooks of the type it had and of the type it got, once.
        const matched = [typeKey, ...(previousTypeKey ? [previousTypeKey] : [])].find((key) =>
          webhookCovers(choices, { event, typeKey: key }),
        );
        return matched === undefined
          ? []
          : [{ requestId, webhookId: hook.id, typeKey: matched, event, entryId }];
      });
    }),
  );
  await queueJobs(tx, requestUpdateJob, jobs);
  return jobs.length;
}

/**
 * Queues news about a request for every webhook that hears of it. Call it in
 * the transaction of the change, after the change itself.
 *
 * @param tx - The change's transaction.
 * @param about - The request: its ID and its type, and for a change of type the type it had.
 * @param about.requestId - The request.
 * @param about.typeKey - Its type, as it is after the change.
 * @param about.previousTypeKey - The type it had, when the change gave it another.
 * @param news - What happened, in order.
 * @returns How many jobs it queued.
 */
export async function tellWebhooks(
  tx: DatabaseTransaction,
  about: { requestId: string; typeKey: string; previousTypeKey?: string },
  news: readonly WebhookNewsPiece[],
): Promise<number> {
  return tellWebhooksAbout(tx, [{ ...about, news }]);
}
