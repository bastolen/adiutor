/**
 * @file Better Auth client for use in Client Components.
 *
 * Talks to the auth API at `/api/auth/*` on the same origin.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import {
  lastLoginMethodClient,
  magicLinkClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { LAST_USED_LOGIN_METHOD_COOKIE } from './auth-cookies';

/**
 * Auth client: `signIn` (password, magic link, social, passkey), `signOut`,
 * `twoFactor`, `passkey`, password reset, `getLastUsedLoginMethod` and more. A password sign-in that
 * needs the second step returns `twoFactorRedirect: true`; the sign-in form
 * handles that itself.
 */
const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    twoFactorClient(),
    passkeyClient(),
    lastLoginMethodClient({ cookieName: LAST_USED_LOGIN_METHOD_COOKIE }),
  ],
});

export default authClient;
