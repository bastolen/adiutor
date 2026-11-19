/**
 * @file The name to show for a user. Pure and client-safe, so pages, client
 * components, services and jobs all use the same rule (and it matches the
 * `btrim` in the name sort, `displayNameOrder` in `src/server/pagination.ts`,
 * for every name the name rules allow). Lists and emails show
 * {@link displayName}, which falls back to the email address; requests and
 * the account's activity, which never show an address, use
 * {@link visibleName} and name someone in their own way when it gives none.
 */
import { hasVisibleCharacter } from './character-rules';

/**
 * A user's display name, trimmed, when it has something to see; `null` when
 * they haven't set one, or it has nothing to see: only spaces, or only
 * characters that show as nothing (`hasVisibleCharacter`). The name rules
 * refuse such a name (`nameSchema`), so only a name saved before they did
 * can be one; shown as it is, it would leave a blank where the name goes.
 *
 * @param name - Display name (may be empty or `null`).
 * @returns The name to show, or `null` for none.
 */
export function visibleName(name: string | null | undefined): string | null {
  const shown = name?.trim();
  return shown && hasVisibleCharacter(shown) ? shown : null;
}

/**
 * The name to show for a user: their display name ({@link visibleName}), or
 * their email address when it gives none, so a list or an email never shows
 * a blank row.
 *
 * @param user - The user.
 * @param user.name - Display name (may be empty or `null`).
 * @param user.email - Email address.
 * @returns The name to show.
 */
export default function displayName({
  name,
  email,
}: {
  name: string | null | undefined;
  email: string;
}): string {
  return visibleName(name) ?? email;
}
