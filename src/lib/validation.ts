/**
 * @file Shared input validation (zod schemas) for forms, server actions and
 * the auth guards (`src/server/auth/auth-guards/`). Server only in
 * practice: client components take the limits they need from
 * `input-rules.ts`, so zod never ships to the browser
 * (`src/client-imports.test.ts`).
 *
 * Every issue's message is a key in the `validation` catalogue, one whole
 * sentence per field and problem; a limit's number comes from the issue
 * (`minimum`, `maximum`). `runAction` translates the first issue into the
 * reader's language (`validationErrorMessage` in `src/server/errors.ts`).
 */
import type { MessageKeys, NestedKeyOf } from 'use-intl/core';
import { z } from 'zod';

import { COMPANY_ROLES, isRole, PLATFORM_ROLES } from './authz/roles';
import { LOCALES } from './i18n/locales';
import type { Messages } from './i18n/messages';
import {
  MIN_PASSWORD_LENGTH,
  NAME_MAX_LENGTH,
  PASSKEY_NAME_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from './input-rules';

/**
 * A message of the `validation` catalogue, by its full key (e.g.
 * `validation.email`): what an issue's message, or a service error about
 * input, says. TypeScript checks it against the English (US) catalogue.
 */
export type ValidationMessageKey = `validation.${MessageKeys<
  Messages['validation'],
  NestedKeyOf<Messages['validation']>
>}`;

/** An email address, trimmed and lower-cased so it matches stored addresses. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'validation.email' satisfies ValidationMessageKey }));

/** A database ID (UUID). */
export const idSchema = z.uuid({ error: 'validation.id' satisfies ValidationMessageKey });

/** A role ID. Whether it fits the company is checked separately. */
export const roleSchema = z
  .string()
  .refine(isRole, { error: 'validation.role' satisfies ValidationMessageKey });

/**
 * Why a role that isn't a company role is refused where a company role is
 * needed: the message key, for zod and for service errors alike.
 */
export const CHOOSE_COMPANY_ROLE_MESSAGE = 'validation.companyRole' satisfies ValidationMessageKey;

/**
 * Why a role that isn't a staff role is refused where a staff role is
 * needed: the message key, for zod and for service errors alike.
 */
export const CHOOSE_STAFF_ROLE_MESSAGE = 'validation.staffRole' satisfies ValidationMessageKey;

/** A language (one of `LOCALES`), e.g. from the account's language select or an invite form. */
export const localeSchema = z.enum(LOCALES, {
  error: 'validation.locale' satisfies ValidationMessageKey,
});

/** A company role (Admin, Client or Watcher), e.g. from a member's role select. */
export const companyRoleSchema = z.enum(COMPANY_ROLES, { error: CHOOSE_COMPANY_ROLE_MESSAGE });

/** A staff role, e.g. from the staff page's role select. */
export const staffRoleSchema = z.enum(PLATFORM_ROLES, { error: CHOOSE_STAFF_ROLE_MESSAGE });

/**
 * Whether a string contains a control character (C0 or C1, e.g. a line break
 * or tab) that never belongs in a display name. A character check avoids a
 * control-character regex literal.
 *
 * @param value - The string to check.
 * @returns Whether any character is a control character.
 */
function hasControlCharacter(value: string): boolean {
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
const HIDDEN_CHARACTER =
  /[\u{061C}\u{200B}\u{200E}\u{200F}\u{2028}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/u;

/**
 * Whether a string contains a character that hides or reorders text
 * ({@link HIDDEN_CHARACTER}).
 *
 * @param value - The string to check.
 * @returns Whether it contains one.
 */
function hasHiddenCharacter(value: string): boolean {
  return HIDDEN_CHARACTER.test(value);
}

/** Every format character (`\p{Cf}`), removed from the copy the web-address check reads. */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/**
 * Full stops that look like `.` but aren't, which mail clients and browsers
 * may still read as one: ideographic (U+3002, and U+FE12 and U+FF61, which
 * NFKC turns into it), full-width (U+FF0E), one dot leader (U+2024) and
 * small (U+FE52). NFKC maps the last three to `.` already, but not U+3002.
 */
const LOOKALIKE_DOTS = /[\u{2024}\u{3002}\u{FE12}\u{FE52}\u{FF0E}\u{FF61}]/gu;

/**
 * Turns a name into the form the web-address check reads: without format
 * characters (so a zero-width space can't split a domain), NFKC-normalised
 * (full-width letters, digits, colons and slashes become plain ones) and with
 * look-alike full stops as `.`.
 *
 * @param value - The name.
 * @returns The copy to check.
 */
function webAddressForm(value: string): string {
  return value.replace(FORMAT_CHARACTERS, '').normalize('NFKC').replace(LOOKALIKE_DOTS, '.');
}

/**
 * A web address in a name: a scheme (`https://`), a `www.` token, or a bare
 * domain in any script (`adiutor.dev`, or one spelled with Cyrillic
 * look-alike letters): a letter or digit, a dot and at least two letters.
 * Names never contain these, and when they do they turn into clickable links
 * in the plain-text emails that quote the name: a phishing aid. Initials and
 * abbreviations (`J.R.R. Tolkien`, `Adiutor B.V.`) pass, as no two letters
 * follow a dot.
 */
const WEB_ADDRESS =
  /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?\.\p{L}[\p{L}\p{M}]+/iu;

/** An IPv4 address in a name (`203.0.113.7`), which mail clients turn into a link too. */
const IPV4_ADDRESS = /\d{1,3}(?:\.\d{1,3}){3}/;

/**
 * Whether a name contains a web address or an IPv4 address, also when it's
 * written with look-alike dots, full-width characters or invisible
 * characters inside it ({@link webAddressForm}).
 *
 * @param value - The name.
 * @returns Whether it contains one.
 */
function containsWebAddress(value: string): boolean {
  const form = webAddressForm(value);
  return WEB_ADDRESS.test(form) || IPV4_ADDRESS.test(form);
}

/**
 * The names people choose, each with its own messages in the `validation`
 * catalogue (`validation.<field>.controlCharacters`, ...), since forms show
 * one message above all their fields, so it must say which one it's about.
 */
type NameField = 'name' | 'companyName' | 'staffName' | 'passkeyName';

/**
 * Adds the shared character rules to a string schema: no control characters
 * and nothing that hides or reorders text. For every name people choose
 * (display names, company names, the staff name and passkey names).
 *
 * @param schema - The length-checked schema.
 * @param field - Which name it is, for the messages (e.g. `companyName`).
 * @returns The schema with the extra checks.
 */
function withCharacterSafety<T extends z.ZodType<string>>(schema: T, field: NameField) {
  return schema
    .refine((value) => !hasControlCharacter(value), {
      error: `validation.${field}.controlCharacters` satisfies ValidationMessageKey,
    })
    .refine((value) => !hasHiddenCharacter(value), {
      error: `validation.${field}.hiddenCharacters` satisfies ValidationMessageKey,
    });
}

/**
 * Adds the shared display-name rules to a string schema: the character rules
 * ({@link withCharacterSafety}) and no web addresses, since these names are
 * quoted in emails.
 *
 * @param schema - The length-checked name schema.
 * @param field - Which name it is, for the messages (e.g. `name`).
 * @returns The schema with the extra checks.
 */
function withNameSafety<T extends z.ZodType<string>>(
  schema: T,
  field: Exclude<NameField, 'passkeyName'>,
) {
  return withCharacterSafety(schema, field).refine((value) => !containsWebAddress(value), {
    error: `validation.${field}.webAddress` satisfies ValidationMessageKey,
  });
}

/**
 * A trimmed string between two lengths, whose messages name the field (e.g.
 * "Use at most 100 characters for the company name."). The messages get the
 * limit from the issue (`{minimum}`, `{maximum}`).
 *
 * @param limits - The lengths and their messages.
 * @param limits.min - The shortest allowed.
 * @param limits.max - The longest allowed.
 * @param limits.tooShort - The message when it's shorter (e.g. "Enter your name." where the shortest is 1).
 * @param limits.tooLong - The message when it's longer.
 * @returns The schema.
 */
function lengthLimited(limits: {
  min: number;
  max: number;
  tooShort: ValidationMessageKey;
  tooLong: ValidationMessageKey;
}) {
  return z
    .string()
    .trim()
    .min(limits.min, { error: limits.tooShort })
    .max(limits.max, { error: limits.tooLong });
}

/** A person's display name. */
export const nameSchema = withNameSafety(
  lengthLimited({
    min: 1,
    max: NAME_MAX_LENGTH,
    tooShort: 'validation.name.empty',
    tooLong: 'validation.name.tooLong',
  }),
  'name',
);

/** A new password: at least `MIN_PASSWORD_LENGTH` characters, at most Better Auth's 128. */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    error: 'validation.password.tooShort' satisfies ValidationMessageKey,
  })
  .max(128, { error: 'validation.password.tooLong' satisfies ValidationMessageKey });

/** A company name. */
export const companyNameSchema = withNameSafety(
  lengthLimited({
    min: 2,
    max: NAME_MAX_LENGTH,
    tooShort: 'validation.companyName.tooShort',
    tooLong: 'validation.companyName.tooLong',
  }),
  'companyName',
);

/**
 * The staff name, shown to users: the same rules as a company name, with
 * messages that name it as the forms do ("the name shown to users").
 */
export const staffNameSchema = withNameSafety(
  lengthLimited({
    min: 2,
    max: NAME_MAX_LENGTH,
    tooShort: 'validation.staffName.tooShort',
    tooLong: 'validation.staffName.tooLong',
  }),
  'staffName',
);

/**
 * A passkey's name, e.g. "Work laptop": trimmed, 1 to
 * `PASSKEY_NAME_MAX_LENGTH` characters, with the character rules of
 * names (no control characters, nothing that hides or reorders text). It
 * isn't quoted in emails, so web addresses aren't refused. The auth guards
 * check it where Better Auth's passkey plugin takes a name.
 */
export const passkeyNameSchema = withCharacterSafety(
  lengthLimited({
    min: 1,
    max: PASSKEY_NAME_MAX_LENGTH,
    tooShort: 'validation.passkeyName.empty',
    tooLong: 'validation.passkeyName.tooLong',
  }),
  'passkeyName',
);

/**
 * A company's URL name, the part of its address after `/companies/`:
 * lower-case letters, digits and single dashes, and nothing that looks like
 * an ID (the address takes those too).
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'validation.slug.format' satisfies ValidationMessageKey,
  })
  // The company's address takes its ID or its URL name, so a URL name can't look like an ID.
  .refine((value) => !idSchema.safeParse(value).success, {
    error: 'validation.slug.looksLikeId' satisfies ValidationMessageKey,
  })
  .max(SLUG_MAX_LENGTH, { error: 'validation.slug.tooLong' satisfies ValidationMessageKey });
