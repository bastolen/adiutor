/**
 * @file Adiutor's settings (decision 0034): one row per setting in the
 * `setting` table, each typed and checked in code. `registry.ts` declares
 * every setting (its key, schema and fallback) and the checks between
 * settings; `store.ts` reads and writes them. Nothing else reads or writes
 * the table, except the tests' helpers and seeds, through this module.
 *
 * This is the module's public API: nothing outside this folder imports its
 * files directly.
 */
export { SETTINGS } from './registry';
export type {
  CounterKey,
  SettingChange,
  SettingInput,
  SettingKey,
  SettingValue,
  SettingValues,
} from './registry';
export { addSetting, incrementSetting, readSettings, writeSettings } from './store';
export type { SettingsBefore } from './store';
