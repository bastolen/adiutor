/**
 * @file Which of Better Auth's HTTP endpoints (`/api/auth/*`) are open.
 *
 * Only the endpoints the browser actually uses are reachable; every other
 * one is listed in {@link DISABLED_AUTH_PATHS} and answers 404 over HTTP.
 * Server code can still call them all through `auth.api` (its server
 * actions check the input themselves). `auth-endpoints.test.ts` fails when
 * Better Auth registers an endpoint that's in neither list, so a new plugin
 * or upgrade can't open one by accident: decide which list it belongs in.
 */

/** Endpoints the browser uses: sign-in and its links, the code step, passkeys and security settings. */
export const BROWSER_AUTH_PATHS = [
  '/sign-in/email',
  '/sign-in/magic-link',
  '/magic-link/verify',
  '/sign-in/social',
  '/callback/:id',
  '/link-social',
  '/sign-out',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/verify-email',
  '/error',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/update-passkey',
  '/passkey/delete-passkey',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
] as const;

/**
 * Endpoints closed over HTTP. Some the app uses from the server only
 * (`/update-user`, `/change-password`, `/unlink-account`,
 * `/send-verification-email`, `/get-session`); the others it doesn't use at
 * all, and several would hand out secrets to any session (`/get-access-token`,
 * `/refresh-token`, `/two-factor/get-totp-uri`) or skip the app's checks.
 */
export const DISABLED_AUTH_PATHS = [
  '/account-info',
  '/change-email',
  '/change-password',
  '/delete-user',
  '/delete-user/callback',
  '/get-access-token',
  '/get-session',
  '/list-accounts',
  '/list-sessions',
  '/ok',
  '/passkey/list-user-passkeys',
  '/refresh-token',
  '/revoke-other-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-up/email',
  '/two-factor/get-totp-uri',
  '/unlink-account',
  '/update-session',
  '/update-user',
  '/verify-password',
];
