/**
 * @file Recording why a job failed: as an error in the app (`recordAppError`,
 * source `job`), so staff Admins can look it up by its reference under Logs
 * → Errors. The log gets the job and the reference only, never the error's
 * message, which can quote personal data such as an email address.
 */
import { recordAppError } from '../app-errors';
import type { ServiceContext } from '../context';

/**
 * Records a job's failure and writes one line to the log.
 *
 * @param ctx - Service context.
 * @param job - The job's name, or the kind's.
 * @param error - What went wrong: the thrown value, or the failure a job reported.
 * @returns The error's reference, or `null` when it couldn't be recorded (say,
 *   the database is down; the log says so).
 */
export default async function recordJobError(
  ctx: Pick<ServiceContext, 'db'>,
  job: string,
  error: unknown,
): Promise<string | null> {
  try {
    const { reference } = await recordAppError(ctx, { source: 'job', error, routePath: job });
    // eslint-disable-next-line no-console -- A job has no caller to report to but the log.
    console.error(`Job ${job} failed; see error ${reference}`);
    return reference;
  } catch (recording) {
    // eslint-disable-next-line no-console -- Without the database, the log is all there is.
    console.error(
      `Job ${job} failed (${error instanceof Error ? error.name : 'error'}), and recording it failed`,
      recording,
    );
    return null;
  }
}
