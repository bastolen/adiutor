/**
 * @file Draws the random reference that errors get (`7KQ2-M9XD`): sign-in
 * errors, errors in the app that have no digest to take one from, and the
 * sample errors script. The format and the digest-based references are in
 * `src/lib/error-reference.ts`.
 */
import { randomInt } from 'node:crypto';

import { formatReference, REFERENCE_ALPHABET, REFERENCE_LENGTH } from '@/lib/error-reference';

/**
 * Draws a new random reference: eight characters from `REFERENCE_ALPHABET`
 * in two groups, e.g. `7KQ2-M9XD` (`src/lib/error-reference.ts`, so it
 * looks like the references of other errors).
 *
 * @returns The reference.
 */
export function createReference(): string {
  return formatReference(
    Array.from({ length: REFERENCE_LENGTH }, () =>
      REFERENCE_ALPHABET.charAt(randomInt(REFERENCE_ALPHABET.length)),
    ),
  );
}
