/**
 * @file Checks for characters that never belong in text people type: control
 * characters, and characters that hide or reorder text. Shared by the input
 * validation (`validation.ts`) and the request text cleaning
 * (`requests/text.ts`), and free of dependencies so both can import it.
 */

/**
 * Whether a string contains a control character (C0 or C1, e.g. a line break
 * or tab) that never belongs in a display name. A character check avoids a
 * control-character regex literal.
 *
 * @param value - The string to check.
 * @returns Whether any character is a control character.
 */
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/**
 * Characters that hide or reorder text without being seen: the text direction
 * controls (U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), invisible
 * characters (U+200B, U+2060–U+2064, U+FEFF) and the line and paragraph
 * separators (U+2028, U+2029). With them, a name can reorder the text around
 * it in an email or look like another name. The zero-width non-joiner and
 * joiner (U+200C, U+200D) are allowed: Persian, Arabic and Indic names, and
 * emoji sequences, need them.
 */
export const HIDDEN_CHARACTER =
  /[\u{061C}\u{200B}\u{200E}\u{200F}\u{2028}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/u;

/**
 * Whether a string contains a character that hides or reorders text
 * ({@link HIDDEN_CHARACTER}).
 *
 * @param value - The string to check.
 * @returns Whether it contains one.
 */
export function hasHiddenCharacter(value: string): boolean {
  return HIDDEN_CHARACTER.test(value);
}
