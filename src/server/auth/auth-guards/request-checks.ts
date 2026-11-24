/**
 * @file Checks on the request itself, without the database: sign-in links only
 * from their own page's Continue, return addresses that are pages of the
 * app, and passkey names.
 */
import { APIError } from 'better-auth/api';

import { isSafeAppRedirect } from '@/lib/redirect';
import isOwnPagePost from '@/lib/request/own-page-post';
import { EMAIL_LINK_PARAMS, EMAIL_LINK_PATH } from '@/lib/sign-in/email-link';
import { INVALID_PASSKEY_NAME, UNSAFE_RETURN_ADDRESS } from '@/lib/sign-in/sign-in-refusals';
import { passkeyNameSchema } from '@/lib/validation';

import type { AuthGuardContext } from './paths';
import { refusalBody } from './refusal-messages';

/**
 * Lets a sign-in link (`/magic-link/verify`) sign in only with the "Continue
 * signing in" on its own page (`/auth/email-link`, decision 0041): that
 * page's form `POST`, as a page load a page of this site started
 * (`isOwnPagePost`: by the browser's `Sec-Fetch-*` headers, or by an `Origin`
 * that's exactly the site's where the browser sends none of them), which
 * needn't say a person clicked (Safari never does). Anything else goes to
 * that page instead, with the link's fields and unused, so the page names
 * the account first and waits for its Continue:
 *
 * - every `GET` of the link, whatever its headers: one opened from an email,
 *   another site or a script, by a program that isn't a browser, by a
 *   browser that says nothing about where it came from (Safari before 16.4,
 *   or any browser on plain `http` away from `localhost`), and a link written
 *   in a request's text, which is a same-origin click on the request's page;
 * - any other `POST`: another site's form, or one without the headers or
 *   the site's `Origin` (answered with a 303, so the browser opens the page
 *   with a `GET`).
 *
 * @param ctx - The endpoint context.
 * @throws {APIError} A redirect to the confirmation page.
 */
export function confirmSignInLinkFirst(ctx: AuthGuardContext): void {
  const posted = ctx.method === 'POST';
  if (isOwnPagePost(ctx.headers ?? new Headers(), posted)) {
    return;
  }
  const sent = posted ? ctx.body : ctx.query;
  const link = new URLSearchParams();
  EMAIL_LINK_PARAMS.forEach((name) => {
    const value = sent?.[name];
    if (typeof value === 'string') {
      link.set(name, value);
    }
  });
  throw new APIError(
    posted ? 'SEE_OTHER' : 'FOUND',
    undefined,
    new Headers({ location: `${EMAIL_LINK_PATH}?${link}` }),
  );
}

/** The return addresses of a sign-in, a social sign-in or an emailed link. */
const CALLBACK_FIELDS = ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const;

/** Where an endpoint takes its return addresses, and which ones. */
export interface ReturnAddressFields {
  /** The body (JSON, or a form's), or the query of a link the browser opens (`GET`). */
  readonly in: 'body' | 'query';
  /**
   * Whether the body is a form the browser posts as a page load (a sign-in
   * link's Continue), so a refusal goes to the sign-in error page, as for a
   * link, rather than coming back as an error.
   */
  readonly form?: boolean;
  /** The fields that hold return addresses. */
  readonly fields: readonly string[];
}

/**
 * The endpoints that take return addresses, checked with
 * `isSafeAppRedirect` ({@link refuseUnsafeReturnAddresses}), by the path
 * Better Auth registers them with, which is what the hooks get: the pattern
 * (`/reset-password/:token`), not the path of the request.
 * `/send-verification-email` is closed over HTTP, but the server calls it;
 * `/verify-email` is the link it emails. `/reset-password/:token` is the link
 * of a reset email: Better Auth sends the browser on to its `callbackURL`
 * with the token, or with `error=INVALID_TOKEN`, having only checked that
 * it's on this site.
 *
 * `/magic-link/verify` is listed with its confirmation page's Continue (a
 * form `POST`): every `GET` of it goes to that page before anything else
 * ({@link confirmSignInLinkFirst}), and the page passes only safe addresses
 * on.
 *
 * `request-checks.test.ts` fails when an endpoint the browser can reach takes
 * a return address that isn't listed here: add it, or say there why Better
 * Auth never sends the browser to it.
 */
export const RETURN_ADDRESS_FIELDS: ReadonlyMap<string, ReturnAddressFields> = new Map([
  ['/sign-in/magic-link', { in: 'body', fields: CALLBACK_FIELDS }],
  ['/magic-link/verify', { in: 'body', form: true, fields: CALLBACK_FIELDS }],
  ['/sign-in/social', { in: 'body', fields: CALLBACK_FIELDS }],
  ['/link-social', { in: 'body', fields: ['callbackURL', 'errorCallbackURL'] }],
  ['/request-password-reset', { in: 'body', fields: ['redirectTo'] }],
  ['/reset-password/:token', { in: 'query', fields: ['callbackURL'] }],
  ['/verify-email', { in: 'query', fields: ['callbackURL'] }],
  ['/send-verification-email', { in: 'body', fields: ['callbackURL'] }],
]);

/** The sign-in error page, which explains a refused link (`src/app/sign-in-error`). */
const SIGN_IN_ERROR_PATH = '/sign-in-error';

/**
 * Refuses a request with a return address that isn't a page of the app
 * (`isSafeAppRedirect`): another site, or an endpoint under `/api` such as
 * a second sign-in link. Fields that aren't sent are fine. A link the
 * browser opened, or a form it posted as a page load, goes to the sign-in
 * error page, which explains it (a form's with a 303, so the browser opens
 * it with a `GET`); other requests get the refusal as an error.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint path.
 * @throws {APIError} A redirect to the sign-in error page for links and forms,
 *   or `BAD_REQUEST`, both with code `UNSAFE_RETURN_ADDRESS`.
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
  if (rule.in === 'query' || rule.form) {
    const location = `${SIGN_IN_ERROR_PATH}?${new URLSearchParams({ error: UNSAFE_RETURN_ADDRESS.code })}`;
    throw new APIError(rule.form ? 'SEE_OTHER' : 'FOUND', undefined, new Headers({ location }));
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
