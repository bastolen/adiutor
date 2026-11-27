/**
 * @file Tests for how many previews a server draws at once: two, a third
 * skipped or waiting for a slot, and a slot freed when a drawing fails.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import inDrawingSlot, { BUSY } from './limiter';

/**
 * A drawing that ends when it's told to.
 *
 * @returns The drawing, and how to end it.
 */
function held() {
  /** Ends the drawing with what it gives. */
  let end: (value: string) => void = () => {};
  const done = new Promise<string>((resolve) => {
    end = resolve;
  });
  return {
    /**
     * The drawing.
     *
     * @returns What it gives, once it's ended.
     */
    work: () => done,
    end,
  };
}

describe('inDrawingSlot', () => {
  it('draws two at once, and skips a third that can’t wait', async () => {
    const first = held();
    const second = held();
    const running = [inDrawingSlot(first.work, 'skip'), inDrawingSlot(second.work, 'skip')];

    expect(await inDrawingSlot(async () => 'third', 'skip')).toBe(BUSY);

    first.end('first');
    second.end('second');
    expect(await Promise.all(running)).toEqual(['first', 'second']);
    expect(await inDrawingSlot(async () => 'fourth', 'skip')).toBe('fourth');
  });

  it('lets a drawing that may wait take the next free slot', async () => {
    const first = held();
    const second = held();
    const running = [inDrawingSlot(first.work, 'skip'), inDrawingSlot(second.work, 'skip')];
    let started = false;
    const waiting = inDrawingSlot(async () => {
      started = true;
      return 'waited';
    }, 'wait');

    await Promise.resolve();
    expect(started).toBe(false);
    first.end('first');
    expect(await waiting).toBe('waited');
    second.end('second');
    await Promise.all(running);
  });

  it('frees the slot of a drawing that fails', async () => {
    /**
     * A drawing that fails.
     *
     * @returns What the slot gives: the failure.
     */
    const failing = () => inDrawingSlot(() => Promise.reject(new Error('broken')), 'skip');
    await expect(failing()).rejects.toThrow('broken');
    await expect(failing()).rejects.toThrow('broken');
    expect(await inDrawingSlot(async () => 'drawn', 'skip')).toBe('drawn');
  });
});
