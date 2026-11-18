/**
 * @file Builds the form data an action test submits.
 */

/**
 * Builds the form a user submits.
 *
 * @param fields - The fields.
 * @returns The form data.
 */
export default function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(fields).forEach(([name, value]) => data.set(name, value));
  return data;
}
