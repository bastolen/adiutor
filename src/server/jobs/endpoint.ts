/**
 * @file Answering the tick's endpoint (`GET /api/jobs`): with the right
 * secret it runs one tick and reports what it did, as counts. A Vercel
 * schedule sends the secret by itself; an external cron service sends it as
 * `Authorization: Bearer <secret>`. When the tick stops at its deadline with
 * work still due, it continues straight away: after answering, the endpoint
 * calls itself again (`requestTickContinuation`), and the continued call
 * answers at once and runs its tick after answering, up to
 * {@link MAX_TICK_CONTINUATIONS} in a row, so a backlog never waits for the
 * next tick.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { ServiceContext } from '../context';
import { hitRateLimit, RATE_LIMITS } from '../rate-limit';
import type { JobSummary } from './define';
import { runTick, type TickResult } from './tick';

/**
 * How long one tick from the endpoint may keep starting runs, in seconds:
 * well within the route's `maxDuration` of 60, so it answers in time.
 */
export const ENDPOINT_TICK_SECONDS = 45;

/** The endpoint's path, which a continuation calls on the app's own address. */
export const TICK_PATH = '/api/jobs';

/** The header a continued call carries: how many continuations came before it, plus one. */
export const TICK_CONTINUATION_HEADER = 'x-adiutor-tick-continuation';

/**
 * How many times in a row a tick continues itself at most: about 7½ minutes
 * of extra work, after which the next tick takes over.
 */
export const MAX_TICK_CONTINUATIONS = 10;

/** What the endpoint answers: the status code and a body with counts only. */
export interface TickResponse {
  /**
   * The HTTP status: 200 (ran), 500 (a run failed), 202 (a continued call,
   * which runs after answering), 400 (a malformed continuation), 401, 429 or
   * 503 (no secret set).
   */
  status: 200 | 202 | 400 | 401 | 429 | 500 | 503;
  /** The body, as JSON. */
  body:
    | {
        /** Whether every run succeeded. */
        status: 'ok' | 'failed';
        /** The runs, with what each did. */
        runs: { job: string; status: string; summary: JobSummary }[];
        /** Jobs that were due but wait for the next tick. */
        leftForNextTick: string[];
        /** Whether the tick continues straight away, because work is still due. */
        continues: boolean;
      }
    | { status: 'continuing'; step: number }
    | { status: 'invalid' | 'unauthorized' | 'too_many_requests' | 'disabled' };
}

/**
 * The endpoint's answer, and what's left to do once it's sent: running a
 * continued call's tick and saying whether to continue again. It gives the
 * next continuation's step, or `null` to stop. (Not called `then`: an object
 * with a `then` would pass for a promise when awaited.)
 */
export interface TickAnswer {
  /** What to answer. */
  response: TickResponse;
  /** The work for after the answer, if any (`after()` in the route). */
  afterAnswer: (() => Promise<number | null>) | null;
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
 * Decides whether a tick continues straight away: only when work is still
 * due, the tick ran something (so a chain that gets nothing done stops), and
 * fewer than {@link MAX_TICK_CONTINUATIONS} continuations came before it.
 *
 * @param result - What the tick did.
 * @param step - Which continuation the tick was: 0 for one a cron service started.
 * @returns The next continuation's step, or `null` to stop.
 */
export function nextContinuation(
  result: Pick<TickResult, 'moreDue' | 'runs'>,
  step: number,
): number | null {
  return result.moreDue && result.runs.length > 0 && step < MAX_TICK_CONTINUATIONS
    ? step + 1
    : null;
}

/**
 * Reads a call's continuation step from its header.
 *
 * @param header - The header, if any.
 * @returns 0 without one, the step (1 to {@link MAX_TICK_CONTINUATIONS}), or `null` when it's malformed.
 */
function continuationStep(header: string | null): number | null {
  if (header === null) {
    return 0;
  }
  const step = /^\d{1,2}$/.test(header) ? Number(header) : 0;
  return step >= 1 && step <= MAX_TICK_CONTINUATIONS ? step : null;
}

/**
 * Answers a request to the tick's endpoint. Without a secret configured the
 * endpoint is off. A wrong or missing secret counts against the sender's IP
 * address, and past the limit the answer becomes 429; the right secret always
 * runs the tick, so someone sharing the cron service's address can't lock it
 * out.
 *
 * A call from a cron service runs the tick and answers with what it did,
 * saying whether it continues. A continued call (with
 * {@link TICK_CONTINUATION_HEADER}) answers 202 at once and runs its tick in
 * `afterAnswer`, so the call before it only waits for that answer.
 *
 * @param ctx - Service context, with the request's IP address.
 * @param request - What the request brought.
 * @param request.authorization - Its `Authorization` header, if any.
 * @param request.continuation - Its {@link TICK_CONTINUATION_HEADER}, if any.
 * @param request.secret - The configured secret (`CRON_SECRET`), if any.
 * @param request.tickSeconds - How long the tick may start runs; {@link ENDPOINT_TICK_SECONDS} by default.
 * @returns The answer, and what to do after it.
 */
export async function answerTickRequest(
  ctx: ServiceContext,
  {
    authorization,
    continuation = null,
    secret,
    tickSeconds = ENDPOINT_TICK_SECONDS,
  }: {
    authorization: string | null;
    continuation?: string | null;
    secret: string | undefined;
    tickSeconds?: number;
  },
): Promise<TickAnswer> {
  if (!secret) {
    return { response: { status: 503, body: { status: 'disabled' } }, afterAnswer: null };
  }
  if (!isAuthorized(authorization, secret)) {
    const request = ctx.requestInfo ? await ctx.requestInfo() : null;
    const { allowed } = await hitRateLimit(
      ctx,
      `job-tick-miss:ip:${request?.ip ?? 'unknown'}`,
      RATE_LIMITS.jobTickMissesPerIp,
    );
    return {
      response: allowed
        ? { status: 401, body: { status: 'unauthorized' } }
        : { status: 429, body: { status: 'too_many_requests' } },
      afterAnswer: null,
    };
  }
  const step = continuationStep(continuation);
  if (step === null) {
    return { response: { status: 400, body: { status: 'invalid' } }, afterAnswer: null };
  }
  /**
   * Runs one tick.
   *
   * @returns What it did.
   */
  const tick = () =>
    runTick(ctx, { trigger: 'tick', deadline: new Date(Date.now() + tickSeconds * 1000) });
  if (step > 0) {
    return {
      response: { status: 202, body: { status: 'continuing', step } },
      /**
       * Runs the continued call's tick after the answer.
       *
       * @returns The next continuation's step, or `null` to stop.
       */
      afterAnswer: async () => nextContinuation(await tick(), step),
    };
  }
  const result = await tick();
  const next = nextContinuation(result, 0);
  return {
    response: {
      status: result.failed ? 500 : 200,
      body: {
        status: result.failed ? 'failed' : 'ok',
        runs: result.runs.map(({ job, status, summary }) => ({ job, status, summary })),
        leftForNextTick: result.leftForNextTick,
        continues: next !== null,
      },
    },
    afterAnswer: next === null ? null : async () => next,
  };
}

/** How a continuation is requested. */
export interface ContinuationOptions {
  /** The endpoint's secret (`CRON_SECRET`). */
  secret: string;
  /** Vercel's protection bypass secret (`VERCEL_AUTOMATION_BYPASS_SECRET`), for protected Preview deployments. */
  bypassSecret?: string | undefined;
  /** How to send the request; the global `fetch` by default (tests pass their own). */
  fetch?: typeof fetch;
}

/**
 * Calls the endpoint again as a continuation, on the app's own configured
 * address (`ctx.baseUrl`, never a host from the request: the call carries the
 * secret). It only waits for the 202, as the continued call runs its tick
 * after answering. A problem is logged (the status or error, and the step)
 * and never thrown: the next tick takes over.
 *
 * @param ctx - Service context, for the app's address.
 * @param step - The continuation's step.
 * @param options - The secrets, and how to send.
 * @param options.secret - The endpoint's secret.
 * @param options.bypassSecret - Vercel's protection bypass secret, if set.
 * @param options.fetch - How to send the request.
 * @returns Whether the continued call accepted it.
 */
export async function requestTickContinuation(
  ctx: Pick<ServiceContext, 'baseUrl'>,
  step: number,
  { secret, bypassSecret, fetch: send = fetch }: ContinuationOptions,
): Promise<boolean> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    [TICK_CONTINUATION_HEADER]: String(step),
    ...(bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {}),
  };
  try {
    const response = await send(`${ctx.baseUrl}${TICK_PATH}`, { headers, cache: 'no-store' });
    await response.body?.cancel();
    if (response.status === 202) {
      return true;
    }
    // eslint-disable-next-line no-console -- The tick has no caller left to tell; the next tick takes over.
    console.error(
      `Continuing the jobs' tick (step ${step}) was answered with ${response.status}; the next tick takes over`,
    );
  } catch (error) {
    // eslint-disable-next-line no-console -- See above.
    console.error(
      `Continuing the jobs' tick (step ${step}) failed; the next tick takes over`,
      error instanceof Error ? error.name : 'unknown error',
    );
  }
  return false;
}

/**
 * Does what's left after the endpoint answered (the route runs it with
 * `after()`): a continued call's tick, then the next continuation when work
 * is still due. An unexpected error (say, the database is unreachable) is
 * logged, never thrown.
 *
 * @param ctx - Service context.
 * @param afterAnswer - The work from the answer.
 * @param options - How to request the next continuation.
 */
export async function continueAfterAnswer(
  ctx: Pick<ServiceContext, 'baseUrl'>,
  afterAnswer: () => Promise<number | null>,
  options: ContinuationOptions,
): Promise<void> {
  try {
    const next = await afterAnswer();
    if (next !== null) {
      await requestTickContinuation(ctx, next, options);
    }
  } catch (error) {
    // eslint-disable-next-line no-console -- Runs after the answer: only the log can tell.
    console.error(
      "The jobs' tick failed after answering; the next tick takes over",
      error instanceof Error ? error.name : 'unknown error',
    );
  }
}
