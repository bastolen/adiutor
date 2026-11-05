/**
 * @file Helper for reading submitted forms in server actions. It lives here, not
 * in an action file, because a `'use server'` file may only export async functions.
 */

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
