/**
 * @file The background jobs' tick at `GET /api/jobs`, for an external cron
 * service every 5 minutes and a Vercel schedule every 15 (`vercel.json`).
 * Only `GET`: the Vercel schedule is set to send it (`requestMethod`), as
 * cron services do; a link checker or prefetcher can't start it, because it
 * asks for `Authorization: Bearer <CRON_SECRET>`. It runs every job that's due
 * (`answerTickRequest`, see docs/jobs.md), and when work is still due at its
 * deadline it continues after answering, by calling itself again
 * (`continueAfterAnswer` with `after()`). Public in the proxy (`PUBLIC_PATHS`
 * in `src/proxy.ts`), since it checks its own secret. The answer holds counts
 * only, and is never cached.
 */
import { after, connection } from 'next/server';

import { env } from '@/lib/env';
import appContext from '@/server/app-context';
import { answerTickRequest, continueAfterAnswer, TICK_CONTINUATION_HEADER } from '@/server/jobs';

/** How long the platform lets a tick run, in seconds; the tick itself stops starting runs sooner. */
export const maxDuration = 60;

/**
 * Runs the tick for a request with the right secret, and continues it after
 * answering when the answer says so.
 *
 * @param request - The request.
 * @returns What the tick did, or why it didn't run.
 */
async function tick(request: Request): Promise<Response> {
  // Always at request time: a tick from the build would run nothing.
  await connection();
  const secret = env.CRON_SECRET;
  const { response, afterAnswer } = await answerTickRequest(appContext, {
    authorization: request.headers.get('authorization'),
    continuation: request.headers.get(TICK_CONTINUATION_HEADER),
    secret,
  });
  if (afterAnswer && secret) {
    after(() =>
      continueAfterAnswer(appContext, afterAnswer, {
        secret,
        bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET,
      }),
    );
  }
  return Response.json(response.body, {
    status: response.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export { tick as GET };
