/**
 * @file Drizzle schema for the staff settings: one row, created by the
 * first-run setup. Its existence means Adiutor is set up. Staff roles live on
 * `user.platform_role`.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { DEFAULT_LOCALE, LOCALES } from '../../lib/i18n/locales';
import { DEFAULT_TIME_ZONE } from '../../lib/i18n/time-zones';
import { DEFAULT_REQUEST_PREFIX } from '../../lib/requests';
import { createdAt, id, oneOf, timestampTz } from './columns';

/** Settings for the staff (the people who handle requests from companies). Always a single row. */
export const staffSettings = pgTable(
  'staff_settings',
  {
    id: id(),
    /** How the staff are named to users and in invitations, e.g. "Adiutor". */
    name: text('name').notNull(),
    /**
     * Adiutor's own language for everyone who hasn't chosen one (no language
     * cookie): chosen at setup, changeable on the staff page. See docs/i18n.md.
     */
    defaultLocale: text('default_locale', { enum: LOCALES }).notNull().default(DEFAULT_LOCALE),
    /**
     * Adiutor's own time zone (an IANA name, `isTimeZone`): for signed-out
     * pages, for people whose zone isn't known yet, and for emails to them.
     * Taken from the first Admin's browser at setup, changeable on the staff
     * page. See docs/i18n.md, "Time zones".
     */
    defaultTimeZone: text('default_time_zone').notNull().default(DEFAULT_TIME_ZONE),
    /**
     * The languages Adiutor offers, which staff Admins turn on and off on the
     * staff page: only these are offered and used, and whoever chose one
     * that's off gets the default language until it's on again (decision
     * 0029). Always holds the default. A language added to `LOCALES` later
     * starts off: the rows that exist don't list it.
     */
    offeredLocales: text('offered_locales', { enum: LOCALES })
      .array()
      .notNull()
      .default(sql`array[${sql.raw(LOCALES.map((locale) => `'${locale}'`).join(', '))}]::text[]`),
    /**
     * What request numbers are shown with ("AD" in "AD-142"), changeable on
     * the staff page. Only for display: a request's number and address don't
     * change with it.
     */
    requestPrefix: text('request_prefix').notNull().default(DEFAULT_REQUEST_PREFIX),
    /** Always `true`; with the unique index and check below, it allows only one row. */
    singleton: boolean('singleton').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: timestampTz('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** There is exactly one settings row. */
    uniqueIndex('staff_settings_singleton_idx').on(table.singleton),
    check('staff_settings_singleton_true', sql`${table.singleton}`),
    oneOf('staff_settings_default_locale_valid', table.defaultLocale, LOCALES),
    /** Only languages Adiutor has, and at least one. */
    check(
      'staff_settings_offered_locales_known',
      sql`cardinality(${table.offeredLocales}) > 0 and ${table.offeredLocales} <@ array[${sql.raw(
        LOCALES.map((locale) => `'${locale}'`).join(', '),
      )}]::text[]`,
    ),
    /** The default language is always one that's offered. */
    check(
      'staff_settings_default_locale_offered',
      sql`${table.defaultLocale} = any(${table.offeredLocales})`,
    ),
  ],
);
