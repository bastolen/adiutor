/**
 * @file Runs the background jobs once: cleans up expired data and sends
 * invitation reminders. Run it hourly from cron, e.g.
 * `0 * * * * cd /srv/adiutor && pnpm jobs:run >> /var/log/adiutor-jobs.log 2>&1`.
 * It exits with 1 when a reminder couldn't be sent (after everything else
 * ran), so a broken mail setup gets noticed; the next run tries it again.
 *
 * Usage: `pnpm jobs:run`
 */
import { db } from '../src/db';
import { sendEmail } from '../src/lib/email';
import { appUrl } from '../src/lib/env';
import { installLogRedaction } from '../src/lib/log-redaction';
import { cleanUp, sendInvitationReminders } from '../src/server/jobs';

/**
 * Runs every job and prints a summary.
 *
 * @returns The process exit code: 1 when a reminder couldn't be sent.
 */
async function main(): Promise<number> {
  const ctx = { db, sendEmail, baseUrl: appUrl };
  const removed = await cleanUp(ctx);
  const reminders = await sendInvitationReminders(ctx);
  console.info(
    `[${new Date().toISOString()}] Removed ${removed.verifications} verification values, ` +
      `${removed.sessions} sessions, ${removed.rateLimits} rate-limit windows, ` +
      `${removed.auditEvents} old audit events, ${removed.signInErrors} old sign-in errors ` +
      `and ${removed.appErrors} other old errors, ` +
      `and cleared OAuth tokens left on ` +
      `${removed.providerTokens} accounts. Sent ${reminders.sent} invitation reminders${
        reminders.failed
          ? `; ${reminders.failed} couldn't be sent and will be tried again next run.`
          : '.'
      }`,
  );
  return reminders.failed ? 1 : 0;
}

// Database errors are logged without the values they were sent.
installLogRedaction();

main()
  .then(async (code) => {
    await db.$client.end();
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
