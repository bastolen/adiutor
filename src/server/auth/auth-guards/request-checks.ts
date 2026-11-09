/**
 * @file Checks on the request itself, without the database: sign-in links only
 * from the app's own page, return addresses that are pages of the app, and
 * passkey names.
 */
import { APIError } from 'better-auth/api';

import { isSafeAppRedirect } from '@/lib/redirect';
import { EMAIL_LINK_PARAMS, EMAIL_LINK_PATH } from '@/lib/sign-in/email-link';
import { INVALID_PASSKEY_NAME, UNSAFE_RETURN_ADDRESS } from '@/lib/sign-in/sign-in-refusals';
import { passkeyNameSchema } from '@/lib/validation';

import type { AuthGuardContext } from './paths';
import { refusalBody } from './refusal-messages';

/**
 * Sends a sign-in link that wasn't opened through the "Continue signing in"
 * click on the app's own page to that page instead, before it's used.
 * Browsers say where a request comes from (`Sec-Fetch-Site`) and whether the
 * user caused it (`Sec-Fetch-User`); the click is a same-origin, user-made
 * navigation. Requests without these headers don't come from a browser, so
 * there's nobody to sign in by surprise; they're left to Better Auth.
 *
 * @param ctx - The endpoint context.
 * @throws {APIError} A redirect to the confirmation page.
 */
export function confirmSignInLinkFirst(ctx: AuthGuardContext): void {
  const site = ctx.headers?.get('sec-fetch-site');
  if (!site || (site === 'same-origin' && ctx.headers?.get('sec-fetch-user') === '?1')) {
    return;
  }
  const link = new URLSearchParams();
  EMAIL_LINK_PARAMS.forEach((name) => {
    const value = ctx.query?.[name];
    if (typeof value === 'string') {
      link.set(name, value);
    }
  });
  throw new APIError('FOUND', undefined, new Headers({ location: `${EMAIL_LINK_PATH}?${link}` }));
}

/** The return addresses of a sign-in, a social sign-in or an emailed link. */
const CALLBACK_FIELDS = ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const;

/** Where an endpoint takes its return addresses, and which ones. */
interface ReturnAddressFields {
  /** The JSON body, or the query of a link the browser opens (`GET`). */
  readonly in: 'body' | 'query';
  /** The fields that hold return addresses. */
  readonly fields: readonly string[];
}

/**
 * The endpoints that take return addresses, checked with
 * `isSafeAppRedirect` ({@link refuseUnsafeReturnAddresses}).
 * `/send-verification-email` is closed over HTTP, but the server calls it;
 * `/verify-email` is the link it emails.
 */
const RETURN_ADDRESS_FIELDS: ReadonlyMap<string, ReturnAddressFields> = new Map([
  ['/sign-in/magic-link', { in: 'body', fields: CALLBACK_FIELDS }],
  ['/magic-link/verify', { in: 'query', fields: CALLBACK_FIELDS }],
  ['/sign-in/social', { in: 'body', fields: CALLBACK_FIELDS }],
  ['/link-social', { in: 'body', fields: ['callbackURL', 'errorCallbackURL'] }],
  ['/request-password-reset', { in: 'body', fields: ['redirectTo'] }],
  ['/verify-email', { in: 'query', fields: ['callbackURL'] }],
  ['/send-verification-email', { in: 'body', fields: ['callbackURL'] }],
]);

/** The sign-in error page, which explains a refused link (`src/app/sign-in-error`). */
const SIGN_IN_ERROR_PATH = '/sign-in-error';

/**
 * Refuses a request with a return address that isn't a page of the app
 * (`isSafeAppRedirect`): another site, or an endpoint under `/api` such as
 * a second sign-in link. Fields that aren't sent are fine. A link the
 * browser opened goes to the sign-in error page, which explains it; other
 * requests get the refusal as an error.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint path.
 * @throws {APIError} A redirect to the sign-in error page for links, or
 *   `BAD_REQUEST`, both with code `UNSAFE_RETURN_ADDRESS`.
 */
export function refuseUnsafeReturnAddresses(ctx: AuthGuardContext, path: string): void {
  const rule = RETURN_ADDRESS_FIELDS.get(path);
  if (!rule) {
    return;
  }
  const values = rule.in === 'query' ? ctx.query : ctx.body;
  const unsafe = rule.fields.some((field) => {
    const value = values?.[field];
    return value !== undefined && value !== null && !isSafeAppRedirect(value);
  });
  if (!unsafe) {
    return;
  }
  if (rule.in === 'query') {
    const location = `${SIGN_IN_ERROR_PATH}?${new URLSearchParams({ error: UNSAFE_RETURN_ADDRESS.code })}`;
    throw new APIError('FOUND', undefined, new Headers({ location }));
  }
  throw new APIError('BAD_REQUEST', refusalBody(ctx, UNSAFE_RETURN_ADDRESS.code));
}

/**
 * Where Better Auth's passkey plugin takes a passkey's name: the query of
 * `/passkey/generate-register-options` (the user name the new passkey keeps
 * on the device), the body of `/passkey/verify-registration` (the name stored
 * with it) and the body of `/passkey/update-passkey` (a rename).
 */
const PASSKEY_NAME_FIELDS: ReadonlyMap<string, 'body' | 'query'> = new Map([
  ['/passkey/generate-register-options', 'query'],
  ['/passkey/verify-registration', 'body'],
  ['/passkey/update-passkey', 'body'],
]);

/**
 * Refuses a passkey name that `passkeyNameSchema` doesn't accept: empty,
 * longer than 64 characters, or with line breaks, control characters or
 * characters that hide or reorder text. Better Auth's own check only trims
 * it, without a length limit. A name that isn't sent is fine: a passkey added
 * without one gets none, and Better Auth refuses a rename without one itself.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint path.
 * @throws {APIError} `BAD_REQUEST` with code `INVALID_PASSKEY_NAME`.
 */
export function refuseInvalidPasskeyName(ctx: AuthGuardContext, path: string): void {
  const where = PASSKEY_NAME_FIELDS.get(path);
  if (!where) {
    return;
  }
  const name = (where === 'query' ? ctx.query : ctx.body)?.name;
  if (name === undefined || name === null) {
    return;
  }
  if (!passkeyNameSchema.safeParse(name).success) {
    throw new APIError('BAD_REQUEST', refusalBody(ctx, INVALID_PASSKEY_NAME.code));
  }
}
