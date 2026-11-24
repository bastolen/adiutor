/**
 * @file Waits for the two animation frames that components wait for before
 * they move focus or scroll.
 */
import { act } from '@testing-library/react';

/**
 * Waits two animation frames inside `act`, as long as a component waits
 * before it restores focus or lands on a section.
 *
 * @returns When they've passed.
 */
export default async function nextFrames(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}
