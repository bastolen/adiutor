/**
 * @file Which picture a person shows: the picture of one of their connected
 * GitHub or Google accounts, or their initials. Pure, so the services, the
 * account page and Better Auth's configuration share one rule.
 *
 * Someone who hasn't chosen shows the picture of the account they connected
 * first that has one, and their initials when none has. A choice of a
 * provider shows that provider's account; once it's disconnected, or while
 * it has no picture yet, the default applies again. Only confirmed accounts
 * count: one linked at sign-in that the user hasn't confirmed never shows,
 * as it doesn't count for MFA either.
 */
import { OAUTH_PROVIDERS, isOAuthProvider, type OAuthProvider } from './oauth-providers';

/**
 * What someone can choose to show: their initials, or the picture of their
 * account with a provider. Stored on the user (`user.avatarSource`); empty
 * until they choose, which means the default.
 */
export const AVATAR_SOURCES = ['initials', ...OAUTH_PROVIDERS] as const;

/** One choice of picture. */
export type AvatarSource = (typeof AVATAR_SOURCES)[number];

/**
 * Whether a value is a choice of picture.
 *
 * @param value - The value to check.
 * @returns Whether it's one of {@link AVATAR_SOURCES}.
 */
export function isAvatarSource(value: unknown): value is AvatarSource {
  return (AVATAR_SOURCES as readonly unknown[]).includes(value);
}

/** A connected account, as far as its picture goes. */
export interface PictureAccount {
  /** The account's ID (`account.id`). */
  id: string;
  /** Its provider. */
  providerId: string;
  /** The address of its picture at the provider, or `null` while it has none. */
  image: string | null;
  /** Whether the user confirmed it (`account.confirmed`). */
  confirmed: boolean;
}

/**
 * The account whose picture someone shows.
 *
 * @param source - What they chose (`user.avatarSource`), or `null` when they haven't.
 * @param accounts - Their connected accounts, the first connected first.
 * @returns The account, or `null` when they show their initials.
 */
export function pictureAccount<T extends PictureAccount>(
  source: AvatarSource | null,
  accounts: readonly T[],
): T | null {
  if (source === 'initials') {
    return null;
  }
  const usable = accounts.filter(({ image, confirmed }) => image !== null && confirmed);
  const chosen = source ? usable.find(({ providerId }) => providerId === source) : undefined;
  return chosen ?? usable[0] ?? null;
}

/**
 * The providers someone could choose the picture of: those of their
 * confirmed accounts, in the order they connected them, each once.
 *
 * @param accounts - Their connected accounts, the first connected first.
 * @returns The providers.
 */
export function pictureProviders(accounts: readonly PictureAccount[]): OAuthProvider[] {
  return [
    ...new Set(
      accounts
        .filter(({ confirmed }) => confirmed)
        .map(({ providerId }) => providerId)
        .filter(isOAuthProvider),
    ),
  ];
}
