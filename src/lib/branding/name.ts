/**
 * @file The name people see Adiutor by (decision 0050): the staff's name
 * (`staff.name`), which replaces "Adiutor" in every text once the staff have
 * one of their own, and the few places Adiutor stays visible then ("Powered
 * by Adiutor", the label of new authenticator entries and passkeys), and how
 * a name is kept from breaking a label or a page title.
 */

/** Adiutor's own name: the staff's name until setup names them, and the software's name always. */
export const ADIUTOR_NAME = 'Adiutor';

/**
 * Whether a name is Adiutor's own, ignoring spaces around it and case: then
 * nothing says "Powered by Adiutor", which would only repeat it.
 *
 * @param name - The staff's name.
 * @returns `true` for e.g. "Adiutor" or " adiutor ".
 */
export function isOwnName(name: string): boolean {
  return name.trim().toLowerCase() === ADIUTOR_NAME.toLowerCase();
}

/**
 * Whether "Powered by Adiutor" shows: once the staff have a name of their own.
 *
 * @param name - The staff's name.
 * @returns `true` when it isn't Adiutor's own.
 */
export function poweredByShown(name: string): boolean {
  return !isOwnName(name);
}

/**
 * The label new authenticator entries and passkeys get: the staff's name
 * with Adiutor's after it, or just Adiutor's while that's the staff's name.
 *
 * @param name - The staff's name.
 * @returns E.g. "Acme Support (Adiutor)", or "Adiutor".
 */
export function signInAppName(name: string): string {
  if (isOwnName(name)) {
    return ADIUTOR_NAME;
  }
  // An authenticator entry's label is "issuer:account": a colon of the name's own would cut it.
  const withoutColons = name
    .trim()
    .replace(/\s*:\s*/g, ' ')
    .trim();
  return `${withoutColons} (${ADIUTOR_NAME})`;
}

/**
 * A name as a page title template may hold it. Next.js puts the page's
 * title in place of every `%s` in a template, so a `%s` of the name's own
 * (the staff's, a company's) would become the page's title too.
 *
 * @param name - The name.
 * @returns The name with each `%s` written as `% s`.
 */
export function forTitleTemplate(name: string): string {
  return name.replaceAll('%s', '% s');
}
