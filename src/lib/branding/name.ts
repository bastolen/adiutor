/**
 * @file The name people see Adiutor by (decision 0050): the staff's name
 * (`staff.name`), which replaces "Adiutor" in every text once the staff have
 * one of their own, and the few places Adiutor stays visible then ("Powered
 * by Adiutor", the label of new authenticator entries and passkeys).
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
  return isOwnName(name) ? ADIUTOR_NAME : `${name.trim()} (${ADIUTOR_NAME})`;
}
