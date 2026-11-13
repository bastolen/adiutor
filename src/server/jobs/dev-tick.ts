/**
 * @file The tick in local development: `next dev` has no cron service or
 * Vercel schedule calling it, so without this nothing would run, and queued
 * emails would never reach the local mail server. `src/instrumentation.ts`
 * starts it in development only; production never runs it.
 */
import type { ServiceContext } from '../context';
import { runTick } from './tick';

/** How often the dev server ticks, in milliseconds. */
export const DEV_TICK_INTERVAL_MS = 60_000;

/** How long one dev tick may start runs, in seconds, like the endpoint's tick. */
const DEV_TICK_SECONDS = 45;

/** Marks the ticks started on `globalThis`, which survives the dev server reloading this module. */
const STARTED = Symbol.for('adiutor.devTick');

/**
 * Builds the context the ticks run with, as `pnpm jobs:run` does: the
 * database, real email sending and the configured address. Loaded only when
 * the ticks start, so loading this module never connects to anything.
 *
 * @returns The context.
 */
async function devTickContext(): Promise<ServiceContext> {
  const [{ db }, { sendEmail }, { appUrl }] = await Promise.all([
    import('@/db'),
    import('@/lib/email'),
    import('@/lib/env'),
  ]);
  return { db, sendEmail, baseUrl: appUrl };
}

/**
 * Starts ticking: once right away, then every minute. A tick is skipped
 * while the one before it still runs, a failure is logged by its name only
 * (the next tick tries again), and the timer never keeps the process alive.
 * Only the first call in a process starts anything.
 *
 * @param context - The context to tick with; the app's by default (tests pass their own).
 * @returns Whether this call started the ticks.
 */
export async function startDevTick(context?: ServiceContext): Promise<boolean> {
  const flags = globalThis as typeof globalThis & { [STARTED]?: boolean };
  if (flags[STARTED]) {
    return false;
  }
  flags[STARTED] = true;
  const ctx = context ?? (await devTickContext());
  let running = false;
  /**
   * Runs one tick, unless the one before it still runs.
   */
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runTick(ctx, {
        trigger: 'tick',
        deadline: new Date(Date.now() + DEV_TICK_SECONDS * 1000),
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- Nothing waits for the dev tick; only the log can tell.
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
