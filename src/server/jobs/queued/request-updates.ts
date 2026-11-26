/**
 * @file Sends the queued news about requests (`requestUpdateJob`): one
 * email for everything queued for one person about one request, in their
 * language, or one delivery for everything queued for one webhook about one
 * request (`deliverWebhookNews` in `src/server/webhooks`, decision 0046).
 * What the email may show is read when it's sent (`readRequestUpdate`), so
 * someone who is no longer on the request or can no longer read it gets
 * nothing, and their jobs are skipped. Its links sign
 * the reader in and open the request (`createRequestLink`, decision 0036) at
 * the first news it tells of (`RequestUpdate.anchor`, which the browser keeps
 * through the link's redirect, and the link names the entry, which it passes
 * on in the query),
 * and an email that tells someone at the company of a solution they may
 * answer gets its own Approve and Deny links (`createAnswerLink`, decision
 * 0033), all made as it's sent. A mail problem throws, so the batch is tried
 * again later with whatever was queued for it meanwhile (and new links: the
 * old ones were never sent, and expire).
 */
import { requestUpdateEmail } from '@/emails/request-update';
import { answerLinkPath, entryIdOf } from '@/lib/requests';
import { requestLinkPath } from '@/lib/sign-in/request-link';

import { createRequestLink } from '../../auth/request-links';
import { isWebhookNews, REQUEST_UPDATES_GROUP, requestUpdateJob } from '../../queue';
import recipientLocale from '../../recipient-locale';
import { createAnswerLink, readRequestUpdate } from '../../requests';
import { deliverWebhookNews } from '../../webhooks';
import { batchedJobRunner, defineJobBatch } from '../define';

/** The kind of the queued news about requests, for the runner: its batch runs its jobs. */
export const requestUpdateRunner = batchedJobRunner(requestUpdateJob);

/** The batch of the emails about requests: the jobs of one person and request make one email. */
export const requestUpdatesBatch = defineJobBatch({
  group: REQUEST_UPDATES_GROUP,
  /**
   * Sends one email for the jobs of one person about one request.
   *
   * @param ctx - Service context.
   * @param jobs - The jobs of one batch key.
   * @returns The jobs that were skipped: all of them when the person gets no email.
   */
  run: async (ctx, jobs) => {
    const payloads = jobs.flatMap((job) => {
      const payload = requestUpdateJob.read(job);
      return payload ? [{ jobId: job.id, payload }] : [];
    });
    // A webhook's news goes out as one delivery (decision 0046); a person's as one email.
    const forWebhook = payloads.flatMap(({ jobId, payload }) =>
      isWebhookNews(payload) ? [{ jobId, ...payload }] : [],
    );
    if (forWebhook.length > 0) {
      const { skipped } = await deliverWebhookNews(ctx, forWebhook);
      const others = payloads.filter(({ payload }) => !isWebhookNews(payload));
      return { skipped: [...skipped, ...others.map(({ jobId }) => jobId)] };
    }
    const news = payloads.flatMap(({ jobId, payload }) =>
      isWebhookNews(payload) ? [] : [{ jobId, ...payload }],
    );
    const [first] = news;
    const update = first
      ? await readRequestUpdate(
          ctx,
          { requestId: first.requestId, userId: first.userId },
          // One key is one request and one person: news about another would be a mistake.
          news.filter(
            ({ requestId, userId }) => requestId === first.requestId && userId === first.userId,
          ),
        )
      : null;
    if (first === undefined || update === null) {
      return { skipped: jobs.map(({ id }) => id) };
    }
    const linkToken = await createRequestLink(ctx.db, {
      userId: first.userId,
      requestId: first.requestId,
    });
    const answerToken = update.answerable
      ? await createAnswerLink(ctx.db, {
          requestId: first.requestId,
          userId: first.userId,
          proposalEntryId: update.answerable.proposalEntryId,
        })
      : null;
    await ctx.sendEmail(
      await requestUpdateEmail(update.recipient.email, {
        appUrl: ctx.baseUrl,
        locale: await recipientLocale(ctx, update.recipient.locale),
        reference: update.request.reference,
        title: update.request.title,
        companyName: update.request.companyName,
        // The reader's own link that signs them in, opening the request at the first news the email
        // tells of: the browser keeps the anchor through the link's redirect.
        url: `${ctx.baseUrl}${requestLinkPath(linkToken, { entry: entryIdOf(update.anchor) })}${
          update.anchor ? `#${update.anchor}` : ''
        }`,
        role: update.role,
        audience: update.audience,
        items: update.items,
        ...(answerToken !== null && {
          answerLinks: {
            approve: `${ctx.baseUrl}${answerLinkPath(answerToken, 'approve')}`,
            deny: `${ctx.baseUrl}${answerLinkPath(answerToken, 'deny')}`,
          },
        }),
      }),
    );
    return { skipped: update.skipped };
  },
});
