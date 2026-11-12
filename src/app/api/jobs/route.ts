/**
 * @file The background jobs' tick at `GET /api/jobs`, for an external cron
 * service every 5 minutes and a Vercel schedule every 15 (`vercel.json`).
 * Only `GET`: the Vercel schedule is set to send it (`requestMethod`), as
 * cron services do; a link checker or prefetcher can't start it, because it
 * asks for `Authorization: Bearer <CRON_SECRET>`. It runs every job that's due
 * (`answerTickRequest`, see docs/jobs.md). Public in the proxy
 * (`PUBLIC_PATHS` in `src/proxy.ts`), since it checks its own secret. The
 * answer holds counts only, and is never cached.
 */
import { connection } from 'next/server';

import { env } from '@/lib/env';
import appContext from '@/server/app-context';
import { answerTickRequest } from '@/server/jobs';

/** How long the platform lets a tick run, in seconds; the tick itself stops starting runs sooner. */
export const maxDuration = 60;

/**
 * Runs the tick for a request with the right secret.
 *
 * @param request - The request.
 * @returns What the tick did, or why it didn't run.
 */
async function tick(request: Request): Promise<Response> {
  // Always at request time: a tick from the build would run nothing.
  await connection();
  const { status, body } = await answerTickRequest(appContext, {
    authorization: request.headers.get('authorization'),
    secret: env.CRON_SECRET,
  });
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export { tick as GET };
