/**
 * @file Tests for the idle limit on a stream that's read: it passes the
 * pieces on, ends with a timeout when the next one is late, and cancelling
 * reaches the source.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { StorageError } from './errors';
import withIdleLimit from './idle-limit';

/**
 * Reads a stream to its end.
 *
 * @param stream - The stream.
 * @returns Its text.
 */
async function textOf(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('withIdleLimit', () => {
  it('passes every piece on, and says when it ended', async () => {
    const onEnd = vi.fn();
    const source = new Response('hello, world').body;
    if (!source) {
      throw new Error('No body.');
    }
    await expect(textOf(withIdleLimit(source, 1000, onEnd))).resolves.toBe('hello, world');
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('ends with a timeout when the next piece is late, and cancels the source', async () => {
    const cancel = vi.fn();
    const onEnd = vi.fn();
    const stuck = new ReadableStream<Uint8Array>({
      /**
       * Has one piece ready, and never another.
       *
       * @param controller - The stream's controller.
       */
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'));
      },
      cancel,
    });
    const read = textOf(withIdleLimit(stuck, 20, onEnd));
    await expect(read).rejects.toBeInstanceOf(StorageError);
    await expect(read).rejects.toMatchObject({ failure: 'timed_out' });
    expect(cancel).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('cancels the source when the reader stops', async () => {
    const cancel = vi.fn();
    const onEnd = vi.fn();
    const endless = new ReadableStream<Uint8Array>({
      /**
       * Has a piece whenever one is asked for.
       *
       * @param controller - The stream's controller.
       */
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel,
    });
    const reader = withIdleLimit(endless, 1000, onEnd).getReader();
    await reader.read();
    await reader.cancel('stopped');
    expect(cancel).toHaveBeenCalledWith('stopped');
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('lets the source go when the reader stops asking for more', async () => {
    vi.useFakeTimers();
    try {
      const cancelled = vi.fn();
      const onEnd = vi.fn();
      const source = new ReadableStream<Uint8Array>({
        /**
         * Sends a piece each time it's asked.
         *
         * @param controller - The source's controller.
         */
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('piece'));
        },
        cancel: cancelled,
      });
      const reader = withIdleLimit(source, 1000, onEnd).getReader();
      await reader.read();
      // A reader that reads nothing more: a paused video, a client that stalls.
      await vi.advanceTimersByTimeAsync(1500);
      expect(onEnd).toHaveBeenCalledOnce();
      expect(cancelled).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
