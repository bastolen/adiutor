/**
 * @file Steps that run one after another, for the end-to-end tests: a browser
 * tab (or a database connection) does one thing at a time, so what ESLint's
 * `no-await-in-loop` guards against is how these steps work. Use these
 * instead of a `for` loop with a disabled rule or a `reduce` chain of promises.
 */

/**
 * Runs a step for each item, one after another: the steps share one browser
 * tab (or one connection), so they can't run side by side, and each may
 * depend on the one before it.
 *
 * @param items - What to run the step for.
 * @param step - The step, given the item and its place in the list.
 */
export async function inOrder<T>(
  items: Iterable<T>,
  step: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop -- Steps in one tab run one after another by nature.
    await step(item, index);
    index += 1;
  }
}

/**
 * Runs a step a number of times, one after another ({@link inOrder}).
 *
 * @param times - How many times.
 * @param step - The step, given which time it is (from 0).
 */
export async function repeatInOrder(
  times: number,
  step: (index: number) => Promise<void>,
): Promise<void> {
  await inOrder(
    Array.from({ length: times }, (_, index) => index),
    step,
  );
}
