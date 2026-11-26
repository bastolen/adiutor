/**
 * @file The queued email that tells a staff Admin the mail server changed
 * (`smtp-changed`), one job per staff Admin, for when it can't go out
 * straight away through the mail server that was in use before
 * (`tellStaffAdminsOfMailServerChange` in `src/server/smtp/`). Its payload
 * holds IDs and the new server's host and port only; names and addresses are
 * read when it's sent.
 */
import { z } from 'zod';

import { SMTP_FIELD_MAX_LENGTH } from '@/lib/smtp';

import { defineQueuedKind } from './define';

/** The "the mail server changed" email to one staff Admin. */
export const smtpChangedJob = defineQueuedKind({
  name: 'smtp-changed',
  // Tells the staff Admins where every email now goes, so nobody may silence it.
  pausable: false,
  payload: z.object({
    /** The staff Admin to tell. */
    recipientId: z.uuid(),
    /** The staff Admin who changed it. */
    byUserId: z.uuid(),
    /** The new mail server, as `host:port`. */
    server: z
      .string()
      .min(1)
      .max(SMTP_FIELD_MAX_LENGTH + 6),
  }),
});
