/**
 * @file Where sign-in emails link to. Better Auth's own link
 * (`/api/auth/magic-link/verify?token=…`) signs in on the first GET, so a
 * mail scanner that opens links to check them would use it up and get the
 * session itself. The email links to a page in the app instead, which names
 * the account the link signs in to; only its "Continue signing in", a form
 * `POST` to the same address that only the page makes, uses the link
 * (`src/lib/sign-in/email-link-plugin.ts`, decision 0041). Every `GET` of
 * Better Auth's link goes to that page first (`confirmSignInLinkFirst` in
 * `src/server/auth/auth-guards/`).
 */

/**
 * How long a sign-in link works, in minutes: Better Auth's `expiresIn` in
 * `src/lib/auth.ts`, and what the email and the confirmation page say.
 */
export const EMAIL_LINK_MINUTES = 5;

/** The confirmation page sign-in emails link to. */
export const EMAIL_LINK_PATH = '/auth/email-link';

/**
 * Better Auth's endpoint of a sign-in link, as its plugins register it: the
 * email's `GET`, which only goes to the confirmation page, and that page's
 * Continue (`POST`), which uses the link and signs in.
 */
export const MAGIC_LINK_ENDPOINT = '/magic-link/verify';

/** The address of {@link MAGIC_LINK_ENDPOINT}, under the app's `/api/auth` handler. */
export const MAGIC_LINK_VERIFY_PATH = `/api/auth${MAGIC_LINK_ENDPOINT}`;

/**
 * The fields of a sign-in link: its query, passed on from the email to the
 * confirmation page, whose Continue posts them to Better Auth.
 */
export const EMAIL_LINK_PARAMS = [
  'token',
  'callbackURL',
  'errorCallbackURL',
  'newUserCallbackURL',
] as const;

/**
 * Turns Better Auth's sign-in link into a link to the confirmation page,
 * with the same token and return addresses.
 *
 * @param magicLinkUrl - The link Better Auth made (`…/api/auth/magic-link/verify?token=…`).
 * @param appUrl - The app's public URL.
 * @returns The link to put in the email.
 */
export function emailLinkUrl(magicLinkUrl: string, appUrl: string): string {
  const source = new URL(magicLinkUrl);
  const target = new URL(EMAIL_LINK_PATH, appUrl);
  EMAIL_LINK_PARAMS.forEach((name) => {
    const value = source.searchParams.get(name);
    if (value !== null) {
      target.searchParams.set(name, value);
    }
  });
  return target.toString();
}
