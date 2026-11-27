/**
 * @file Tests for cutting a part out of a stream: the bytes asked for, from
 * pieces of any size, and the source cancelled once they're through.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import sliceStream from './slice';

/**
 * A stream of text in pieces.
 *
 * @param pieces - The pieces.
 * @param cancel - Called when it's cancelled.
 * @returns The stream.
 */
function streamOf(pieces: string[], cancel = vi.fn()): ReadableStream<Uint8Array> {
  const queue = [...pieces];
  return new ReadableStream<Uint8Array>({
    /**
     * Sends the next piece, or ends.
     *
     * @param controller - The stream's controller.
     */
    pull(controller) {
      const next = queue.shift();
      if (next === undefined) {
        controller.close();
      } else {
        controller.enqueue(new TextEncoder().encode(next));
      }
    },
    cancel,
  });
}

describe('sliceStream', () => {
  it('passes on only the part, from pieces of any size', async () => {
    /**
     * Reads a stream as text.
     *
     * @param stream - The stream.
     * @returns Its text.
     */
    const text = (stream: ReadableStream<Uint8Array>) => new Response(stream).text();
    expect(await text(sliceStream(streamOf(['print', 'er l', 'og']), 2, 5))).toBe('inte');
    expect(await text(sliceStream(streamOf(['printer log']), 0, 10))).toBe('printer log');
    expect(await text(sliceStream(streamOf(['printer', ' log']), 8, 10))).toBe('log');
  });

  it('cancels the source once the part is through', async () => {
    const cancel = vi.fn();
    const part = sliceStream(streamOf(['printer', ' log', ' and more'], cancel), 0, 6);
    expect(await new Response(part).text()).toBe('printer');
    expect(cancel).toHaveBeenCalled();
  });
});
