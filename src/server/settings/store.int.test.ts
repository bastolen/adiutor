/**
 * @file Integration tests for reading and writing settings, against the test
 * database: fallbacks for missing and refused rows, writes that are checked
 * whole before anything is stored, the lock that makes two changes take
 * turns, the setting setup adds once, and the counter that numbers requests.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { setting } from '@/db/schema';
import { LOCALES } from '@/lib/i18n/locales';

import {
  atTheSameMoment,
  saveSettings,
  setupTestContext,
} from '../../../tests/integration/helpers';
import { addSetting, incrementSetting, readSettings, writeSettings } from './store';

const { db } = setupTestContext();

/**
 * Reads a setting's row as it's stored.
 *
 * @param key - The setting.
 * @returns Its row, or `undefined` when it has none.
 */
async function storedRow(key: string) {
  const [row] = await db.select().from(setting).where(eq(setting.key, key));
  return row;
}

describe('readSettings', () => {
  it('gives each setting its fallback before anything is saved', async () => {
    expect(
      await readSettings(db, ['staff.name', 'staff.default_locale', 'staff.offered_locales']),
    ).toEqual({
      'staff.name': 'Adiutor',
      'staff.default_locale': null,
      'staff.offered_locales': LOCALES,
    });
  });

  it('reads the saved values, and only the settings asked for', async () => {
    await saveSettings(db, { 'staff.name': 'Adiutor Tests', 'requests.prefix': 'AT' });

    expect(await readSettings(db, ['staff.name', 'jobs.last_tick'])).toEqual({
      'staff.name': 'Adiutor Tests',
      'jobs.last_tick': null,
    });
  });

  it('gives the fallback for a row whose value its setting refuses', async () => {
    await db.insert(setting).values([
      { key: 'requests.prefix', value: 'not a prefix' },
      { key: 'staff.offered_locales', value: ['en-US', 'fr-FR'] },
      { key: 'staff.default_time_zone', value: 'Europe/Amsterdam' },
    ]);

    expect(
      await readSettings(db, [
        'requests.prefix',
        'staff.offered_locales',
        'staff.default_time_zone',
      ]),
    ).toEqual({
      'requests.prefix': 'AD',
      'staff.offered_locales': LOCALES,
      'staff.default_time_zone': 'Europe/Amsterdam',
    });
  });
});

describe('writeSettings', () => {
  it('writes the values, one row per setting, and says what each was before', async () => {
    const first = await db.transaction((tx) =>
      writeSettings(tx, { 'staff.name': 'Adiutor Tests', 'requests.prefix': ' at ' }),
    );
    expect(first).toEqual({ 'staff.name': null, 'requests.prefix': null });

    const second = await db.transaction((tx) =>
      writeSettings(tx, { 'staff.name': 'Adiutor Tests Two' }),
    );
    expect(second).toEqual({ 'staff.name': 'Adiutor Tests' });
    expect(await readSettings(db, ['staff.name', 'requests.prefix'])).toEqual({
      'staff.name': 'Adiutor Tests Two',
      'requests.prefix': 'AT',
    });
    expect(await db.$count(setting)).toBe(2);
  });

  it('notes when a setting was last written', async () => {
    await saveSettings(db, { 'requests.prefix': 'AT' });
    await db.update(setting).set({ updatedAt: new Date('2026-01-01T00:00:00Z') });

    await saveSettings(db, { 'requests.prefix': 'HELP' });

    const row = await storedRow('requests.prefix');
    expect(row?.updatedAt.getTime()).toBeGreaterThan(Date.parse('2026-01-02T00:00:00Z'));
  });

  it('refuses a change with a value its setting refuses, and writes none of it', async () => {
    await expect(
      saveSettings(db, { 'staff.name': 'Adiutor Tests', 'requests.prefix': '1AD' }),
    ).rejects.toThrow(ZodError);

    expect(await db.$count(setting)).toBe(0);
  });

  it('keeps the default language offered, against the saved languages too', async () => {
    await saveSettings(db, { 'staff.default_locale': 'nl-NL' });

    await expect(saveSettings(db, { 'staff.offered_locales': ['en-US', 'es-ES'] })).rejects.toThrow(
      'Settings refused: the default language must be one of the languages offered.',
    );
    await expect(
      saveSettings(db, { 'staff.default_locale': 'es-ES', 'staff.offered_locales': ['en-US'] }),
    ).rejects.toThrow('the default language must be one of the languages offered');

    expect(await readSettings(db, ['staff.default_locale', 'staff.offered_locales'])).toEqual({
      'staff.default_locale': 'nl-NL',
      'staff.offered_locales': LOCALES,
    });
    expect(await storedRow('staff.offered_locales')).toBeUndefined();
  });

  it('makes a second change wait for the first, and check what the first wrote', async () => {
    await saveSettings(db, {
      'staff.default_locale': 'en-US',
      'staff.offered_locales': [...LOCALES],
    });

    // The second change, checked against English, would leave Dutch the default but not offered.
    const { second } = await atTheSameMoment(
      db,
      (tx) => writeSettings(tx, { 'staff.default_locale': 'nl-NL' }),
      () => saveSettings(db, { 'staff.offered_locales': ['en-US', 'es-ES'] }),
    );

    expect(second).toMatchObject({
      status: 'rejected',
      reason: { message: expect.stringContaining('languages offered') },
    });
    expect(await readSettings(db, ['staff.default_locale', 'staff.offered_locales'])).toEqual({
      'staff.default_locale': 'nl-NL',
      'staff.offered_locales': [...LOCALES],
    });
  });

  it('writes nothing for an empty change', async () => {
    await expect(db.transaction((tx) => writeSettings(tx, {}))).resolves.toEqual({});
    expect(await db.$count(setting)).toBe(0);
  });
});

describe('addSetting', () => {
  it('adds a setting once, and the database refuses it a second time', async () => {
    const moment = new Date('2026-11-21T18:00:00.123Z');
    await db.transaction((tx) => addSetting(tx, 'setup.completed_at', moment));

    await expect(
      db.transaction((tx) => addSetting(tx, 'setup.completed_at', new Date())),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'setting_key_idx' } });
    expect(await readSettings(db, ['setup.completed_at'])).toEqual({
      'setup.completed_at': moment,
    });
  });
});

describe('incrementSetting', () => {
  it('counts from 1, and on from a saved number', async () => {
    const first = await db.transaction((tx) => incrementSetting(tx, 'requests.last_number'));
    expect(first).toEqual({ value: 1, takenAt: expect.any(Date) });

    await saveSettings(db, { 'requests.last_number': 141 });
    const next = await db.transaction((tx) => incrementSetting(tx, 'requests.last_number'));
    expect(next.value).toBe(142);
    expect(await readSettings(db, ['requests.last_number'])).toEqual({
      'requests.last_number': 142,
    });
  });

  it('fails rather than count again when the stored number is broken', async () => {
    await db.insert(setting).values({ key: 'requests.last_number', value: 'many' });

    await expect(
      db.transaction((tx) => incrementSetting(tx, 'requests.last_number')),
    ).rejects.toMatchObject({ cause: { code: '22023' } });
    expect((await storedRow('requests.last_number'))?.value).toBe('many');
  });
});
