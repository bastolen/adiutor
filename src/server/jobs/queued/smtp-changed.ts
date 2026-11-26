/**
 * @file Sends one staff Admin the "the mail server changed" email
 * (`smtp-changed`) when it couldn't go out straight away through the mail
 * server in use before the change (`src/server/smtp/notice.ts`). It's read
 * now: nothing for someone who is no longer an active staff Admin.
 */
import { smtpChangedJob } from '../../queue';
import { smtpChangedEmailFor } from '../../smtp';
import { handleQueuedJob } from '../define';

export default handleQueuedJob(smtpChangedJob, async (ctx, job) => {
  const email = await smtpChangedEmailFor(ctx, job.payload);
  if (!email) {
    return 'skipped';
  }
  await ctx.sendEmail(email);
  return 'done';
});
