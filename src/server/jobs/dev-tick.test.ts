/**
 * @file Tests for the tick in local development: it ticks right away and
 * then every minute, starts only once per process, skips a tick while the one
 * before it still runs, and logs a failure by its name only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceContext } from '../context';
import { DEV_TICK_INTERVAL_MS, startDevTick } from './dev-tick';
import { runTick } from './tick';

// The tick is stood in for; the dev tick also reads how long a tick may start runs from it.
vi.mock('./tick', () => ({ runTick: vi.fn(), REQUEST_RUN_SECONDS: 40 }));

/** The context the ticks get; the tick itself is mocked, so nothing in it is used. */
const ctx = { baseUrl: 'https://adiutor.test' } as ServiceContext;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(runTick).mockReset();
  // The flag lives on `globalThis` so it survives module reloads; each test starts afresh.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('adiutor.devTick')];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startDevTick', () => {
  it('ticks right away and every minute, and starts only once', async () => {
    vi.mocked(runTick).mockResolvedValue({
      runs: [],
      leftForNextTick: [],
      failed: false,
      moreDue: false,
    });

    await expect(startDevTick(ctx)).resolves.toBe(true);
    await expect(startDevTick(ctx)).resolves.toBe(false);
    expect(runTick).toHaveBeenCalledTimes(1);
    expect(runTick).toHaveBeenCalledWith(ctx, expect.objectContaining({ trigger: 'tick' }));

    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS);
    expect(runTick).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the one before it still runs', async () => {
    vi.mocked(runTick).mockReturnValue(new Promise(() => {}));

    await startDevTick(ctx);
    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS * 2);

    expect(runTick).toHaveBeenCalledTimes(1);
  });

  it('logs a failed tick by its name only, and tries again at the next', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runTick).mockRejectedValue(new TypeError('details that might be personal'));

    await startDevTick(ctx);
    await vi.advanceTimersByTimeAsync(DEV_TICK_INTERVAL_MS);

    expect(logged).toHaveBeenCalledWith(
      'The development tick failed; the next one tries again in a minute',
      'TypeError',
    );
    expect(runTick).toHaveBeenCalledTimes(2);
  });
});
