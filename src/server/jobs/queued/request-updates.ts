/**
 * @file Sends the queued emails about requests (`requestUpdateJob`): one
 * email for everything queued for one person about one request, in their
 * language. What the email may show is read when it's sent
 * (`readRequestUpdate`), so someone who is no longer on the request or can
 * no longer read it gets nothing, and their jobs are skipped. Its links sign
 * the reader in and open the request (`createRequestLink`, decision 0036),
 * with a link made for each email as it's sent. A mail problem throws, so the
 * batch is tried again later with whatever was queued for it meanwhile (and
 * a new link: the old one was never sent, and expires).
 */
import { requestUpdateEmail } from '@/emails/request-update';
import { requestLinkPath } from '@/lib/sign-in/request-link';

import { createRequestLink } from '../../auth/request-links';
import { REQUEST_UPDATES_GROUP, requestUpdateJob } from '../../queue';
import recipientLocale from '../../recipient-locale';
import { readRequestUpdate } from '../../requests';
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
    const news = jobs.flatMap((job) => {
      const payload = requestUpdateJob.read(job);
      return payload ? [{ jobId: job.id, ...payload }] : [];
    });
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
    await ctx.sendEmail(
      await requestUpdateEmail(update.recipient.email, {
        appUrl: ctx.baseUrl,
        locale: await recipientLocale(ctx, update.recipient.locale),
        reference: update.request.reference,
        title: update.request.title,
        companyName: update.request.companyName,
        url: `${ctx.baseUrl}${requestLinkPath(linkToken)}`,
        role: update.role,
        audience: update.audience,
        items: update.items,
      }),
    );
    return { skipped: update.skipped };
  },
});
