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
import { hasControlCharacter, hasHiddenCharacter, hasVisibleCharacter } from './character-rules';
import { FOLLOW_DEFAULT, LOCALES } from './i18n/locales';
import type { Messages } from './i18n/messages';
import { isTimeZone } from './i18n/time-zones';
import {
  IMPERSONATION_REASON_MAX_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  NAME_MAX_LENGTH,
  PASSKEY_NAME_MAX_LENGTH,
  REQUEST_TEXT_MAX_LENGTH,
  REQUEST_TITLE_MAX_LENGTH,
  REQUEST_TYPE_DESCRIPTION_MAX_LENGTH,
  REQUEST_TYPE_NAME_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from './input-rules';
import {
  cleanMultilineText,
  REQUEST_PREFIX_PATTERN,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_TYPE_KEY_PATTERN,
} from './requests';

/**
 * A message of the `validation` catalogue, by its full key (e.g.
 * `validation.email`): what an issue's message, or a service error about
 * input, says. TypeScript checks it against the English (US) catalogue.
 */
export type ValidationMessageKey = `validation.${MessageKeys<
  Messages['validation'],
  NestedKeyOf<Messages['validation']>
>}`;

/**
 * An email address, trimmed and lower-cased so it matches stored addresses
 * (the same normalization as `normalizeEmail` in `email-address.ts`).
 */
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

/** A language (one of `LOCALES`), e.g. from an invite form or the staff page's default language. */
export const localeSchema = z.enum(LOCALES, {
  error: 'validation.locale' satisfies ValidationMessageKey,
});

/**
 * Adiutor's languages from the staff page: the default language and the
 * languages to offer (any of `LOCALES`; the service adds the default).
 */
export const languageSettingsSchema = z.object({
  defaultLocale: localeSchema,
  offered: z.array(localeSchema),
});

/**
 * A language choice: a language, or `FOLLOW_DEFAULT` to follow Adiutor's
 * default language, e.g. from the account's Language card.
 */
export const languageChoiceSchema = z.enum([FOLLOW_DEFAULT, ...LOCALES], {
  error: 'validation.locale' satisfies ValidationMessageKey,
});

/**
 * A time zone Adiutor accepts (`isTimeZone`: an IANA name the runtime knows,
 * or `UTC`), e.g. from the account's Time zone card or the staff page's
 * default zone.
 */
export const timeZoneSchema = z
  .string()
  .refine(isTimeZone, { error: 'validation.timeZone' satisfies ValidationMessageKey });

/** A company role (Admin, Client or Watcher), e.g. from a member's role select. */
export const companyRoleSchema = z.enum(COMPANY_ROLES, { error: CHOOSE_COMPANY_ROLE_MESSAGE });

/** A staff role, e.g. from the staff page's role select. */
export const staffRoleSchema = z.enum(PLATFORM_ROLES, { error: CHOOSE_STAFF_ROLE_MESSAGE });

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
 * The names and short texts people choose, each with its own messages in the
 * `validation` catalogue (`validation.<field>.controlCharacters`, ...), since
 * forms show one message above all their fields, so it must say which one
 * it's about.
 */
type NameField =
  | 'name'
  | 'companyName'
  | 'staffName'
  | 'passkeyName'
  | 'impersonationReason'
  | 'requestTitle'
  | 'requestTypeName'
  | 'requestTypeDescription';

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
 * ({@link withCharacterSafety}), at least one character that can be seen
 * (`hasVisibleCharacter`: a name of only joiners or accents would show as
 * nothing in lists and emails) and no web addresses, since these names are
 * quoted in emails.
 *
 * @param schema - The length-checked name schema.
 * @param field - Which name it is, for the messages (e.g. `name`).
 * @returns The schema with the extra checks.
 */
function withNameSafety<T extends z.ZodType<string>>(
  schema: T,
  field: Exclude<
    NameField,
    'passkeyName' | 'impersonationReason' | 'requestTitle' | 'requestTypeDescription'
  >,
) {
  return withCharacterSafety(schema, field)
    .refine((value) => hasVisibleCharacter(value), {
      error: `validation.${field}.noVisibleCharacter` satisfies ValidationMessageKey,
    })
    .refine((value) => !containsWebAddress(value), {
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

/** A new password: at least `MIN_PASSWORD_LENGTH` characters, at most `MAX_PASSWORD_LENGTH` (Better Auth's own limit). */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, {
    error: 'validation.password.tooShort' satisfies ValidationMessageKey,
  })
  .max(MAX_PASSWORD_LENGTH, {
    error: 'validation.password.tooLong' satisfies ValidationMessageKey,
  });

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
 * Why a staff member signs in as a user, if they say: trimmed, at most
 * `IMPERSONATION_REASON_MAX_LENGTH` characters, with the character rules of
 * names (no line breaks or control characters, nothing that hides or
 * reorders text). Only staff see it, in the audit log, and it's never quoted
 * in emails, so web addresses (a link to a ticket) are fine. Empty means no
 * reason (`null`).
 */
export const impersonationReasonSchema = withCharacterSafety(
  z
    .string()
    .trim()
    .max(IMPERSONATION_REASON_MAX_LENGTH, {
      error: 'validation.impersonationReason.tooLong' satisfies ValidationMessageKey,
    }),
  'impersonationReason',
).transform((value) => value || null);

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

/**
 * A request's title: one line, trimmed, 1 to `REQUEST_TITLE_MAX_LENGTH`
 * characters, with the character rules of names (no line breaks or control
 * characters, nothing that hides or reorders text). Web addresses are fine
 * ("portal.adiutor.dev is down" is an ordinary title); a title is never shown
 * as a link.
 */
export const requestTitleSchema = withCharacterSafety(
  lengthLimited({
    min: 1,
    max: REQUEST_TITLE_MAX_LENGTH,
    tooShort: 'validation.requestTitle.empty',
    tooLong: 'validation.requestTitle.tooLong',
  }),
  'requestTitle',
);

/**
 * A text of several lines, cleaned before its length is checked
 * (`cleanMultilineText`: line endings as a form sends them become line
 * breaks, and characters nobody can see are dropped rather than refused), so
 * what's stored is what's counted.
 *
 * @param messages - The messages that name the field.
 * @param messages.empty - The message when nothing is left to save.
 * @param messages.tooLong - The message when it's longer than `REQUEST_TEXT_MAX_LENGTH`.
 * @returns The schema.
 */
function multilineText(messages: { empty: ValidationMessageKey; tooLong: ValidationMessageKey }) {
  return z
    .string()
    .transform(cleanMultilineText)
    .pipe(
      z
        .string()
        .min(1, { error: messages.empty })
        .max(REQUEST_TEXT_MAX_LENGTH, { error: messages.tooLong }),
    );
}

/** A request's description: plain text of several lines, at most `REQUEST_TEXT_MAX_LENGTH` characters. */
export const requestDescriptionSchema = multilineText({
  empty: 'validation.requestDescription.empty',
  tooLong: 'validation.requestDescription.tooLong',
});

/** A reply to a request: plain text of several lines, at most `REQUEST_TEXT_MAX_LENGTH` characters. */
export const requestReplySchema = multilineText({
  empty: 'validation.requestReply.empty',
  tooLong: 'validation.requestReply.tooLong',
});

/**
 * The company a request is raised in, as the form sends it: its URL name or
 * its ID, trimmed. It only checks that one was chosen (the select starts
 * empty for whoever has several to choose from); which company it is, and
 * whether its reader may see it, isn't a rule of the field.
 */
export const requestCompanySchema = z
  .string({ error: 'validation.requestCompany' satisfies ValidationMessageKey })
  .trim()
  .min(1, { error: 'validation.requestCompany' satisfies ValidationMessageKey });

/**
 * A request type's key, e.g. from the form that raises one. Only its form is
 * checked here: whether a type with that key exists, and may be chosen, is
 * for the services, which look it up.
 */
export const requestTypeSchema = z
  .string()
  .trim()
  .regex(REQUEST_TYPE_KEY_PATTERN, {
    error: 'validation.requestType' satisfies ValidationMessageKey,
  });

/** A request type's name, which the staff choose: one text for every language. */
export const requestTypeNameSchema = withNameSafety(
  lengthLimited({
    min: 1,
    max: REQUEST_TYPE_NAME_MAX_LENGTH,
    tooShort: 'validation.requestTypeName.empty',
    tooLong: 'validation.requestTypeName.tooLong',
  }),
  'requestTypeName',
);

/** What a request type is for, shown with it when a request is raised: one line. */
export const requestTypeDescriptionSchema = withCharacterSafety(
  lengthLimited({
    min: 1,
    max: REQUEST_TYPE_DESCRIPTION_MAX_LENGTH,
    tooShort: 'validation.requestTypeDescription.empty',
    tooLong: 'validation.requestTypeDescription.tooLong',
  }),
  'requestTypeDescription',
);

/** A request's priority, which only staff choose. */
export const requestPrioritySchema = z.enum(REQUEST_PRIORITIES, {
  error: 'validation.requestPriority' satisfies ValidationMessageKey,
});

/** A request's status, e.g. from the status select on its page. */
export const requestStatusSchema = z.enum(REQUEST_STATUSES, {
  error: 'validation.requestStatus' satisfies ValidationMessageKey,
});

/**
 * The prefix request numbers are shown with ("AD" in "AD-142"): one to five
 * letters or digits starting with a letter, saved in capitals.
 */
export const requestPrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(REQUEST_PREFIX_PATTERN, {
    error: 'validation.requestPrefix' satisfies ValidationMessageKey,
  });
