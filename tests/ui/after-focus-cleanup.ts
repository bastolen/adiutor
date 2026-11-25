/**
 * @file Waits out what Radix does with focus as a menu or dialog unmounts.
 */

/**
 * Waits for Radix's focus clean-up on the way out of a menu or dialog (it
 * hands the focus back in a timer of its own), so a test can check that
 * nothing takes the focus from the text afterwards. A short real pause is the
 * point: flushing effects alone doesn't reach that timer.
 *
 * @returns A promise that settles once the clean-up has had its time.
 */
export default function afterFocusCleanup(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
}
