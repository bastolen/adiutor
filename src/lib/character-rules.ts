/**
 * @file Checks for characters that never belong in text people type: control
 * characters, and characters that hide or reorder text. Shared by the input
 * validation (`validation.ts`), the name shown for a user
 * (`display-name.ts`), the request text cleaning (`requests/text.ts`) and
 * the server code that cleans untrusted text before a query or a log line
 * (`server/search.ts`, `server/app-errors.ts`), and free of dependencies so
 * all can import it, client components too.
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
 * Characters that hide or reorder text without being seen:
 *
 * - the text direction controls (U+061C, U+200E, U+200F, U+202A–U+202E,
 *   U+2066–U+2069);
 * - invisible characters: the zero-width space and no-break space (U+200B,
 *   U+FEFF), the word joiner and invisible operators (U+2060–U+2064), the
 *   unassigned and deprecated format characters after them (U+2065,
 *   U+206A–U+206F), the combining grapheme joiner (U+034F), the Khmer
 *   inherent vowels (U+17B4, U+17B5), the Mongolian vowel separator (U+180E)
 *   and the tag characters (U+E0000–U+E007F, which also costs the three flags
 *   written with them);
 * - the fillers, which are letters to Unicode and blank to the eye: Hangul
 *   (U+115F, U+1160, U+3164) and its half-width form (U+FFA0);
 * - the line and paragraph separators (U+2028, U+2029).
 *
 * With them, a name can reorder the text around it in an email, look like
 * another name, or show as nothing at all. The zero-width non-joiner and
 * joiner (U+200C, U+200D) are allowed: Persian, Arabic and Indic names, and
 * emoji sequences, need them. So is the variation selector that makes a
 * character an emoji (U+FE0F).
 *
 * The three that are combining marks (U+034F, U+17B4, U+17B5) come first in
 * the class: after another character, a mark reads as one combined character
 * with it (ESLint's `no-misleading-character-class`).
 */
export const HIDDEN_CHARACTER =
  /[\u{034F}\u{17B4}\u{17B5}\u{061C}\u{115F}\u{1160}\u{180E}\u{200B}\u{200E}\u{200F}\u{2028}-\u{202E}\u{2060}-\u{206F}\u{3164}\u{FEFF}\u{FFA0}\u{E0000}-\u{E007F}]/u;

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

/**
 * Every character that shows nothing by itself: the hidden characters
 * ({@link HIDDEN_CHARACTER}), control and format characters (`\p{Cc}`,
 * `\p{Cf}`: the joiners among them), separators (`\p{Z}`: every kind of
 * space), marks (`\p{M}`: accents and variation selectors, which only change
 * the character before them) and the blank Braille pattern (U+2800).
 */
const UNSEEN_CHARACTERS = new RegExp(
  `${HIDDEN_CHARACTER.source}|[\\p{Cc}\\p{Cf}\\p{Z}\\p{M}\\u{2800}]`,
  'gu',
);

/**
 * Whether a string has at least one character that can be seen: a letter, a
 * digit, punctuation or a symbol (an emoji is one). A name without one shows
 * as nothing in lists and emails, e.g. a name of only zero-width joiners,
 * which the hidden-character rule allows inside a name.
 *
 * @param value - The string to check.
 * @returns Whether anything of it can be seen.
 */
export function hasVisibleCharacter(value: string): boolean {
  return value.replace(UNSEEN_CHARACTERS, '') !== '';
}
