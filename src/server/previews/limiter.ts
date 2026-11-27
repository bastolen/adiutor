/**
 * @file How many previews this server draws at once (`DRAWINGS_AT_ONCE`): an
 * upload that finds every slot taken skips drawing, and the previews job
 * waits for one.
 */
import { DRAWINGS_AT_ONCE } from './limits';

/** What a drawing gives when it found every slot taken and didn't wait. */
export const BUSY = Symbol('busy');

/** The drawings under way. */
let running = 0;

/** The drawings waiting for a slot, in the order they came. */
const waiting: (() => void)[] = [];

/**
 * Hands the slot of a drawing that ended to the next one waiting, or frees it.
 */
function release(): void {
  const next = waiting.shift();
  if (next) {
    next();
  } else {
    running -= 1;
  }
}

/**
 * Runs a drawing in a slot of its own.
 *
 * @param work - The drawing.
 * @param whenBusy - With every slot taken: `skip` gives {@link BUSY} at once,
 *   `wait` waits for a slot.
 * @returns What the drawing gives, or {@link BUSY}.
 */
export default async function inDrawingSlot<T>(
  work: () => Promise<T>,
  whenBusy: 'skip' | 'wait',
): Promise<T | typeof BUSY> {
  if (running >= DRAWINGS_AT_ONCE) {
    if (whenBusy === 'skip') {
      return BUSY;
    }
    // The slot passes straight from the drawing that ends to this one.
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  } else {
    running += 1;
  }
  try {
    return await work();
  } finally {
    release();
  }
}
