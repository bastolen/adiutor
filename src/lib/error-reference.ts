/**
 * @file The short references error pages show, such as `7KQ2-M9XD`, for
 * users to send to an administrator, who finds the error under it in the
 * server log or the database. Sign-in errors draw a random one
 * (`createReference` in `src/server/error-reference.ts`); errors in the
 * app take theirs from Next's `digest` ({@link referenceFromDigest}), so the
 * error page and the server arrive at the same reference on their own.
 *
 * Pure and client-safe: it runs in the browser and on the server alike.
 */

/** Characters a reference is made of: no 0/O, 1/I/L, so it can be read out and typed. */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** How many characters a reference has (in two groups of four). */
export const REFERENCE_LENGTH = 8;

/** FNV-1a's 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * The starting values of the two hashes a reference is made of: FNV-1a's
 * own offset basis, and a second one so the two halves differ.
 */
const HASH_SEEDS = [0x811c9dc5, 0x5bd1e995] as const;

/**
 * Writes a reference's characters in two groups of four, e.g. `7KQ2-M9XD`.
 *
 * @param characters - {@link REFERENCE_LENGTH} characters from {@link REFERENCE_ALPHABET}.
 * @returns The reference.
 */
export function formatReference(characters: readonly string[]): string {
  return `${characters.slice(0, 4).join('')}-${characters.slice(4, REFERENCE_LENGTH).join('')}`;
}

/**
 * Reads a reference someone typed or pasted: case, spaces and dashes don't
 * matter (`7kq2 m9xd`, `7KQ2M9XD`), but every character must be one a
 * reference can have.
 *
 * @param input - What was typed.
 * @returns The reference as stored (`7KQ2-M9XD`), or `null` when it can't be one.
 */
export function parseErrorReference(input: string): string | null {
  const characters = [...input.toUpperCase().replace(/[\s-]/g, '')];
  if (
    characters.length !== REFERENCE_LENGTH ||
    !characters.every((character) => REFERENCE_ALPHABET.includes(character))
  ) {
    return null;
  }
  return formatReference(characters);
}

/* eslint-disable no-bitwise -- FNV-1a is defined with XOR and unsigned 32-bit multiplication. */
/**
 * Hashes text with 32-bit FNV-1a, the same in every JavaScript engine.
 *
 * @param text - The text.
 * @param seed - The starting value.
 * @returns The hash, an unsigned 32-bit integer.
 */
function fnv1a(text: string, seed: number): number {
  return Array.from(text).reduce(
    (hash, character) => Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV_PRIME) >>> 0,
    seed,
  );
}
/* eslint-enable no-bitwise */

/**
 * Turns a 32-bit hash into four characters of {@link REFERENCE_ALPHABET}
 * (31⁴ is far below 2³², so every character is as likely as the next).
 *
 * @param hash - An unsigned 32-bit integer.
 * @returns Four characters.
 */
function hashCharacters(hash: number): string[] {
  const base = REFERENCE_ALPHABET.length;
  return Array.from({ length: 4 }, (_, index) => {
    const digit = Math.floor(hash / base ** index) % base;
    return REFERENCE_ALPHABET.charAt(digit);
  });
}

/**
 * The reference of an error with a digest: always the same for the same
 * digest, in the browser and on the server, so the error page shows the
 * reference the server stored the error under without asking it. Different
 * errors can share a reference (or a digest), so a lookup can find several.
 *
 * @param digest - Next's `digest` of the error.
 * @returns The reference, e.g. `7KQ2-M9XD`.
 */
export function referenceFromDigest(digest: string): string {
  return formatReference(HASH_SEEDS.flatMap((seed) => hashCharacters(fnv1a(digest, seed))));
}

/**
 * Reads Next's `digest` from a thrown value, only when it's really there:
 * errors from the server have one, errors thrown in the browser don't, and
 * a thrown value doesn't have to be an object at all.
 *
 * @param error - The thrown value, as an error page or `onRequestError` gets it.
 * @returns The digest, or `null` when there's none.
 */
export function errorDigest(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('digest' in error)) {
    return null;
  }
  const { digest } = error;
  return typeof digest === 'string' && digest !== '' ? digest : null;
}
