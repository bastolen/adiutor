/**
 * @file Reading and writing the settings in the `setting` table (decision
 * 0034), one row per setting. Every value is checked against its setting's
 * schema (`registry.ts`) when it's written, and again when it's read: a
 * missing row, or one whose value the schema refuses, reads as the setting's
 * fallback. The checks between settings run in the writing transaction, with
 * the rows they compare locked.
 *
 * Takes the database as an argument and imports no server-only code: Better
 * Auth's configuration (`src/lib/auth.ts`) reads the languages through it.
 */
import { asc, inArray, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import type { DatabaseTransaction } from '@/db';
import type * as schema from '@/db/schema';
import { setting } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  type CounterKey,
  SETTING_CHECKS,
  SETTING_KEYS,
  type SettingChange,
  type SettingInput,
  type SettingKey,
  type SettingValue,
  type SettingValues,
  settingValue,
  storedSettingValue,
} from './registry';

/**
 * A Drizzle client on the app's schema, or a transaction of one: the app's
 * own, or the one the end-to-end tests' helpers open.
 */
type SettingsReader = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** A stored row: a setting's key and its value as JSON. */
interface StoredSetting {
  key: string;
  value: unknown;
}

/**
 * Reads settings from their rows.
 *
 * @param keys - The settings to read.
 * @param rows - Their rows (any of them may be missing).
 * @returns Each setting's value, or its fallback.
 */
function valuesOf<K extends SettingKey>(
  keys: readonly K[],
  rows: readonly StoredSetting[],
): Pick<SettingValues, K> {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(
    keys.map((key) => [key, storedSettingValue(key, stored.get(key))]),
  ) as Pick<SettingValues, K>;
}

/**
 * Reads settings, in one query.
 *
 * @param db - Database client or transaction.
 * @param keys - The settings to read.
 * @returns Each setting's value; its fallback when it has no row, or one its schema refuses.
 */
export async function readSettings<K extends SettingKey>(
  db: SettingsReader,
  keys: readonly K[],
): Promise<Pick<SettingValues, K>> {
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, [...keys]));
  return valuesOf(keys, rows);
}

/** What {@link writeSettings} found before it wrote: each changed setting's value, or `null`. */
export type SettingsBefore<C extends SettingChange> = {
  [K in keyof C & SettingKey]: SettingValue<K> | null;
};

/**
 * Writes settings in the caller's transaction. Each value must pass its
 * setting's schema. The rows of the changed settings, and of the settings a
 * check compares them with ({@link SETTING_CHECKS}), are locked first
 * (`FOR UPDATE`, in key order), so two changes take turns and a check sees
 * what the other change wrote; a row that doesn't exist yet can't be locked,
 * but the second insert of a key waits for the first at the key's unique
 * index. Then the checks run on the settings as they'd be after the change,
 * and the values are written in one statement.
 *
 * @param tx - The change's transaction; the rows stay locked until it ends.
 * @param change - The values to write, by key.
 * @returns Each changed setting's value as it was stored before, or `null` when it had no row.
 * @throws {ZodError} When a value doesn't pass its setting's schema; nothing is written.
 * @throws {Error} When the settings wouldn't hold together; nothing is written.
 */
export async function writeSettings<C extends SettingChange>(
  tx: DatabaseTransaction,
  change: C,
): Promise<SettingsBefore<C>> {
  const changed = SETTING_KEYS.filter((key) => change[key] !== undefined);
  const written = changed.map((key) => ({ key, value: settingValue(key, change[key]) }));
  if (written.length === 0) {
    return {} as SettingsBefore<C>;
  }
  const checks = SETTING_CHECKS.filter((check) => check.keys.some((key) => changed.includes(key)));
  const locked = [...new Set([...changed, ...checks.flatMap((check) => check.keys)])];
  const rows = await tx
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, locked))
    .orderBy(asc(setting.key))
    .for('update');

  const after = {
    ...valuesOf(SETTING_KEYS, rows),
    ...Object.fromEntries(written.map(({ key, value }) => [key, value])),
  };
  const failed = checks.find((check) => !check.holds(after));
  if (failed) {
    throw new Error(`Settings refused: ${failed.problem}.`);
  }

  await tx
    .insert(setting)
    .values(written)
    .onConflictDoUpdate({
      target: setting.key,
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    });
  const stored = new Set(rows.map((row) => row.key));
  const before = valuesOf(changed, rows);
  return Object.fromEntries(
    changed.map((key) => [key, stored.has(key) ? before[key] : null]),
  ) as SettingsBefore<C>;
}

/**
 * Adds a setting that has no row yet: setup marks itself done this way, so
 * that of two setups at the same moment, the second waits for the first at
 * the key's unique index and then fails.
 *
 * @param tx - The change's transaction.
 * @param key - The setting.
 * @param value - Its value.
 * @throws {ZodError} When the value doesn't pass the setting's schema.
 * @throws {Error} When the setting already has a row (a unique violation, `isUniqueViolation`).
 */
export async function addSetting<K extends SettingKey>(
  tx: DatabaseTransaction,
  key: K,
  value: SettingInput<K>,
): Promise<void> {
  await tx.insert(setting).values({ key, value: settingValue(key, value) });
}

/**
 * Adds one to a counting setting and returns the new number, starting at 1
 * when it has no row. The row stays locked until the transaction ends, so
 * take the number right before what uses it is stored. Also reads the
 * database's clock in the same statement, once the number is taken: not
 * `now()`, which is when the transaction started.
 *
 * A stored value that isn't a whole number makes this fail rather than count
 * again from 1.
 *
 * @param tx - The transaction the number is used in.
 * @param key - The setting that counts, e.g. `requests.last_number`.
 * @returns The new number, and the moment it was taken.
 */
export async function incrementSetting(
  tx: DatabaseTransaction,
  key: CounterKey,
): Promise<{ value: number; takenAt: Date }> {
  const counted = await tx
    .insert(setting)
    .values({ key, value: 1 })
    .onConflictDoUpdate({
      target: setting.key,
      set: { value: sql`to_jsonb((${setting.value})::integer + 1)`, updatedAt: sql`now()` },
    })
    .returning({
      value: sql<number>`(${setting.value})::integer`.mapWith(Number),
      takenAt: sql`clock_timestamp()`.mapWith(setting.updatedAt),
    });
  return firstRow(counted, `the setting ${key}`);
}
