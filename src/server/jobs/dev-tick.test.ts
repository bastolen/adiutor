/**
 * @file Tests for the tick in local development: it calls the jobs' endpoint
 * on the app's own address with the secret, right away and then every
 * minute, starts only once per process, skips a tick while the call before it
 * still runs, logs a failure by its status or name only, and without a secret
 * warns once and calls nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_TICK_INTERVAL_MS, startDevTick } from './dev-tick';

// Only the endpoint's path is needed; the endpoint itself would load the database.
vi.mock('./endpoint', () => ({ TICK_PATH: '/api/jobs' }));

/** The app's address the ticks call. */
const baseUrl = 'http://localhost:3100';

/** A secret of the length the endpoint asks for. */
const secret = 'adiutor-tests-cron-secret-0123456789';

/** Stands in for `fetch`, so no call leaves the test. */
const send = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
  send.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
  // The flag lives on `globalThis` so it survives module reloads; each test starts afresh.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('adiutor.devTick')];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startDevTick', () => {
  it('calls the endpoint with the secret right away and every minute, and starts only once', async () => {
    await expect(startDevTick({ baseUrl, secret, fetch: send })).resolves.toBe(true);
    await expect(startDevTick({ baseUrl, secret, fetch: send })).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'http://localhost:3100/api/jobs',
      expect.objectContaining({
        headers: { authorization: `Bearer ${secret}` },
        redirect: 'error',
      }),
    );

    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the call before it still runs', async () => {
    send.mockReturnValue(new Promise(() => {}));

    await startDevTick({ baseUrl, secret, fetch: send });
    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS * 2);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('logs a failed call by its name only, and tries again at the next tick', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValue(new TypeError('details that might be personal'));

    await startDevTick({ baseUrl, secret, fetch: send });
    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS);

    expect(logged).toHaveBeenCalledWith(
      'The development tick failed; the next one tries again in a minute',
      'TypeError',
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('logs an answer other than 200 by its status', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockResolvedValue(new Response(null, { status: 503 }));

    await startDevTick({ baseUrl, secret, fetch: send });
    await vi.advanceTimersByTimeAsync(0);

    expect(logged).toHaveBeenCalledWith(
      'The development tick was answered with 503; the next one tries again in a minute',
    );
  });

  it('warns once and calls nothing without a secret', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(startDevTick({ baseUrl, secret: undefined, fetch: send })).resolves.toBe(false);
    await expect(startDevTick({ baseUrl, secret: undefined, fetch: send })).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS * 2);

    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('CRON_SECRET'));
    expect(send).not.toHaveBeenCalled();
  });
});
