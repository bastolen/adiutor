/**
 * @file Which picture a person shows: the picture of one of their connected
 * GitHub or Google accounts, or their initials. Pure, so the services, the
 * account page and Better Auth's configuration share one rule.
 *
 * Each provider is offered by one account (`choiceAccounts`): its first
 * confirmed account that has a picture, else its first confirmed one,
 * offered without a picture yet. The picture someone shows is always one of
 * these, so a provider's option names, previews and saves the account whose
 * picture shows. Someone who hasn't chosen shows the picture of the account
 * they connected first that has one, and their initials when none has. A
 * choice of a provider shows its account; once it's disconnected, or while
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
 * The accounts whose pictures someone can choose, one per provider of their
 * confirmed accounts: of that provider's confirmed accounts, the first
 * connected that has a picture, else the first connected (without a picture
 * yet). It's the one rule for which account stands for a provider: the
 * picture someone shows (`pictureAccount`) and the account page's options
 * both follow it.
 *
 * @param accounts - Their connected accounts, the first connected first.
 * @returns One account per provider, in the order those accounts were connected.
 */
export function choiceAccounts<T extends PictureAccount>(
  accounts: readonly T[],
): { providerId: OAuthProvider; account: T }[] {
  const confirmed = accounts.filter((found) => found.confirmed);
  return confirmed.flatMap((candidate) => {
    const { providerId } = candidate;
    if (!isOAuthProvider(providerId)) {
      return [];
    }
    const ofProvider = confirmed.filter((found) => found.providerId === providerId);
    const standsFor = ofProvider.find(({ image }) => image !== null) ?? ofProvider[0];
    return standsFor === candidate ? [{ providerId, account: candidate }] : [];
  });
}

/**
 * The account whose picture someone shows: of the accounts they can choose
 * (`choiceAccounts`) that have a picture, the chosen provider's, else the
 * first connected.
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
  const withPicture = choiceAccounts(accounts).filter(({ account }) => account.image !== null);
  const chosen = withPicture.find(({ providerId }) => providerId === source);
  return (chosen ?? withPicture[0])?.account ?? null;
}
