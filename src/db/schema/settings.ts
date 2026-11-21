/**
 * @file Drizzle schema for Adiutor's settings (decision 0034): one row per
 * setting, a key and a JSON value. Which settings exist, what each value may
 * be and what it is while its row is missing are declared in code, in
 * `src/server/settings/`, which is the only code that reads or writes this
 * table: the database checks only that a key is there once.
 */
import { jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestampTz } from './columns';

/**
 * Adiutor's settings: the staff's name, languages, time zone and request
 * prefix, when setup was done, the last request number and when the last
 * tick of the jobs started. A setting without a row has its fallback.
 */
export const setting = pgTable(
  'setting',
  {
    id: id(),
    /** Which setting it is, e.g. `staff.name` (`SETTINGS` in `src/server/settings/`). */
    key: text('key').notNull(),
    /** Its value as JSON, checked against the setting's schema when it's written and read. */
    value: jsonb('value').$type<unknown>().notNull(),
    updatedAt: timestampTz('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /** One row per setting; writes upsert on it. */
    uniqueIndex('setting_key_idx').on(table.key),
  ],
);
