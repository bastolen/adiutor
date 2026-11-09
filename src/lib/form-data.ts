/**
 * @file Helpers for reading submitted forms in server actions. They live here,
 * not in an action file, because a `'use server'` file may only export async
 * functions.
 */
import { isLocale, type Locale } from './i18n/locales';

/**
 * Reads a text field from a form.
 *
 * @param formData - The submitted form.
 * @param name - The field name.
 * @returns The value as submitted (not trimmed), or an empty string when the
 * field is missing or is a file.
 */
export default function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Reads a language field (`EmailLanguageField`) from a form.
 *
 * @param formData - The submitted form.
 * @param name - The field name; `locale` by default.
 * @returns The language, or `undefined` for Default (`FOLLOW_DEFAULT`), a missing field or
 * anything that isn't one of the languages: the service then uses Adiutor's default language.
 */
export function localeField(formData: FormData, name = 'locale'): Locale | undefined {
  const value = field(formData, name);
  return isLocale(value) ? value : undefined;
}
