/**
 * @file The name to show for a user. Pure and client-safe, so pages, client
 * components, services and jobs all use the same rule (and it matches the
 * `btrim` in the name sort, `displayNameOrder` in `src/server/pagination.ts`).
 */

/**
 * The name to show for a user: their display name, or their email address
 * when they haven't set one (or it's only spaces).
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
  return name?.trim() || email;
}
