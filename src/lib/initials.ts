/**
 * @file Initials made from a name: what an avatar shows without a picture,
 * and the browser tab icon made from the staff's name (decision 0052).
 */

/**
 * Takes up to two initials from a name (or an email address). Letters are
 * whole characters (code points of the name in its composed form), so a
 * letter outside the Basic Multilingual Plane or one with an accent is never
 * cut in half.
 *
 * @param name - The name or email address.
 * @returns The initials, upper-cased.
 */
export default function initialsOf(name: string): string {
  const words = name
    .replace(/@.*/, '')
    .normalize('NFC')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const [first = '?', second] = words;
  const [firstLetter = ''] = Array.from(first);
  const [secondLetter = ''] = Array.from(second ?? '');
  const letters =
    second === undefined ? Array.from(first).slice(0, 2).join('') : firstLetter + secondLetter;
  return letters.toUpperCase();
}
