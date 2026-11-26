/**
 * @file Every setting Adiutor keeps in the `setting` table (decision 0034):
 * its key, the schema its value must pass and its fallback, the value it has
 * while its row is missing or holds something the schema refuses. Also the
 * checks that compare settings with each other (`SETTING_CHECKS`). Free of database code, so it can be tested alone.
 */
import { z } from 'zod';

import { type Locale, LOCALES } from '@/lib/i18n/locales';
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/time-zones';
import { DEFAULT_REQUEST_PREFIX } from '@/lib/requests';
import {
  brandColourSchema,
  localeSchema,
  requestPrefixSchema,
  staffNameSchema,
  timeZoneSchema,
} from '@/lib/validation';

/**
 * A moment: a `Date` when it's written, and the string it's stored as
 * (`toISOString`, in UTC) when it's read, which becomes a `Date` again.
 */
const momentSchema = z.union([z.date(), z.iso.datetime().transform((text) => new Date(text))]);

/**
 * Declares a setting.
 *
 * @param schema - What its value must pass, when it's written and when it's read.
 * @param fallback - Its value while its row is missing, or holds a value the schema refuses.
 * @returns The setting's definition.
 */
function defineSetting<S extends z.ZodType, F>(schema: S, fallback: F) {
  return { schema, fallback };
}

/**
 * Every setting, by key. A key is `<area>.<name>`; a new setting needs only
 * an entry here (no migration) and, when it's compared with another, a check
 * in {@link SETTING_CHECKS}.
 */
export const SETTINGS = {
  /** How the staff are named to users and in invitations; "Adiutor" until setup names them. */
  'staff.name': defineSetting(staffNameSchema, 'Adiutor'),
  /**
   * Adiutor's own language for everyone who hasn't chosen one, chosen at
   * setup and in Settings (docs/i18n.md). `null` before setup, when the
   * browser's language is used instead.
   */
  'staff.default_locale': defineSetting(localeSchema, null),
  /**
   * The languages Adiutor offers (decision 0029), always with the default
   * ({@link SETTING_CHECKS}). Setup lists every language there is then, so a
   * language added to `LOCALES` later starts off; before setup every language
   * is offered.
   */
  'staff.offered_locales': defineSetting(
    z.array(localeSchema).min(1),
    LOCALES as readonly Locale[],
  ),
  /**
   * Adiutor's own time zone, for signed-out pages and people whose zone isn't
   * known yet: the first Admin's browser's at setup, changeable on the staff
   * page (docs/i18n.md, "Time zones"). UTC until then.
   */
  'staff.default_time_zone': defineSetting(timeZoneSchema, DEFAULT_TIME_ZONE as string),
  /**
   * What request numbers are shown with ("AD" in "AD-142"), changeable on the
   * Requests tab of Settings. Only for display: a request's number and address don't change
   * with it.
   */
  'requests.prefix': defineSetting(requestPrefixSchema, DEFAULT_REQUEST_PREFIX as string),
  /**
   * The brand colours (decision 0047), set on the Appearance tab of Settings
   * and worked out into the palette every page and email uses
   * (`src/lib/branding`). `null` is the theme's own: the accent is the main
   * actions, links and focus rings (teal and green), the dark accent the
   * accent in dark mode only (only with an accent, {@link SETTING_CHECKS}),
   * and the tint the colour whose hue the greys take (navy).
   */
  'brand.accent': defineSetting(brandColourSchema.nullable(), null),
  /** The accent in dark mode; `null` works it out from `brand.accent`. */
  'brand.accent_dark': defineSetting(brandColourSchema.nullable(), null),
  /** The colour whose hue the greys take; `null` keeps the theme's navy. */
  'brand.tint': defineSetting(brandColourSchema.nullable(), null),
  /**
   * The highest number a request has: raising a request adds one to it in its
   * transaction (`incrementSetting`), so two requests never share a number and
   * a refused one uses none up. A setting instead of a sequence: IDs and
   * defaults never come from sequences here.
   */
  'requests.last_number': defineSetting(z.int().min(0), 0),
  /**
   * When the last tick of the background jobs started, from any source, so
   * staff are warned when the ticks stop (docs/jobs.md). `null` before the
   * first.
   */
  'jobs.last_tick': defineSetting(momentSchema, null),
  /**
   * When the first-run setup was done: while it's `null`, Adiutor isn't set
   * up and only setup may run (`isSetUp` in `src/server/setup.ts`). Written
   * once, by setup (`addSetting`).
   */
  'setup.completed_at': defineSetting(momentSchema, null),
} as const;

/** The key of a setting, e.g. `staff.name`. */
export type SettingKey = keyof typeof SETTINGS;

/** A setting's definition. */
type Definition<K extends SettingKey> = (typeof SETTINGS)[K];

/** A value that may be written to a setting: what its schema gives (never its fallback `null`). */
export type SettingInput<K extends SettingKey> = z.output<Definition<K>['schema']>;

/** A setting's value as it's read: what its schema gave, or its fallback. */
export type SettingValue<K extends SettingKey> = SettingInput<K> | Definition<K>['fallback'];

/** Every setting's value as it's read. */
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

/** A change to some settings: the values to write, by key. */
export type SettingChange = { [K in SettingKey]?: SettingInput<K> };

/** The settings that count, whose value is a number that only grows (`incrementSetting`). */
export type CounterKey = {
  [K in SettingKey]: SettingInput<K> extends number ? K : never;
}[SettingKey];

/** Every setting's key, in the order of {@link SETTINGS}. */
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/**
 * A setting's definition, typed by its key. TypeScript can't follow a key
 * through `SETTINGS[key]` to its own schema and fallback, so this says it.
 *
 * @param key - The setting.
 * @returns Its schema and fallback.
 */
function definitionOf<K extends SettingKey>(
  key: K,
): { schema: z.ZodType<SettingInput<K>>; fallback: SettingValue<K> } {
  return SETTINGS[key] as unknown as {
    schema: z.ZodType<SettingInput<K>>;
    fallback: SettingValue<K>;
  };
}

/**
 * Checks a value for a setting.
 *
 * @param key - The setting.
 * @param value - The value to write.
 * @returns The value as it's stored (e.g. a prefix in capitals).
 * @throws {ZodError} When the setting's schema refuses it.
 */
export function settingValue<K extends SettingKey>(key: K, value: unknown): SettingInput<K> {
  return definitionOf(key).schema.parse(value);
}

/**
 * Reads a setting's stored value.
 *
 * @param key - The setting.
 * @param stored - Its row's value, or `undefined` when it has no row.
 * @returns The value, or the setting's fallback when there's no row or its schema refuses it.
 */
export function storedSettingValue<K extends SettingKey>(key: K, stored: unknown): SettingValue<K> {
  const { schema, fallback } = definitionOf(key);
  if (stored === undefined) {
    return fallback;
  }
  const parsed = schema.safeParse(stored);
  return parsed.success ? parsed.data : fallback;
}

/** A check that compares settings with each other, made whenever one of them is written. */
export interface SettingCheck {
  /** The settings it compares. */
  keys: readonly SettingKey[];
  /** Whether the settings' values (as they'd be after the change) hold together. */
  holds: (values: SettingValues) => boolean;
  /** What's wrong when they don't, for the error: a mistake in the code, never shown to anyone. */
  problem: string;
}

/**
 * The checks between settings, made in the transaction that writes them
 * (`writeSettings`), since no database constraint spans the settings' rows. Each setting's own rules (a known language, at least one
 * offered) are in its schema.
 */
export const SETTING_CHECKS: readonly SettingCheck[] = [
  {
    keys: ['staff.default_locale', 'staff.offered_locales'],
    /**
     * Whether the default language is offered (or there's none yet, before setup).
     *
     * @param values - The settings as they'd be after the change.
     * @returns Whether it holds.
     */
    holds: (values) => {
      const defaultLocale = values['staff.default_locale'];
      return defaultLocale === null || values['staff.offered_locales'].includes(defaultLocale);
    },
    problem: 'the default language must be one of the languages offered',
  },
  {
    keys: ['brand.accent', 'brand.accent_dark'],
    /**
     * Whether a dark accent comes with an accent: it's a different accent for
     * dark mode, so without an accent there's nothing for it to differ from.
     *
     * @param values - The settings as they'd be after the change.
     * @returns Whether it holds.
     */
    holds: (values) => values['brand.accent_dark'] === null || values['brand.accent'] !== null,
    problem: 'a dark accent needs an accent',
  },
];
