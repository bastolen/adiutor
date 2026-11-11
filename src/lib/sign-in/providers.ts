/**
 * @file Which sign-in providers are configured on this server, from the
 * environment. Kept out of `src/lib/auth.ts`, so the MFA code can ask without
 * loading the auth config.
 */
import type { ProviderAvailability } from '../authz/mfa';
import { env } from '../env';
import {
  MFA_PROVIDERS,
  type MfaProvider,
  OAUTH_PROVIDERS,
  type OAuthProvider,
} from './oauth-providers';

/** A provider's OAuth credentials, both set. */
export interface ProviderCredentials {
  /** The OAuth client ID. */
  clientId: string;
  /** The OAuth client secret. */
  clientSecret: string;
}

/**
 * Pairs a provider's client ID and secret when both are set.
 *
 * @param clientId - The client ID from the environment, if set.
 * @param clientSecret - The client secret from the environment, if set.
 * @returns The credentials, or `null` when either is missing.
 */
function credentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
): ProviderCredentials | null {
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Each provider's OAuth credentials, or `null` when they aren't both set
 * (then its sign-in is off). A new provider needs its credentials read here.
 */
export const providerCredentials: Readonly<Record<OAuthProvider, ProviderCredentials | null>> = {
  github: credentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
  google: credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
};

/** Whether each provider's sign-in is configured: both its OAuth credentials are set. */
export const configuredProviders: Readonly<Record<OAuthProvider, boolean>> = {
  github: providerCredentials.github !== null,
  google: providerCredentials.google !== null,
};

/** The providers whose sign-in is configured, in the order of `OAUTH_PROVIDERS`. */
export const signInProviders: readonly OAuthProvider[] = OAUTH_PROVIDERS.filter(
  (provider) => configuredProviders[provider],
);

/**
 * The providers that can prove MFA and are configured here, for the MFA rules
 * in `src/lib/authz/mfa/`: provider MFA only counts for these. (A list the
 * integration tests change, to turn a provider off; see `turnOffGitHubSignIn`.)
 */
export const availableProviders: ProviderAvailability & MfaProvider[] = MFA_PROVIDERS.filter(
  (provider) => configuredProviders[provider],
);
