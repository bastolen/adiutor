/**
 * @file The name to show for a user. Pure and client-safe, so pages, client
 * components, services and jobs all use the same rule (and it matches the
 * `btrim` in the name sort, `displayNameOrder` in `src/server/pagination.ts`,
 * for every name the name rules allow).
 */
import { hasVisibleCharacter } from './character-rules';

/**
 * The name to show for a user: their display name, or their email address
 * when they haven't set one, or it has nothing to see: only spaces, or only
 * characters that show as nothing (`hasVisibleCharacter`). The name rules
 * refuse such a name (`nameSchema`), so only a name saved before they did
 * can be one; it would show as a blank row in lists and emails.
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
  const shown = name?.trim();
  return shown && hasVisibleCharacter(shown) ? shown : email;
}
