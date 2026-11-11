/**
 * @file The OAuth providers a user can connect, their display names, how
 * their accounts are named (a GitHub username, a Google email address) and
 * identified, which of them can prove MFA, the hint "Confirm with GitHub"
 * sends with its sign-in, and the short-lived cookies that tell the next
 * page about a sign-in with one (an account connected, a step-up that didn't
 * confirm the session). Safe for Client Components; server code imports them
 * from here too.
 *
 * Adding a provider: its ID (Better Auth's provider ID), label, account
 * name claims ({@link PROVIDER_ACCOUNT_NAME_CLAIMS}) and account ID claim
 * ({@link PROVIDER_ACCOUNT_ID_CLAIMS}) here, and in {@link MFA_PROVIDERS}
 * when its API says whether the user's account has two-factor
 * authentication; its credentials in `src/lib/env-schema.ts`, `.env.example`
 * and `src/lib/sign-in/providers.ts`; its `socialProviders` entry in
 * `src/lib/auth.ts`; its icon in `src/components/brand/provider-icons.tsx`;
 * and, for an MFA provider, its check in `src/server/auth/provider-mfa.ts`.
 */
import type { Locale } from '@/lib/i18n/locales';

/** OAuth providers a user can connect. */
export const OAUTH_PROVIDERS = ['github', 'google'] as const;

/** An OAuth provider. */
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Display names per provider. */
export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  github: 'GitHub',
  google: 'Google',
};

/**
 * OAuth providers that can prove MFA: their API says whether the user's
 * account there has two-factor authentication, so signing in with one can
 * count as a second factor (`src/lib/authz/mfa/`). Google can't.
 */
export const MFA_PROVIDERS = ['github'] as const satisfies readonly OAuthProvider[];

/** A provider that can prove MFA. */
export type MfaProvider = (typeof MFA_PROVIDERS)[number];

/**
 * Checks whether a value is one of the {@link MFA_PROVIDERS}.
 *
 * @param value - Any value, e.g. a provider ID.
 * @returns Whether it's a provider that can prove MFA.
 */
export function isMfaProvider(value: unknown): value is MfaProvider {
  return MFA_PROVIDERS.includes(value as MfaProvider);
}

/**
 * Joins provider names for a sentence in the reader's language: "GitHub",
 * "GitHub or Google" ("GitHub of Google", "GitHub o Google"). Pass the result
 * as a named argument of a whole-sentence message.
 *
 * @param providers - The providers.
 * @param locale - The reader's language.
 * @returns Their labels, joined with the language's "or".
 */
export function providerList(providers: readonly OAuthProvider[], locale: Locale): string {
  return new Intl.ListFormat(locale, { type: 'disjunction' }).format(
    providers.map((provider) => PROVIDER_LABELS[provider]),
  );
}

/**
 * Checks whether a value is one of the {@link OAUTH_PROVIDERS}.
 *
 * @param value - Any value.
 * @returns Whether it's a provider ID.
 */
export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return OAUTH_PROVIDERS.includes(value as OAuthProvider);
}

/**
 * The display name of a provider ID that may not be a configured provider,
 * e.g. one stored in the database or the audit log: its label, or the ID
 * itself for a provider that was since removed.
 *
 * @param providerId - The provider ID.
 * @returns The name to show.
 */
export function providerLabel(providerId: string): string {
  return isOAuthProvider(providerId) ? PROVIDER_LABELS[providerId] : providerId;
}

/**
 * The claim of a provider's profile that names the account the way its owner
 * knows it: GitHub's username, Google's email address. Shown
 * next to a connected account so the user can tell which one it is
 * (`src/server/auth/auth-events/` stores it when they sign in or connect with
 * it). Only for display: accounts are always matched by their ID.
 */
export const PROVIDER_ACCOUNT_NAME_CLAIMS: Record<OAuthProvider, string> = {
  github: 'login',
  google: 'email',
};

/** The longest account name kept: the longest an email address can be. */
export const MAX_ACCOUNT_NAME_LENGTH = 254;

/**
 * Control, format (bidi overrides, zero-width), line and paragraph separator
 * characters, which could make a name look like another one.
 */
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Cleans an account name from a provider (or from storage) for display: only
 * text, without characters that hide or reorder others, with single spaces.
 * A name that's empty or too long afterwards is dropped rather than cut, so
 * a shortened name can't pass for another account's.
 *
 * @param value - The claim's value, as the provider sent it.
 * @returns The name, or `null` when there's no usable one.
 */
export function cleanAccountName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = value.normalize('NFC').replace(INVISIBLE_CHARACTERS, '').replace(/\s+/g, ' ').trim();
  return name && name.length <= MAX_ACCOUNT_NAME_LENGTH ? name : null;
}

/**
 * Reads the account name from a provider's profile, from its claim in
 * {@link PROVIDER_ACCOUNT_NAME_CLAIMS} (the profile's own keys only).
 *
 * @param provider - The provider.
 * @param profile - The provider's profile (user info or ID token claims), unchecked.
 * @returns The name, cleaned (`cleanAccountName`), or `null` when there's no usable one.
 */
export function accountNameFromProfile(provider: OAuthProvider, profile: unknown): string | null {
  const claim = PROVIDER_ACCOUNT_NAME_CLAIMS[provider];
  if (!profile || typeof profile !== 'object' || !Object.hasOwn(profile, claim)) {
    return null;
  }
  return cleanAccountName((profile as Record<string, unknown>)[claim]);
}

/**
 * The claim of a provider's profile that holds the account's ID at the
 * provider, as Better Auth stores it in `account.accountId` (its
 * `accountSubject`: GitHub's numeric `id`, Google's `sub`). The re-verify
 * check (`checkReverify` in `src/server/auth/auth-events/reverify.ts`) finds the account
 * that signed in by it; a claim that doesn't match Better Auth's finds no
 * account, which refuses the re-verify rather than letting it through.
 */
export const PROVIDER_ACCOUNT_ID_CLAIMS: Record<OAuthProvider, string> = {
  github: 'id',
  google: 'sub',
};

/**
 * Reads the account's ID at the provider from its profile, from the claim in
 * {@link PROVIDER_ACCOUNT_ID_CLAIMS} (the profile's own key only), the way
 * Better Auth turns it into `account.accountId` (a number as its digits).
 *
 * @param provider - The provider.
 * @param profile - The provider's profile (user info or ID token claims), unchecked.
 * @returns The ID, or `null` without a usable one.
 */
export function accountIdFromProfile(provider: OAuthProvider, profile: unknown): string | null {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const claim = PROVIDER_ACCOUNT_ID_CLAIMS[provider];
  if (!Object.hasOwn(profile, claim)) {
    return null;
  }
  const value = (profile as Record<string, unknown>)[claim];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * The key of the hint "Confirm with GitHub" on the step-up page sends with
 * its sign-in (`additionalData` of Better Auth's `signIn.social`, set to
 * `true`): this sign-in confirms the browser's session (a re-verify). The
 * hint itself is never trusted, since the browser can send anything: the
 * server marks the sign-in as a re-verify only for a browser with a live
 * session (`markReverify` in `src/server/auth/reverify-marker.ts`), and then only
 * the user's own confirmed account of that provider may answer it. Without
 * the hint, it's a plain sign-in with the provider.
 */
export const REVERIFY_HINT = 'adiutorReverify';

/**
 * Cookie that tells the next page a provider account was connected while
 * signing in with it (set by `afterAccountCreate`, read by
 * `ProviderLinkedNotice`). Its value is written by
 * {@link providerLinkedCookieValue}. It names the account, so it's removed
 * when someone signs out or another sign-in starts on the browser
 * (`clearStaleProviderLinkedCookie`).
 */
export const PROVIDER_LINKED_COOKIE = 'adiutor-provider-linked';

/**
 * The value of {@link PROVIDER_LINKED_COOKIE}: the provider ID, and the
 * account's name after a colon when it's known.
 *
 * @param provider - The provider.
 * @param accountName - The account's name there, if known.
 * @returns E.g. `github:octocat`, or `github`.
 */
export function providerLinkedCookieValue(
  provider: OAuthProvider,
  accountName?: string | null,
): string {
  const name = cleanAccountName(accountName);
  return name ? `${provider}:${name}` : provider;
}

/**
 * Reads {@link PROVIDER_LINKED_COOKIE}. The browser can change the cookie, so
 * the provider must be a known one and the name is cleaned again.
 *
 * @param value - The cookie's value (already decoded), if any.
 * @returns The provider and the account's name, or `null` for anything else.
 */
export function parseProviderLinkedCookie(
  value: string | null | undefined,
): { provider: OAuthProvider; accountName: string | null } | null {
  if (!value) {
    return null;
  }
  const colon = value.indexOf(':');
  const provider = colon === -1 ? value : value.slice(0, colon);
  if (!isOAuthProvider(provider)) {
    return null;
  }
  return {
    provider,
    accountName: colon === -1 ? null : cleanAccountName(value.slice(colon + 1)),
  };
}

/**
 * Cookie that tells the next page why "Confirm with GitHub" on the step-up
 * page didn't confirm the session (set by `recordProviderSession` in
 * `src/server/auth/auth-events/`, read by `ProviderStepUpNotice`), wherever the
 * user lands: back on the step-up page, on the Security page to set up MFA,
 * or on the page they came for. Its value is written by
 * {@link providerStepUpCookieValue}: the provider and the reason, never the
 * account (whose name is personal data). It's removed once the session is
 * confirmed, when someone signs out, and when another sign-in starts on the
 * browser (`clearStaleProviderStepUpCookie`).
 */
export const PROVIDER_STEP_UP_COOKIE = 'adiutor-provider-step-up';

/**
 * Why a provider that can prove MFA didn't confirm a session on the step-up
 * page: two-factor authentication is off for the account that signed in
 * (`mfa-off`), or the provider couldn't tell us (`unchecked`: unreachable, no
 * definite answer, or the check never ran). Any other account than the
 * user's own confirmed one is refused before a session is created
 * (`REVERIFY_WRONG_ACCOUNT`), so it needs no outcome here.
 */
export const PROVIDER_STEP_UP_OUTCOMES = ['mfa-off', 'unchecked'] as const;

/** One of the {@link PROVIDER_STEP_UP_OUTCOMES}. */
export type ProviderStepUpOutcome = (typeof PROVIDER_STEP_UP_OUTCOMES)[number];

/**
 * Checks whether a value is one of the {@link PROVIDER_STEP_UP_OUTCOMES}.
 *
 * @param value - Any value.
 * @returns Whether it's a known outcome.
 */
function isProviderStepUpOutcome(value: unknown): value is ProviderStepUpOutcome {
  return PROVIDER_STEP_UP_OUTCOMES.includes(value as ProviderStepUpOutcome);
}

/**
 * The value of {@link PROVIDER_STEP_UP_COOKIE}: the provider ID and the
 * outcome, after a colon.
 *
 * @param provider - The provider the user confirmed with.
 * @param outcome - Why it didn't confirm the session.
 * @returns E.g. `github:mfa-off`.
 */
export function providerStepUpCookieValue(
  provider: MfaProvider,
  outcome: ProviderStepUpOutcome,
): string {
  return `${provider}:${outcome}`;
}

/**
 * Reads {@link PROVIDER_STEP_UP_COOKIE}. The browser can change the cookie,
 * so the provider must be one that can prove MFA and the outcome a known one.
 *
 * @param value - The cookie's value (already decoded), if any.
 * @returns The provider and the outcome, or `null` for anything else.
 */
export function parseProviderStepUpCookie(
  value: string | null | undefined,
): { provider: MfaProvider; outcome: ProviderStepUpOutcome } | null {
  if (!value) {
    return null;
  }
  const colon = value.indexOf(':');
  if (colon === -1) {
    return null;
  }
  const provider = value.slice(0, colon);
  const outcome = value.slice(colon + 1);
  if (!isMfaProvider(provider) || !isProviderStepUpOutcome(outcome)) {
    return null;
  }
  return { provider, outcome };
}
