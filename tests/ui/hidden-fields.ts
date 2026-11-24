/**
 * @file Reads the hidden fields a form sends on, for tests of forms that post
 * to another endpoint.
 */

/**
 * Reads the hidden fields the form sends on.
 *
 * @param form - The form.
 * @returns Field names and values.
 */
export default function hiddenFields(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).map((input) => [
      input.name,
      input.value,
    ]),
  );
}
