/**
 * @file The bodies of the guards' refusals, worded in the language of the
 * request they refuse: noted once when the guards start on it
 * (`noteRefusalLocale`: the language cookie, else Adiutor's default language,
 * else before setup `Accept-Language`), so the refusals themselves stay
 * synchronous. Forms turn most codes into their message themselves; the
 * refusals in `SERVER_WORDED_CODES` carry details only the server knows (how
 * long to wait, which providers), so forms show these messages as they come.
 * See docs/authentication.md, "How refusals reach the user".
 */
import type { DatabaseOrTransaction } from '@/db';
import { localeFromHeaders } from '@/lib/i18n/default-locale';
import type { Locale } from '@/lib/i18n/locales';
import { localeCookieFromHeaders, resolveLocale } from '@/lib/i18n/resolve-locale';
import translator from '@/lib/i18n/translator';
import { type AuthErrorCode, authCodeText } from '@/lib/sign-in/auth-error-messages';
import { type OAuthProvider, providerList } from '@/lib/sign-in/oauth-providers';
import {
  PASSWORD_SIGN_IN_PAUSED,
  RESET_ENDS_PROVIDER_MFA,
  TOO_MANY_ATTEMPTS,
} from '@/lib/sign-in/sign-in-refusals';

import { waitMinutes } from '../../rate-limit';

/** What a refusal's body says: the code forms react to, and the message. */
interface RefusalBody {
  /** The error code (`error.code` in the browser). */
  code: string;
  /** The message, in the request's language. */
  message: string;
}

/** The part of a request a refusal's wording depends on. */
interface RefusedRequest {
  /** The request's headers, if known (its language cookie). */
  headers?: Headers | null;
}

/**
 * Each request's language, noted when the guards start on it. Keyed by the
 * request's context object, so it goes with the request.
 */
const requestLocales = new WeakMap<RefusedRequest, Locale>();

/**
 * Works out the language a request's refusals are worded in, the same way as
 * its pages: the language cookie while Adiutor offers that language, else
 * Adiutor's default language, else (before setup) `Accept-Language`, else
 * English (US). Reads Adiutor's language settings every time
 * (`localeFromHeaders`), cookie or not, so `beforeAuthRequest` calls it once
 * per request it checks, and not for reading the session, which nothing
 * refuses.
 *
 * @param request - The request the guards are about to check.
 * @param db - Database client, for Adiutor's default language.
 */
export async function noteRefusalLocale(
  request: RefusedRequest,
  db: DatabaseOrTransaction,
): Promise<void> {
  requestLocales.set(request, await localeFromHeaders(request.headers, db));
}

/**
 * The language a refusal is worded in: the one noted for the request, which
 * `beforeAuthRequest` always notes before any check that can refuse. Only a
 * refusal worded without it (the unit tests of these bodies) falls back to
 * what the headers alone say (the cookie, then `Accept-Language`), without
 * Adiutor's settings.
 *
 * @param request - The refused request.
 * @returns The locale.
 */
function localeOf(request: RefusedRequest): Locale {
  return (
    requestLocales.get(request) ??
    resolveLocale({
      cookie: localeCookieFromHeaders(request.headers),
      acceptLanguage: request.headers?.get('accept-language'),
    })
  );
}

/**
 * The `auth` messages in a request's language.
 *
 * @param request - The refused request.
 * @returns `t` for the `auth` namespace.
 */
function translatorFor(request: RefusedRequest) {
  return translator(localeOf(request), 'auth');
}

/**
 * A refusal whose message forms look up by its code: the message is for
 * other clients, in the request's language too.
 *
 * @param request - The refused request.
 * @param code - The refusal's code, one with a message of its own.
 * @returns The body.
 */
export function refusalBody(request: RefusedRequest, code: AuthErrorCode): RefusalBody {
  return { code, message: authCodeText(translatorFor(request), code) };
}

/**
 * Too many sign-ins, emails or codes: says how long to wait.
 *
 * @param request - The refused request.
 * @param retryAfterSeconds - When the limit's window resets.
 * @returns The body, e.g. "Too many attempts. Try again in 12 minutes."
 */
export function tooManyAttemptsBody(
  request: RefusedRequest,
  retryAfterSeconds: number,
): RefusalBody {
  return {
    code: TOO_MANY_ATTEMPTS.code,
    message: translator(localeOf(request), 'errors')('tooManyAttempts', {
      minutes: waitMinutes(retryAfterSeconds),
    }),
  };
}

/**
 * Password sign-in for an address is paused: says for how long, and the ways
 * in that still work. The same for every address, whether or not it has an
 * account.
 *
 * @param request - The refused request.
 * @param retryAfterSeconds - When the pause ends.
 * @returns The body.
 */
export function passwordSignInPausedBody(
  request: RefusedRequest,
  retryAfterSeconds: number,
): RefusalBody {
  return {
    code: PASSWORD_SIGN_IN_PAUSED.code,
    message: translatorFor(request)('codes.server.passwordSignInPaused', {
      minutes: waitMinutes(retryAfterSeconds),
    }),
  };
}

/**
 * A reset link can't set the first password of an account whose MFA is a
 * provider account: names the providers to sign in with instead, and for
 * roles that require MFA asks for a passkey or an authenticator app first.
 *
 * @param request - The refused request.
 * @param providers - The providers whose accounts give the account its MFA
 *   (`mfaGivingProviders`); with none, the wording doesn't name one.
 * @param mfaRequired - Whether the user's role requires MFA (`requiresMfa`).
 * @returns The body.
 */
export function resetEndsProviderMfaBody(
  request: RefusedRequest,
  providers: readonly OAuthProvider[],
  mfaRequired: boolean,
): RefusalBody {
  const locale = localeOf(request);
  const t = translator(locale, 'auth');
  const mfa = mfaRequired ? 'required' : 'other';
  return {
    code: RESET_ENDS_PROVIDER_MFA.code,
    message:
      providers.length > 0
        ? t('codes.server.resetEndsProviderMfa', {
            providers: providerList(providers, locale),
            mfa,
          })
        : t('codes.server.resetEndsProviderMfaUnnamed', { mfa }),
  };
}

/**
 * `/two-factor/enable` asked to turn on email codes, which only their own
 * code step may do (proving a code arrives).
 *
 * @param request - The refused request.
 * @returns The body.
 */
export function twoFactorMethodNotAllowedBody(request: RefusedRequest): RefusalBody {
  return {
    code: 'TWO_FACTOR_METHOD_NOT_ALLOWED',
    message: translatorFor(request)('codes.server.twoFactorMethodNotAllowed'),
  };
}
