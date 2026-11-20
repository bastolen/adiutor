/**
 * @file The background jobs' tick at `GET /api/jobs`: it answers with
 * `answerTickRequest` (see docs/jobs.md, "The endpoint") and runs what's
 * left after the answer with `after()`. Public in the proxy (`PUBLIC_PATHS`
 * in `src/proxy.ts`), since it checks its own secret.
 */
import { after, connection } from 'next/server';

import { env } from '@/lib/env';
import appContext from '@/server/app-context';
import { answerTickRequest, TICK_CONTINUATION_HEADER } from '@/server/jobs';

/**
 * How long the platform lets a tick run, in seconds; the tick itself stops
 * starting runs after 25, which is worked out from this limit, leaving room
 * for a last email and the alert of a job that failed
 * (`REQUEST_RUN_SECONDS` in `src/server/jobs/tick.ts`).
 */
export const maxDuration = 60;

/**
 * Runs the tick for a request with the right secret, and what's left of it
 * after answering.
 *
 * @param request - The request.
 * @returns What the tick did, or why it didn't run.
 */
async function tick(request: Request): Promise<Response> {
  // Always at request time: a tick from the build would run nothing.
  await connection();
  const { response, afterAnswer } = await answerTickRequest(appContext, {
    authorization: request.headers.get('authorization'),
    continuation: request.headers.get(TICK_CONTINUATION_HEADER),
    secret: env.CRON_SECRET,
    bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  if (afterAnswer) {
    after(afterAnswer);
  }
  return Response.json(response.body, {
    status: response.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export { tick as GET };
