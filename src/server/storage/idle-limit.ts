/**
 * @file A time limit for a stream that's read as it arrives: what matters is
 * that the bytes keep coming, not how long a large file takes in all, so the
 * limit is on the wait for each next piece.
 */
import { StorageError } from './errors';

/**
 * Wraps a stream so that a wait of more than `idleMs` for its next piece
 * ends it with a `timed_out` storage error and cancels the source.
 * Cancelling the wrapped stream (a browser that stops downloading) cancels
 * the source too, and `onEnd` runs once whichever way it ends.
 *
 * @param source - The stream.
 * @param idleMs - How long to wait for each piece.
 * @param onEnd - Runs once when the stream ends, fails or is cancelled (e.g. closes a connection).
 * @returns The wrapped stream.
 */
export default function withIdleLimit(
  source: ReadableStream<Uint8Array>,
  idleMs: number,
  onEnd: () => void = () => {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let ended = false;
  /** Runs `onEnd` the first time only. */
  const end = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  return new ReadableStream<Uint8Array>({
    /**
     * Passes on the next piece, unless it takes too long.
     *
     * @param controller - The wrapped stream's controller.
     */
    async pull(controller) {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.error(new StorageError('timed_out'));
        end();
        // The source may be stuck; nothing waits for its answer.
        reader.cancel().catch(() => {});
      }, idleMs);
      try {
        const { done, value } = await reader.read();
        if (timedOut) {
          return;
        }
        if (done) {
          controller.close();
          end();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        if (!timedOut) {
          controller.error(error);
          end();
        }
      } finally {
        clearTimeout(timer);
      }
    },
    /**
     * Cancels the source when the reader stops.
     *
     * @param reason - Why it stopped.
     */
    async cancel(reason) {
      end();
      await reader.cancel(reason);
    },
  });
}
