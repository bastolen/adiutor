/**
 * @file Cuts a part out of a stream of a whole file: for a storage server
 * that sent the whole file when a part was asked for, so the part the route
 * answers with is the one its `Content-Range` names.
 */

/**
 * Passes on only the bytes from `start` to `end` of a stream, both
 * included, and cancels the source once they're through.
 *
 * @param source - The whole file, as it arrives.
 * @param start - The part's first byte.
 * @param end - The part's last byte.
 * @returns The part.
 */
export default function sliceStream(
  source: ReadableStream<Uint8Array>,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let at = 0;
  return new ReadableStream<Uint8Array>({
    /**
     * Passes on the next bytes of the part, skipping those before it.
     *
     * @param controller - The part's controller.
     */
    async pull(controller) {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- a stream is read a piece at a time
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const from = Math.max(0, start - at);
        const to = Math.min(value.length, end - at + 1);
        at += value.length;
        if (from < to) {
          controller.enqueue(value.subarray(from, to));
        }
        if (at > end) {
          controller.close();
          // eslint-disable-next-line no-await-in-loop -- the loop ends here
          await reader.cancel().catch(() => {});
          return;
        }
        if (from < to) {
          return;
        }
      }
    },
    /**
     * Cancels the source when the reader stops.
     *
     * @param reason - Why it stopped.
     */
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
