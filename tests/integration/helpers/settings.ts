/**
 * @file Saving the staff's settings for a test.
 */
import type { Database } from '@/db';
import { type Locale, LOCALES } from '@/lib/i18n/locales';
import { addSetting, type SettingChange, writeSettings } from '@/server/settings';

/**
 * Saves the staff's settings and marks Adiutor as set up, as setup does.
 *
 * @param db - Test database.
 * @param name - The name shown to users; defaults to "Adiutor Tests".
 * @param defaultLocale - Adiutor's default language; defaults to English (US).
 * @param offeredLocales - The languages it offers; every language by default.
 */
export async function createStaffSettings(
  db: Database,
  name = 'Adiutor Tests',
  defaultLocale: Locale = 'en-US',
  offeredLocales: Locale[] = [...LOCALES],
): Promise<void> {
  await db.transaction(async (tx) => {
    await addSetting(tx, 'setup.completed_at', new Date());
    await writeSettings(tx, {
      'staff.name': name,
      'staff.default_locale': defaultLocale,
      'staff.offered_locales': offeredLocales,
    });
  });
}

/**
 * Saves settings directly (through `writeSettings`, so they're checked as
 * the services check them), e.g. Adiutor's default language for a test.
 *
 * @param db - Test database.
 * @param change - The values to write, by key.
 */
export async function saveSettings(db: Database, change: SettingChange): Promise<void> {
  await db.transaction((tx) => writeSettings(tx, change));
}
