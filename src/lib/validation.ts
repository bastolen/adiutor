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
import { isHexColour, tidyHexColour } from './branding';
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
  WEBHOOK_NAME_MAX_LENGTH,
  WEBHOOK_URL_MAX_LENGTH,
} from './input-rules';
import {
  ACTIVITY_GROUPS,
  ACTIVITY_ORDERS,
  cleanMultilineText,
  REQUEST_PREFIX_PATTERN,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_TYPE_KEY_PATTERN,
} from './requests';
import { DEFAULT_SMTP_PORTS, SMTP_FIELD_MAX_LENGTH, SMTP_SECURITIES } from './smtp';
import {
  DEFAULT_S3_REGION,
  DEFAULT_SFTP_PORT,
  HOST_KEY_PATTERN,
  S3_BUCKET_PATTERN,
  PRIVATE_KEY_MAX_LENGTH,
  STORAGE_FIELD_MAX_LENGTH,
} from './storage';
import { FORCED_THEMES, type ForcedTheme, THEME_MODE_CHOICES } from './theme';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_FORMATS,
  type WebhookUrlProblem,
  webhookUrlProblem,
} from './webhooks';

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
 * The longest text taken as an email address: 64 characters before the @
 * and 255 after (RFC 5321), more than any address that can receive mail has
 * (254). {@link emailSchema} refuses a longer one, so no stored address is
 * longer, and {@link plausibleEmail} checks it before the pattern runs.
 */
export const EMAIL_MAX_LENGTH = 320;

/**
 * An email address, trimmed and lower-cased so it matches stored addresses
 * (the same normalization as `normalizeEmail` in `email-address.ts`), and at
 * most {@link EMAIL_MAX_LENGTH} characters: a longer one is refused as not
 * an address, before the pattern runs.
 */
export const emailSchema = z
  .string()
  .trim()
  .max(EMAIL_MAX_LENGTH, { error: 'validation.email' satisfies ValidationMessageKey, abort: true })
  .toLowerCase()
  .pipe(z.email({ error: 'validation.email' satisfies ValidationMessageKey }));

/**
 * An email address a client sent without any check (the guards before Better
 * Auth's requests, the reactions after them), as it's compared and keyed
 * (trimmed and lower-cased, as {@link emailSchema} gives it), when it's a
 * plausible one: at most {@link EMAIL_MAX_LENGTH} characters and an address
 * by {@link emailSchema}. Anything else counts as no address, so it never
 * becomes a rate limit key or lands in the audit log. Better Auth's own
 * check of an address (zod's `z.email()`, the same pattern) refuses more,
 * since it doesn't trim first, so every address it would take passes here
 * as long as it's no longer than the limit.
 *
 * @param value - What the client sent as the address, unchecked.
 * @returns The address, or `null` for anything that isn't a plausible one.
 */
export function plausibleEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > EMAIL_MAX_LENGTH) {
    return null;
  }
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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

/** A language (one of `LOCALES`), e.g. from an invite form or the default language in Settings. */
export const localeSchema = z.enum(LOCALES, {
  error: 'validation.locale' satisfies ValidationMessageKey,
});

/**
 * Adiutor's languages from Settings: the default language and the
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
 * or `UTC`), e.g. from the account's Time zone card or the default zone
 * in Settings.
 */
export const timeZoneSchema = z
  .string()
  .refine(isTimeZone, { error: 'validation.timeZone' satisfies ValidationMessageKey });

/**
 * A colour in six hex digits, with or without `#`, in any case. It's kept as
 * `#` and six lower-case digits, the only colour format branding writes into
 * CSS.
 *
 * @param error - The message when it isn't one.
 * @returns The schema.
 */
function hexColourSchema(error: ValidationMessageKey) {
  return z.string().transform(tidyHexColour).refine(isHexColour, { error });
}

/** A brand colour as the `brand.*` settings keep it (decision 0049). */
export const brandColourSchema = hexColourSchema('validation.brandColour.invalid');

/**
 * A brand colour from the General tab of Settings: empty for the theme's
 * own (`null`).
 *
 * @param error - The message when it isn't a colour, naming the field.
 * @returns The schema.
 */
function chosenBrandColourSchema(error: ValidationMessageKey) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    hexColourSchema(error).nullable(),
  );
}

/**
 * The brand colours from the General tab of Settings: the accent, the
 * accent for dark mode (with or without an accent) and the tint, each empty
 * for the theme's own.
 */
export const brandColoursSchema = z.object({
  accent: chosenBrandColourSchema('validation.brandColour.accent'),
  accentDark: chosenBrandColourSchema('validation.brandColour.accentDark'),
  tint: chosenBrandColourSchema('validation.brandColour.tint'),
});

/** A mode a staff Admin keeps every page in, as `brand.forced_theme` keeps it (decision 0053). */
export const forcedThemeSchema = z.enum(FORCED_THEMES, { error: 'validation.themeMode' });

/**
 * The choice on the General tab of Settings: both modes, kept as none
 * (`null`), or one only.
 */
export const themeModeChoiceSchema = z
  .enum(THEME_MODE_CHOICES, { error: 'validation.themeMode' })
  .transform((choice): ForcedTheme | null => (choice === 'both' ? null : choice));

/** A company role (Admin, Client or Watcher), e.g. from a member's role select. */
export const companyRoleSchema = z.enum(COMPANY_ROLES, { error: CHOOSE_COMPANY_ROLE_MESSAGE });

/** A staff role, e.g. from the role select in the staff settings. */
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
 *
 * Written so its time grows in proportion to the text, whatever it holds: no
 * part of it can be tried again from every character of a long run.
 * - A scheme is found at its `://` and only then read backwards (the
 *   lookbehind): a word that starts with a letter, of letters, digits, `+`,
 *   `.` and `-`. Read forwards, from every word, a long run without a `://`
 *   would be read to its end once per word in it.
 * - A domain is matched from the end of the label before its dot: a letter
 *   or digit, any accents (marks) and dashes after it as long as the last
 *   isn't a dash, the dot and two letters. What comes before that in the
 *   label doesn't change whether there's a match, and reading the whole
 *   label from every letter of a long word without a dot would read the
 *   rest of the word each time.
 */
const WEB_ADDRESS =
  /:\/\/(?<=\b[a-z][a-z0-9+.-]*:\/\/)|\bwww\.|[\p{L}\p{N}][\p{M}-]*(?<!-)\.\p{L}[\p{L}\p{M}]/iu;

/** An IPv4 address in a name (`203.0.113.7`), which mail clients turn into a link too. */
const IPV4_ADDRESS = /\d{1,3}(?:\.\d{1,3}){3}/;

/**
 * Whether a name contains a web address or an IPv4 address, also when it's
 * written with look-alike dots, full-width characters or invisible
 * characters inside it ({@link webAddressForm}). A name with neither a dot
 * nor a `://` in that form can't hold one, so most names are let through
 * without running the patterns. Exported for its unit test.
 *
 * @param value - The name.
 * @returns Whether it contains one.
 */
export function containsWebAddress(value: string): boolean {
  const form = webAddressForm(value);
  if (!form.includes('.') && !form.includes('://')) {
    return false;
  }
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
  | 'requestTypeDescription'
  | 'webhookName';

/**
 * Adds the shared character rules to a string schema: no control characters
 * and nothing that hides or reorders text. For the names people choose
 * (display, company, staff and passkey names) and other short texts: a request's title, a request
 * type's description and a reason for signing in as a user.
 *
 * @param schema - The length-checked schema, whose length check ends the check when it refuses
 *   (`abort`, as {@link lengthLimited} does), so these rules never read a text that's too long.
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
 * @param schema - The length-checked name schema ({@link lengthLimited}), so these rules never
 *   read a text that's too long.
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
 * A length it refuses ends the check there (`abort`): the rules added after
 * it ({@link withCharacterSafety}, {@link withNameSafety}) never read a text
 * of the wrong length. A form or an action can send up to a megabyte, and
 * zod would otherwise run every later rule on all of it.
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
    .min(limits.min, { error: limits.tooShort, abort: true })
    .max(limits.max, { error: limits.tooLong, abort: true });
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
 * reason (`null`). A reason that's too long is refused before the character
 * rules read it (`abort`, as in `lengthLimited`).
 */
export const impersonationReasonSchema = withCharacterSafety(
  z
    .string()
    .trim()
    .max(IMPERSONATION_REASON_MAX_LENGTH, {
      error: 'validation.impersonationReason.tooLong' satisfies ValidationMessageKey,
      abort: true,
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

/** A request's description: Markdown text of several lines, at most `REQUEST_TEXT_MAX_LENGTH` characters. */
export const requestDescriptionSchema = multilineText({
  empty: 'validation.requestDescription.empty',
  tooLong: 'validation.requestDescription.tooLong',
});

/** A reply to a request: Markdown text of several lines, at most `REQUEST_TEXT_MAX_LENGTH` characters. */
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
 * How someone reads a request's activity, from the menus on its page: its
 * order, the groups it shows (`null` for everything), or both. The menus only
 * send values they offer, so anything else is refused without a message of
 * its own.
 */
export const activityViewSchema = z.object(
  {
    order: z
      .enum(ACTIVITY_ORDERS, { error: 'validation.checkInput' satisfies ValidationMessageKey })
      .optional(),
    groups: z
      .array(
        z.enum(ACTIVITY_GROUPS, { error: 'validation.checkInput' satisfies ValidationMessageKey }),
      )
      .max(ACTIVITY_GROUPS.length, {
        error: 'validation.checkInput' satisfies ValidationMessageKey,
      })
      .nullable()
      .optional(),
  },
  { error: 'validation.checkInput' satisfies ValidationMessageKey },
);

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

/**
 * A text field of a storage's settings: trimmed, 1 to
 * `STORAGE_FIELD_MAX_LENGTH` characters.
 *
 * @param message - What to say when it's empty or too long.
 * @returns The schema.
 */
function storageText(message: ValidationMessageKey) {
  return z
    .string({ error: message })
    .trim()
    .min(1, { error: message })
    .max(STORAGE_FIELD_MAX_LENGTH, { error: message });
}

/** An S3 bucket's name, by S3's own rules (`S3_BUCKET_PATTERN`). */
const storageBucketSchema = storageText('validation.storage.bucket').regex(S3_BUCKET_PATTERN, {
  error: 'validation.storage.bucketName' satisfies ValidationMessageKey,
});

/** A storage's folder, on the server or over SFTP: an absolute path (`storageProblems` checks it). */
const storageFolderSchema = storageText('validation.storage.folder');

/** An S3-compatible service's address: `http` or `https` (production asks for `https`, `storageProblems`). */
const storageEndpointSchema = z
  .url({
    protocol: /^https?$/,
    hostname: z.regexes.hostname,
    error: 'validation.storage.endpoint' satisfies ValidationMessageKey,
  })
  .max(STORAGE_FIELD_MAX_LENGTH, {
    error: 'validation.storage.endpoint' satisfies ValidationMessageKey,
  });

/** An SFTP server's port. */
const storagePortSchema = z.coerce
  .number({ error: 'validation.storage.port' satisfies ValidationMessageKey })
  .int({ error: 'validation.storage.port' satisfies ValidationMessageKey })
  .min(1, { error: 'validation.storage.port' satisfies ValidationMessageKey })
  .max(65535, { error: 'validation.storage.port' satisfies ValidationMessageKey });

/** An SFTP server's host key fingerprint, as `ssh-keygen -lf` prints it. */
const storageHostKeySchema = z
  .string({ error: 'validation.storage.hostKey' satisfies ValidationMessageKey })
  .trim()
  .regex(HOST_KEY_PATTERN, { error: 'validation.storage.hostKey' satisfies ValidationMessageKey });

/**
 * A storage's settings as Settings keeps them (decision 0044): the shape of
 * `StorageConfig`, with the S3 secret key and the SFTP password or private
 * key encrypted (`sealStorage` in `src/server/storage/`), so those fields
 * hold the encrypted text and may be longer.
 */
export const storedStorageSchema = z.discriminatedUnion('driver', [
  z.object({ driver: z.literal('local'), dir: storageFolderSchema }),
  z.object({
    driver: z.literal('s3'),
    endpoint: storageEndpointSchema,
    region: storageText('validation.storage.region'),
    bucket: storageBucketSchema,
    accessKeyId: storageText('validation.storage.accessKeyId'),
    secretAccessKey: z
      .string()
      .min(1)
      .max(4 * PRIVATE_KEY_MAX_LENGTH),
    forcePathStyle: z.boolean(),
  }),
  z.object({
    driver: z.literal('sftp'),
    host: storageText('validation.storage.host'),
    port: storagePortSchema,
    username: storageText('validation.storage.username'),
    password: z
      .string()
      .min(1)
      .max(4 * PRIVATE_KEY_MAX_LENGTH)
      .optional(),
    privateKey: z
      .string()
      .min(1)
      .max(4 * PRIVATE_KEY_MAX_LENGTH)
      .optional(),
    hostKey: storageHostKeySchema,
    dir: storageFolderSchema,
  }),
]);

/**
 * A secret a storage's form sent: empty means "keep the saved one", which
 * the service decides it may (`saveAttachmentStorage`).
 *
 * @param max - The longest it may be.
 * @returns The schema: the secret, or `undefined` when it's empty.
 */
function storageSecret(max: number) {
  return z
    .string()
    .max(max, { error: 'validation.storage.secret' satisfies ValidationMessageKey })
    .transform((value) => (value.trim() === '' ? undefined : value));
}

/**
 * The storage's form on the Integrations tab of Settings: a driver and its
 * fields, the secrets left empty to keep the saved ones. Only the chosen
 * driver's fields are sent.
 */
export const storageFormSchema = z.discriminatedUnion(
  'driver',
  [
    z.object({ driver: z.literal('local'), dir: storageFolderSchema }),
    z.object({
      driver: z.literal('s3'),
      endpoint: storageEndpointSchema,
      region: z
        .string()
        .trim()
        .max(STORAGE_FIELD_MAX_LENGTH, {
          error: 'validation.storage.region' satisfies ValidationMessageKey,
        })
        .transform((value) => value || DEFAULT_S3_REGION),
      bucket: storageBucketSchema,
      accessKeyId: storageText('validation.storage.accessKeyId'),
      secretAccessKey: storageSecret(STORAGE_FIELD_MAX_LENGTH),
      forcePathStyle: z.boolean(),
    }),
    z.object({
      driver: z.literal('sftp'),
      host: storageText('validation.storage.host'),
      port: z.preprocess((value) => (value === '' ? DEFAULT_SFTP_PORT : value), storagePortSchema),
      username: storageText('validation.storage.username'),
      password: storageSecret(STORAGE_FIELD_MAX_LENGTH),
      privateKey: storageSecret(PRIVATE_KEY_MAX_LENGTH),
      hostKey: storageHostKeySchema,
      dir: storageFolderSchema,
    }),
  ],
  { error: 'validation.storage.driver' satisfies ValidationMessageKey },
);

/** The storage's form as it's sent, before the service fills in the saved secrets. */
export type StorageFormInput = z.output<typeof storageFormSchema>;

/**
 * The largest file anyone may attach, in megabytes: a whole number from 1
 * to the ceiling where it runs (`maxFileMbCeiling`: 50, or 4 on Vercel).
 *
 * @param ceiling - The most it may be.
 * @returns The schema.
 */
export function maxFileMbSchema(ceiling: number) {
  const error = 'validation.storage.maxFileMb.whole' satisfies ValidationMessageKey;
  return z.coerce
    .number({ error })
    .int({ error })
    .min(1, { error })
    .max(ceiling, { error: 'validation.storage.maxFileMb.tooBig' satisfies ValidationMessageKey });
}

/** A webhook's name, as the staff call it: a name, since the email that it was turned off quotes it. */
export const webhookNameSchema = withNameSafety(
  lengthLimited({
    min: 1,
    max: WEBHOOK_NAME_MAX_LENGTH,
    tooShort: 'validation.webhookName.empty',
    tooLong: 'validation.webhookName.tooLong',
  }),
  'webhookName',
);

/** The message for each thing that can be wrong with a webhook's address (`webhookUrlProblem`). */
const WEBHOOK_URL_MESSAGES: Record<WebhookUrlProblem, ValidationMessageKey> = {
  too_long: 'validation.webhookUrl.tooLong',
  invalid: 'validation.webhookUrl.invalid',
  scheme: 'validation.webhookUrl.scheme',
  credentials: 'validation.webhookUrl.credentials',
  insecure: 'validation.webhookUrl.insecure',
};

/**
 * A webhook's address, by the rules the browser shares
 * (`webhookUrlProblem`): its length is checked first, so the other rules
 * never parse a megabyte. Whether it points inside Adiutor's network is the
 * server's own check (`pointsInside`).
 *
 * @param production - Whether Adiutor runs in production, where only `https://` (or this computer) will do.
 * @returns The schema.
 */
export function webhookUrlSchema(production: boolean) {
  return z
    .string()
    .trim()
    .min(1, { error: 'validation.webhookUrl.empty' satisfies ValidationMessageKey, abort: true })
    .max(WEBHOOK_URL_MAX_LENGTH, {
      error: 'validation.webhookUrl.tooLong' satisfies ValidationMessageKey,
      abort: true,
    })
    .superRefine((value, ctx) => {
      const problem = webhookUrlProblem(value, { production });
      if (problem !== null) {
        ctx.addIssue({ code: 'custom', message: WEBHOOK_URL_MESSAGES[problem] });
      }
    });
}

/** How a webhook is sent (`WEBHOOK_FORMATS`). */
export const webhookFormatSchema = z.enum(WEBHOOK_FORMATS, {
  error: 'validation.webhookFormat' satisfies ValidationMessageKey,
});

/** What a webhook is told about: at least one of `WEBHOOK_EVENTS`, each once. */
export const webhookEventsSchema = z
  .array(
    z.enum(WEBHOOK_EVENTS, {
      error: 'validation.webhookEvents.unknown' satisfies ValidationMessageKey,
    }),
  )
  .max(WEBHOOK_EVENTS.length * 2, {
    error: 'validation.webhookEvents.unknown' satisfies ValidationMessageKey,
  })
  .transform((events) => WEBHOOK_EVENTS.filter((event) => events.includes(event)))
  .refine((events) => events.length > 0, {
    error: 'validation.webhookEvents.empty' satisfies ValidationMessageKey,
  });

/**
 * The request types a webhook covers when it doesn't cover them all: keys in
 * form, each once (whether they exist is the service's check). A handful at
 * most in practice; the bound keeps a forged form small.
 */
export const webhookTypesSchema = z
  .array(
    z
      .string()
      .trim()
      .regex(REQUEST_TYPE_KEY_PATTERN, {
        error: 'validation.webhookTypes.unknown' satisfies ValidationMessageKey,
      }),
  )
  .max(200, { error: 'validation.webhookTypes.unknown' satisfies ValidationMessageKey })
  .transform((keys) => [...new Set(keys)]);

/**
 * A mail server's host: a host name or an IP address, trimmed, at most
 * `SMTP_FIELD_MAX_LENGTH` characters.
 */
const smtpHostSchema = z
  .string({ error: 'validation.smtp.host' satisfies ValidationMessageKey })
  .trim()
  .max(SMTP_FIELD_MAX_LENGTH, { error: 'validation.smtp.host' satisfies ValidationMessageKey })
  .refine(
    (value) =>
      z.regexes.hostname.test(value) || z.regexes.ipv4.test(value) || z.regexes.ipv6.test(value),
    { error: 'validation.smtp.host' satisfies ValidationMessageKey },
  );

/**
 * An optional text field of a mail server's form: trimmed, at most
 * `SMTP_FIELD_MAX_LENGTH` characters, and `null` when it's left empty.
 *
 * @param message - What to say when it's too long.
 * @returns The schema.
 */
function optionalSmtpText(message: ValidationMessageKey) {
  return z
    .string({ error: message })
    .trim()
    .max(SMTP_FIELD_MAX_LENGTH, { error: message })
    .transform((value) => value || null);
}

/**
 * The mail server's form on the Integrations tab of Settings. The port defaults to
 * the usual one for its security; the password is `undefined` when it was
 * left empty (to keep the saved one, `secretToSave`), and the sender's
 * address `undefined` when the form didn't send it (while `EMAIL_FROM`
 * chooses the sender, the service decides).
 */
export const smtpFormSchema = z
  .object({
    host: smtpHostSchema,
    port: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce
        .number({ error: 'validation.smtp.port' satisfies ValidationMessageKey })
        .int({ error: 'validation.smtp.port' satisfies ValidationMessageKey })
        .min(1, { error: 'validation.smtp.port' satisfies ValidationMessageKey })
        .max(65535, { error: 'validation.smtp.port' satisfies ValidationMessageKey })
        .optional(),
    ),
    security: z.enum(SMTP_SECURITIES, {
      error: 'validation.smtp.security' satisfies ValidationMessageKey,
    }),
    username: optionalSmtpText('validation.smtp.username'),
    password: z
      .string()
      .max(SMTP_FIELD_MAX_LENGTH, {
        error: 'validation.smtp.password' satisfies ValidationMessageKey,
      })
      .transform((value) => (value === '' ? undefined : value)),
    fromName: optionalSmtpText('validation.smtp.fromName'),
    fromAddress: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      emailSchema.optional(),
    ),
  })
  .transform(({ port, ...rest }) => ({ ...rest, port: port ?? DEFAULT_SMTP_PORTS[rest.security] }));

/** The mail server's form as it's sent, before the service fills in the saved password. */
export type SmtpFormInput = z.output<typeof smtpFormSchema>;

/**
 * A mail server as Settings keeps it (`email.smtp`), its password encrypted
 * (`sealSecret` in `src/server/`), so that field holds the encrypted text and
 * may be longer.
 */
export const storedSmtpSchema = z
  .object({
    host: smtpHostSchema,
    port: z.number().int().min(1).max(65535),
    security: z.enum(SMTP_SECURITIES),
    username: z.string().min(1).max(SMTP_FIELD_MAX_LENGTH).nullable(),
    password: z
      .string()
      .min(1)
      .max(4 * SMTP_FIELD_MAX_LENGTH)
      .nullable(),
    from: z.object({
      name: z.string().min(1).max(SMTP_FIELD_MAX_LENGTH).nullable(),
      address: emailSchema,
    }),
  })
  .nullable();
