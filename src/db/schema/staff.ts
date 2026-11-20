/**
 * @file Drizzle schema for the staff settings: one row, created by the
 * first-run setup. Its existence means Adiutor is set up. Staff roles live on
 * `user.platform_role`.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { DEFAULT_LOCALE, LOCALES } from '../../lib/i18n/locales';
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
  ],
);
