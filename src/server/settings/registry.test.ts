/**
 * @file Tests for the settings' definitions: the fallback of every setting,
 * the values each refuses, how a moment is stored and read, and the check
 * that keeps the default language offered.
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { LOCALES } from '@/lib/i18n/locales';

import {
  SETTING_CHECKS,
  SETTING_KEYS,
  type SettingValues,
  settingValue,
  storedSettingValue,
} from './registry';

/** Every setting's fallback, the values readers get before anything is saved. */
const FALLBACKS: SettingValues = {
  'staff.name': 'Adiutor',
  'staff.default_locale': null,
  'staff.offered_locales': LOCALES,
  'staff.default_time_zone': 'UTC',
  'requests.prefix': 'AD',
  'requests.last_number': 0,
  'jobs.last_tick': null,
  'setup.completed_at': null,
  'attachments.storage': null,
  'attachments.max_file_mb': 10,
  'attachments.enabled': false,
};

describe('the settings', () => {
  it('each read as their fallback without a row', () => {
    expect(
      Object.fromEntries(SETTING_KEYS.map((key) => [key, storedSettingValue(key, undefined)])),
    ).toEqual(FALLBACKS);
  });

  it.each([
    ['staff.name', ''],
    ['staff.default_locale', 'fr-FR'],
    ['staff.offered_locales', []],
    ['staff.offered_locales', ['en-US', 'fr-FR']],
    ['staff.default_time_zone', 'Mars/Olympus_Mons'],
    ['requests.prefix', '1AD'],
    ['requests.last_number', -1],
    ['requests.last_number', 1.5],
    ['jobs.last_tick', 'yesterday'],
    ['setup.completed_at', null],
    ['attachments.storage', { driver: 'local', dir: '' }],
    ['attachments.storage', { driver: 'ftp', dir: '/data' }],
    ['attachments.max_file_mb', 0],
    ['attachments.max_file_mb', 51],
  ] as const)('refuse to write %s as %j', (key, value) => {
    expect(() => settingValue(key, value)).toThrow(ZodError);
  });

  it.each([
    ['staff.default_locale', 'fr-FR'],
    ['staff.offered_locales', 'en-US'],
    ['requests.last_number', '142'],
    ['jobs.last_tick', 1_795_000_000_000],
    ['attachments.storage', { driver: 's3', endpoint: 'not an address' }],
    ['attachments.max_file_mb', 'ten'],
  ] as const)('read %s stored as %j as their fallback', (key, stored) => {
    expect(storedSettingValue(key, stored)).toEqual(FALLBACKS[key]);
  });

  it('write a value as their schema gives it, e.g. a prefix in capitals', () => {
    expect(settingValue('requests.prefix', ' help ')).toBe('HELP');
    expect(settingValue('staff.offered_locales', ['nl-NL'])).toEqual(['nl-NL']);
  });

  it('store a moment as its ISO string, and read it back as the same moment', () => {
    const moment = new Date('2026-11-21T18:00:00.123Z');
    const stored: unknown = JSON.parse(JSON.stringify(settingValue('jobs.last_tick', moment)));

    expect(stored).toBe('2026-11-21T18:00:00.123Z');
    expect(storedSettingValue('jobs.last_tick', stored)).toEqual(moment);
    expect(storedSettingValue('setup.completed_at', stored)).toEqual(moment);
  });
});

describe('the checks between settings', () => {
  /**
   * Whether every check holds for the settings with some values changed.
   *
   * @param change - The values that differ from the fallbacks.
   * @returns Whether they all hold.
   */
  const holds = (change: Partial<SettingValues>) =>
    SETTING_CHECKS.every((check) => check.holds({ ...FALLBACKS, ...change }));

  it('keep the default language among the languages offered', () => {
    expect(holds({})).toBe(true);
    expect(holds({ 'staff.default_locale': 'nl-NL' })).toBe(true);
    expect(
      holds({ 'staff.default_locale': 'nl-NL', 'staff.offered_locales': ['en-US', 'es-ES'] }),
    ).toBe(false);
    // Before setup there's no default, so any languages may be offered.
    expect(holds({ 'staff.offered_locales': ['es-ES'] })).toBe(true);
  });
});
