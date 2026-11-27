/**
 * @file Tests for the SFTP connection a driver keeps: one connection for uses
 * in a row and at once (all of them its first while it opens), closed once
 * nothing has used it for the idle time and held while anything does, a
 * connection that ended (or never opened) forgotten so the next use opens
 * another, one a use stopped trusting kept no more and ended once the uses on
 * it are done, one idle past its time (a frozen process) not used again, and
 * closing the keeper ending it once its uses are done, and any connection
 * opened after that once its use is.
 */
import type { SFTPWrapper } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import sharedConnection, { type Connection } from './sftp-connection';

/** A connection that only notes whether it ended. */
interface FakeConnection extends Connection {
  /** Ends it as the server or the network would. */
  drop: () => void;
}

/**
 * A fake connection.
 *
 * @returns The connection.
 */
function fakeConnection(): FakeConnection {
  let closed = false;
  const listeners: (() => void)[] = [];
  /** Ends it, once, telling whoever listens. */
  const close = () => {
    if (!closed) {
      closed = true;
      listeners.splice(0).forEach((listener) => listener());
    }
  };
  return {
    sftp: {} as SFTPWrapper,
    end: close,
    drop: close,
    /**
     * Whether it has ended.
     *
     * @returns Whether it has.
     */
    get closed() {
      return closed;
    },
    /**
     * Calls a listener once it has ended.
     *
     * @param listener - What to call.
     */
    onClose: (listener) => {
      if (closed) {
        listener();
      } else {
        listeners.push(listener);
      }
    },
  };
}

/** The idle time in these tests. */
const KEEP = 60_000;

let opened: FakeConnection[] = [];

/**
 * Opens a fake connection, noting it.
 *
 * @returns The connection.
 */
async function open(): Promise<Connection> {
  const connection = fakeConnection();
  opened.push(connection);
  return connection;
}

beforeEach(() => {
  opened = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sharedConnection', () => {
  it('keeps one connection for uses in a row and at once', async () => {
    const kept = sharedConnection(open, KEEP);

    const first = await kept.lease();
    expect(first.fresh).toBe(true);
    first.release();
    const [second, third] = await Promise.all([kept.lease(), kept.lease()]);

    expect(opened).toHaveLength(1);
    expect(second.fresh).toBe(false);
    expect(second.connection).toBe(first.connection);
    expect(third.connection).toBe(first.connection);
  });

  it('closes the connection once nothing has used it for the idle time, and holds it while anything does', async () => {
    const kept = sharedConnection(open, KEEP);
    const reading = await kept.lease();
    const call = await kept.lease();
    call.release();
    // Letting go twice counts once.
    call.release();

    vi.advanceTimersByTime(KEEP * 2);
    expect(opened[0]?.closed).toBe(false);

    reading.release();
    vi.advanceTimersByTime(KEEP - 1);
    expect(opened[0]?.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(opened[0]?.closed).toBe(true);

    // The next use opens another.
    const next = await kept.lease();
    expect(next.fresh).toBe(true);
    expect(opened).toHaveLength(2);
  });

  it('keeps the connection open for a use that comes within the idle time', async () => {
    const kept = sharedConnection(open, KEEP);
    (await kept.lease()).release();
    vi.advanceTimersByTime(KEEP - 1);
    const again = await kept.lease();
    vi.advanceTimersByTime(KEEP * 2);

    expect(opened).toHaveLength(1);
    expect(again.connection.closed).toBe(false);
  });

  it('forgets a connection that ended, or never opened, and opens another', async () => {
    const kept = sharedConnection(open, KEEP);
    (await kept.lease()).release();
    opened[0]?.drop();

    const afterDrop = await kept.lease();
    expect(afterDrop.fresh).toBe(true);
    expect(opened).toHaveLength(2);
    afterDrop.release();

    let fails = true;
    const flaky = sharedConnection(async () => {
      if (fails) {
        fails = false;
        throw new Error('unreachable');
      }
      return open();
    }, KEEP);
    await expect(flaky.lease()).rejects.toThrow('unreachable');
    expect((await flaky.lease()).fresh).toBe(true);
  });

  it('shares a connection that’s still opening, as the first use of all who wait for it', async () => {
    const kept = sharedConnection(open, KEEP);
    const [first, second] = await Promise.all([kept.lease(), kept.lease()]);
    expect(opened).toHaveLength(1);
    expect([first.fresh, second.fresh]).toEqual([true, true]);
    first.release();
    expect((await kept.lease()).fresh).toBe(false);

    const failing = sharedConnection(async () => {
      throw new Error('unreachable');
    }, KEEP);
    const both = await Promise.allSettled([failing.lease(), failing.lease()]);
    expect(both.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
  });

  it('stops keeping a connection a use stopped trusting, which ends once the uses on it are done', async () => {
    const kept = sharedConnection(open, KEEP);
    const reading = await kept.lease();
    const failed = await kept.lease();
    failed.release();
    failed.discard();

    // Someone else's read still has it; the next use opens another.
    expect(opened[0]?.closed).toBe(false);
    expect((await kept.lease()).connection).not.toBe(reading.connection);
    reading.release();
    expect(opened[0]?.closed).toBe(true);
  });

  it('doesn’t use a connection again that stayed idle past its time, as in a frozen process', async () => {
    const kept = sharedConnection(open, KEEP);
    (await kept.lease()).release();
    // The clock moves on, but the idle timer didn't run: the process was frozen.
    vi.setSystemTime(Date.now() + KEEP + 1);

    const next = await kept.lease();
    expect(next.fresh).toBe(true);
    expect(opened).toHaveLength(2);
    await vi.waitFor(() => expect(opened[0]?.closed).toBe(true));
  });

  it('ends the connection once its uses are done when the keeper is closed', async () => {
    const kept = sharedConnection(open, KEEP);
    const reading = await kept.lease();

    kept.close();
    expect(opened[0]?.closed).toBe(false);
    reading.release();
    expect(opened[0]?.closed).toBe(true);

    // A use after that opens a connection that ends with it, rather than being kept.
    const late = await kept.lease();
    expect(late.fresh).toBe(true);
    late.release();
    expect(late.connection.closed).toBe(true);

    // Closing a keeper without a connection does nothing; one closed while idle ends at once.
    sharedConnection(open, KEEP).close();
    const idle = sharedConnection(open, KEEP);
    (await idle.lease()).release();
    idle.close();
    await vi.runAllTimersAsync();
    expect(opened.at(-1)?.closed).toBe(true);
  });
});
