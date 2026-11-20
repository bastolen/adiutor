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
 * Reads every value of a field a form sends several times, such as a group
 * of checkboxes with one name.
 *
 * @param formData - The submitted form.
 * @param name - The field name.
 * @returns The text values in the order submitted (not trimmed); files are left out, and a
 * missing field gives an empty list.
 */
export function fieldValues(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === 'string');
}

/**
 * Reads a language field (`EmailLanguageField`) from a form.
 *
 * @param formData - The submitted form.
 * @returns The language, or `undefined` for Default (`FOLLOW_DEFAULT`), a missing field or
 * anything that isn't one of the languages: the service then uses Adiutor's default language.
 */
export function localeField(formData: FormData): Locale | undefined {
  const value = field(formData, 'locale');
  return isLocale(value) ? value : undefined;
}
