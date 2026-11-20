/**
 * @file The limits of sending email, apart from the code that sends it
 * (`email.ts`): code that only needs the numbers, such as the background
 * jobs' deadlines, then doesn't load the mail transport, and a test that
 * stands in for `email.ts` still has them.
 */

/**
 * How many SMTP connections are kept open and reused at most, unless
 * `SMTP_URL` says otherwise. Emails beyond it wait for a free connection, so
 * a job that sends several at once sends no more than this together (the
 * invitation reminders' groups): the rest would only wait, with the send's
 * time limit already running.
 */
export const SMTP_MAX_CONNECTIONS = 3;

/**
 * The longest one email may take, in milliseconds, from the call to
 * `sendEmail` until the mail server has accepted it, whichever step it hangs
 * at (waiting for a free connection of the pool counts too). After it the
 * send fails like any other, so a queued job tries the email again and a
 * request answers. The background jobs count on it: a tick stops starting
 * work twice this long, plus a margin, before the platform stops its
 * function (`REQUEST_RUN_SECONDS` in `src/server/jobs/tick.ts`), so an email
 * started just before the tick's deadline, and the staff Admins' alert when
 * that job then fails, still end in time.
 *
 * The attempt itself isn't cut off: the mail server may still accept the
 * email after the send was reported as failed, until the transport's own
 * limits (`SMTP_TIMEOUTS`) close its connection. A job that tries again then
 * sends it twice, which jobs accept (they run at least once).
 */
export const SEND_TIMEOUT_MS = 15_000;
