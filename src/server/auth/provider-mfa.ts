/**
 * @file How each provider that can prove MFA (`MFA_PROVIDERS` in
 * `src/lib/sign-in/oauth-providers.ts`) is asked whether the user's account there
 * has two-factor authentication, with the access token of the sign-in or
 * connection that's just been made (`refreshProviderMfa` in `auth-events/provider-accounts.ts`
 * keeps it only for that request). Every provider in that list needs its
 * check here; the map's type makes a missing one a compile error. A check
 * runs inside the sign-in callback, so it has a time limit
 * ({@link PROVIDER_MFA_CHECK_TIMEOUT_MS}).
 */
import type { MfaProvider } from '@/lib/sign-in/oauth-providers';

/**
 * How long a provider gets to answer, in milliseconds. The check is awaited
 * while the provider's callback is answered, and connecting a new account can
 * ask twice in one request, so a provider that hangs costs the sign-in at
 * most 6 seconds instead of holding it until the platform stops it. Running
 * out counts as no definite answer, like any other failure to reach the
 * provider.
 */
export const PROVIDER_MFA_CHECK_TIMEOUT_MS = 3_000;

/**
 * Reads whether a GitHub profile (from the authenticated-user API) has
 * two-factor authentication turned on. Exported for its unit test.
 *
 * @param profile - The API response.
 * @returns Whether 2FA is on, or `null` when the response doesn't say.
 */
export function githubHasTwoFactor(profile: unknown): boolean | null {
  if (typeof profile !== 'object' || profile === null) {
    return null;
  }
  const answer = (profile as { two_factor_authentication?: unknown }).two_factor_authentication;
  return typeof answer === 'boolean' ? answer : null;
}

/**
 * Asks a provider whether the account an access token belongs to has
 * two-factor authentication.
 *
 * @param accessToken - The account's access token.
 * @returns Whether it has, or `null` without a definite answer (e.g. the
 *   provider answered with an error, or didn't say). It may throw when the
 *   provider can't be reached or doesn't answer in time (a `TimeoutError`);
 *   the caller logs that.
 */
export type ProviderMfaCheck = (accessToken: string) => Promise<boolean | null>;

/** The MFA check of each provider that can prove MFA. */
export const PROVIDER_MFA_CHECKS: Record<MfaProvider, ProviderMfaCheck> = {
  /**
   * GitHub's authenticated-user API says `two_factor_authentication`. The
   * time limit covers the whole answer, its body included.
   *
   * @param accessToken - The GitHub access token.
   * @returns Whether the GitHub account has 2FA, or `null` without an answer.
   */
  github: async (accessToken) => {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Adiutor',
      },
      signal: AbortSignal.timeout(PROVIDER_MFA_CHECK_TIMEOUT_MS),
    });
    return response.ok ? githubHasTwoFactor(await response.json()) : null;
  },
};
