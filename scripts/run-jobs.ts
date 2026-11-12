/**
 * @file Runs one tick of the background jobs: every job that's due (see
 * docs/jobs.md). Run it every 5 minutes from cron, e.g.
 * `*\/5 * * * * cd /srv/adiutor && pnpm jobs:run >> /var/log/adiutor-jobs.log 2>&1`.
 * It exits with 1 when a run failed (after the other jobs ran), so a broken
 * mail setup gets noticed; the next run tries it again.
 *
 * Usage: `pnpm jobs:run`
 */
import { db } from '../src/db';
import { sendEmail } from '../src/lib/email';
import { appUrl } from '../src/lib/env';
import { installLogRedaction } from '../src/lib/log-redaction';
import { runTick } from '../src/server/jobs';

/** How long one tick may keep starting runs: less than cron's 5 minutes. */
const TICK_MINUTES = 4;

/**
 * Runs one tick and prints what each run did.
 *
 * @returns The process exit code: 1 when a run failed.
 */
async function main(): Promise<number> {
  const ctx = { db, sendEmail, baseUrl: appUrl };
  const result = await runTick(ctx, {
    trigger: 'cli',
    deadline: new Date(Date.now() + TICK_MINUTES * 60_000),
  });
  result.runs.forEach((run) => {
    const counts = Object.entries(run.summary)
      .map(([what, count]) => `${what} ${count}`)
      .join(', ');
    console.info(`[${new Date().toISOString()}] ${run.job}: ${run.status} (${counts})`);
  });
  return result.failed ? 1 : 0;
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
