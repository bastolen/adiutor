/**
 * @file Answering the tick's endpoint (`GET` or `POST /api/jobs`): with
 * the right secret it runs one tick and reports what it did, as counts.
 * Vercel Cron sends the secret by itself; an external cron service sends it
 * as `Authorization: Bearer <secret>`.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { ServiceContext } from '../context';
import { hitRateLimit, RATE_LIMITS } from '../rate-limit';
import type { JobSummary } from './define';
import { runTick } from './tick';

/**
 * How long one tick from the endpoint may keep starting runs, in seconds:
 * well within the route's `maxDuration` of 60, so it answers in time.
 */
export const ENDPOINT_TICK_SECONDS = 45;

/** What the endpoint answers: the status code and a body with counts only. */
export interface TickResponse {
  /** The HTTP status: 200 (ran), 500 (a run failed), 401, 429 or 503 (no secret set). */
  status: 200 | 401 | 429 | 500 | 503;
  /** The body, as JSON. */
  body:
    | {
        /** Whether every run succeeded. */
        status: 'ok' | 'failed';
        /** The runs, with what each did. */
        runs: { job: string; status: string; summary: JobSummary }[];
        /** Jobs that were due but wait for the next tick. */
        leftForNextTick: string[];
      }
    | { status: 'unauthorized' | 'too_many_requests' | 'disabled' };
}

/**
 * Checks the `Authorization` header against the secret, in constant time
 * (the digests have the same length whatever was sent).
 *
 * @param authorization - The header, if any.
 * @param secret - The secret.
 * @returns Whether it's `Bearer <secret>`.
 */
function isAuthorized(authorization: string | null, secret: string): boolean {
  /**
   * Hashes a value, so both sides compare at the same length.
   *
   * @param value - The value.
   * @returns Its SHA-256 digest.
   */
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${secret}`));
}

/**
 * Answers a request to the tick's endpoint. Without a secret configured the
 * endpoint is off. A wrong or missing secret counts against the sender's IP
 * address, and past the limit the answer becomes 429; the right secret always
 * runs the tick, so someone sharing the cron service's address can't lock it
 * out.
 *
 * @param ctx - Service context, with the request's IP address.
 * @param request - What the request brought.
 * @param request.authorization - Its `Authorization` header, if any.
 * @param request.secret - The configured secret (`CRON_SECRET`), if any.
 * @returns The status and body to answer with.
 */
export async function answerTickRequest(
  ctx: ServiceContext,
  { authorization, secret }: { authorization: string | null; secret: string | undefined },
): Promise<TickResponse> {
  if (!secret) {
    return { status: 503, body: { status: 'disabled' } };
  }
  if (!isAuthorized(authorization, secret)) {
    const request = ctx.requestInfo ? await ctx.requestInfo() : null;
    const { allowed } = await hitRateLimit(
      ctx,
      `job-tick-miss:ip:${request?.ip ?? 'unknown'}`,
      RATE_LIMITS.jobTickMissesPerIp,
    );
    return allowed
      ? { status: 401, body: { status: 'unauthorized' } }
      : { status: 429, body: { status: 'too_many_requests' } };
  }
  const result = await runTick(ctx, {
    trigger: 'tick',
    deadline: new Date(Date.now() + ENDPOINT_TICK_SECONDS * 1000),
  });
  return {
    status: result.failed ? 500 : 200,
    body: {
      status: result.failed ? 'failed' : 'ok',
      runs: result.runs.map(({ job, status, summary }) => ({ job, status, summary })),
      leftForNextTick: result.leftForNextTick,
    },
  };
}
