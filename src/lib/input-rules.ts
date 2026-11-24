/**
 * @file The parts of the input rules that client components need too: input
 * limits and the slug suggestion. Client components import them from here,
 * not from `validation.ts`, so zod and the schemas stay on the server; keep
 * this file free of zod (`src/client-imports.test.ts` checks it).
 */

/** The minimum length of a new password (`passwordSchema`, and Better Auth's `minPasswordLength`). */
export const MIN_PASSWORD_LENGTH = 12;

/** The maximum length of a new password (`passwordSchema`, Better Auth's `maxPasswordLength` and the password fields' `maxLength`). */
export const MAX_PASSWORD_LENGTH = 128;

/** The longest passkey name (`passkeyNameSchema`, and the name field on the Security page). */
export const PASSKEY_NAME_MAX_LENGTH = 64;

/**
 * The longest reason a staff member may give for signing in as a user
 * (`impersonationReasonSchema`, and the reason field's `maxLength`).
 */
export const IMPERSONATION_REASON_MAX_LENGTH = 200;

/** The most addresses one bulk invitation may contain (`inviteManyByEmail` and the invite form). */
export const MAX_BULK_INVITES = 20;

/**
 * The longest name: a person's, a company's or the staff's (`nameSchema`,
 * `companyNameSchema`, `staffNameSchema`, and those fields' `maxLength`).
 */
export const NAME_MAX_LENGTH = 100;

/** The longest title of a request (`requestTitleSchema`, and the title fields' `maxLength`). */
export const REQUEST_TITLE_MAX_LENGTH = 150;

/**
 * The longest description of a request and the longest reply to one
 * (`requestDescriptionSchema`, `requestReplySchema`, and those fields' `maxLength`).
 */
export const REQUEST_TEXT_MAX_LENGTH = 10_000;

/**
 * The longest prefix request numbers are shown with, "AD" in "AD-142"
 * (`requestPrefixSchema`, and the prefix field's `maxLength`).
 */
export const REQUEST_PREFIX_MAX_LENGTH = 5;

/** The longest name of a request type (`requestTypeNameSchema`, and its field's `maxLength`). */
export const REQUEST_TYPE_NAME_MAX_LENGTH = 40;

/**
 * The longest text that says what a request type is for
 * (`requestTypeDescriptionSchema`, and its field's `maxLength`).
 */
export const REQUEST_TYPE_DESCRIPTION_MAX_LENGTH = 200;

/** The longest URL name (`slugSchema`, `slugify`, and the URL name field's `maxLength`). */
export const SLUG_MAX_LENGTH = 60;

/** The longest error class name that is reported or stored (also the digest and route path of an error). */
export const ERROR_NAME_MAX_LENGTH = 100;

/** The longest error message that is reported or stored (`reportErrorAction` and `recordAppError`). */
export const ERROR_MESSAGE_MAX_LENGTH = 500;

/** The longest page path that is reported or stored (`reportErrorAction` and `recordAppError`). */
export const ERROR_PATH_MAX_LENGTH = 300;

/**
 * A name's Latin letters and digits, for a key or a slug made from it:
 * without accents (`NFKD`), in lower case, with one separator for every
 * other run of characters and none at either end. A script without a Latin
 * form leaves nothing.
 *
 * @param name - The name.
 * @param separator - What goes between the words.
 * @returns The words, e.g. `adiutor-b-v` for "Adiutor B.V." with `-`.
 */
export function latinWords(name: string, separator: '-' | '_'): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, 'g'), '');
}

/**
 * Turns a company name into a slug suggestion, e.g. "Adiutor B.V." → "adiutor-b-v".
 *
 * @param name - The company name.
 * @returns A slug made of lower-case letters, digits and dashes.
 */
export function slugify(name: string): string {
  return latinWords(name, '-').slice(0, SLUG_MAX_LENGTH);
}
