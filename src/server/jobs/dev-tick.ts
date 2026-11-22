/**
 * @file The tick in local development: `next dev` has no cron service or
 * Vercel schedule calling it, so without this nothing would run, and queued
 * emails would never reach the local mail server. It calls the dev server's
 * own endpoint (`GET /api/jobs`, with `CRON_SECRET`), as a cron service
 * would, rather than running the jobs in this process: Next.js recompiles
 * the route after every edit or branch switch, while the code
 * `src/instrumentation.ts` loaded at start-up stays as it was, so each tick
 * runs the code as it is now. `src/instrumentation.ts` starts it in
 * development only; production never runs it.
 */
import { TICK_PATH } from './endpoint';

/** How often the dev server ticks, in milliseconds. */
export const DEV_TICK_INTERVAL_MS = 60_000;

/**
 * How long one tick's call may take, in milliseconds: the route's
 * `maxDuration` of 60 seconds, plus time for the dev server to compile the
 * route on the first call. A call that takes longer is given up (the
 * endpoint's runs keep their leases), and the next tick tries again.
 */
const DEV_TICK_TIMEOUT_MS = 90_000;

/** Marks the ticks started on `globalThis`, which survives the dev server reloading this module. */
const STARTED = Symbol.for('adiutor.devTick');

/** Where the ticks go, and with what. */
export interface DevTickOptions {
  /** The app's own address, without a trailing slash (`BETTER_AUTH_URL`). */
  baseUrl: string;
  /** The endpoint's secret (`CRON_SECRET`), if set; without it nothing ticks. */
  secret: string | undefined;
  /** How to send the calls; the global `fetch` by default (tests pass their own). */
  fetch?: typeof fetch;
}

/**
 * Reads where the ticks go from the configuration: the app's address and
 * `CRON_SECRET`. Loaded only when the ticks start, so loading this module
 * reads no configuration.
 *
 * @returns The options.
 */
async function configuredOptions(): Promise<DevTickOptions> {
  const { appUrl, env } = await import('@/lib/env');
  return { baseUrl: appUrl, secret: env.CRON_SECRET };
}

/**
 * Starts ticking: calls the endpoint once right away, then every minute. A
 * tick is skipped while the call before it still runs, an answer other than
 * 200 is logged by its status and a failed call by its error's name only (the
 * next tick tries again), and the timer never keeps the process alive.
 * Without a secret it warns once and never calls. Only the first call in a
 * process starts anything.
 *
 * @param options - Where the ticks go; the app's address and `CRON_SECRET` by default (tests pass their own).
 * @returns Whether this call started the ticks.
 */
export async function startDevTick(options?: DevTickOptions): Promise<boolean> {
  const flags = globalThis as typeof globalThis & { [STARTED]?: boolean };
  if (flags[STARTED]) {
    return false;
  }
  flags[STARTED] = true;
  const { baseUrl, secret, fetch: send = fetch } = options ?? (await configuredOptions());
  if (!secret) {
    // eslint-disable-next-line no-console -- Nothing else would tell why queued emails never arrive.
    console.warn(
      "Background jobs don't run: the development tick calls /api/jobs with CRON_SECRET, which isn't set. Set it in .env (openssl rand -base64 32) and restart.",
    );
    return false;
  }
  let running = false;
  /**
   * Calls the endpoint once, unless the call before it still runs.
   */
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const response = await send(`${baseUrl}${TICK_PATH}`, {
        headers: { authorization: `Bearer ${secret}` },
        cache: 'no-store',
        // The call carries the secret; a wrong address should fail loudly, not follow a redirect.
        redirect: 'error',
        signal: AbortSignal.timeout(DEV_TICK_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.status !== 200) {
        // eslint-disable-next-line no-console -- Nothing waits for the dev tick; only the log can tell.
        console.error(
          `The development tick was answered with ${response.status}; the next one tries again in a minute`,
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console -- See above.
      console.error(
        'The development tick failed; the next one tries again in a minute',
        error instanceof Error ? error.name : 'unknown error',
      );
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => {
    void tick();
  }, DEV_TICK_INTERVAL_MS).unref();
  return true;
}
