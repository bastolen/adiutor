/**
 * @file Checks for characters that never belong in text people type: control
 * characters, and characters that hide or reorder text. Shared by the input
 * validation (`validation.ts`), the request text cleaning
 * (`requests/text.ts`) and the server code that cleans untrusted text before
 * a query or a log line (`server/search.ts`, `server/app-errors.ts`), and
 * free of dependencies so all can import it.
 */

/**
 * Whether a character is a control character: C0 (U+0000 to U+001F, e.g. NUL,
 * a line break or a tab), delete (U+007F) or C1 (U+0080 to U+009F). A check
 * on the code avoids a control-character regex literal.
 *
 * @param code - The character's code.
 * @returns Whether it's a control character.
 */
function isControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * Whether a string contains a control character (C0 or C1, e.g. a line break
 * or tab) that never belongs in a display name.
 *
 * @param value - The string to check.
 * @returns Whether any character is a control character.
 */
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (isControlCode(value.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

/**
 * Takes the control characters ({@link hasControlCharacter}) out of a string,
 * for text that goes where they do harm: Postgres refuses a NUL character in
 * a query, and a line break in a log line starts a line of its own.
 *
 * @param value - The string.
 * @param replacement - What each run of control characters becomes; nothing by default.
 * @returns The string without control characters.
 */
export function withoutControlCharacters(value: string, replacement = ''): string {
  let cleaned = '';
  let inRun = false;
  for (let i = 0; i < value.length; i += 1) {
    const control = isControlCode(value.charCodeAt(i));
    if (!control) {
      cleaned += value.charAt(i);
    } else if (!inRun) {
      cleaned += replacement;
    }
    inRun = control;
  }
  return cleaned;
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
