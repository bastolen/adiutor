/**
 * @file Factories for sign-in methods and sessions: sign-in links, two-step
 * verification, connected provider accounts, passkeys, passwords and
 * sessions.
 */
import { randomUUID } from 'node:crypto';

import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { account, passkey, session, twoFactor, user, verification } from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import { firstRow } from '@/lib/defined';
import { EMAIL_LINK_MINUTES } from '@/lib/sign-in/email-link';
import type { OAuthProvider } from '@/lib/sign-in/oauth-providers';
import { emailLinkVerificationIdentifier, generateToken } from '@/lib/sign-in/tokens';

/**
 * Stores a sign-in link the way Better Auth's magic-link plugin does, without
 * sending an email (like `storeSignInLink` in `e2e/support/db.ts`).
 *
 * @param db - Test database.
 * @param email - The address it's for.
 * @returns The link's token.
 */
export async function storeSignInLink(db: Database, email: string): Promise<string> {
  const token = generateToken();
  await db.insert(verification).values({
    identifier: emailLinkVerificationIdentifier(token),
    value: JSON.stringify({ type: 'magic-link', email }),
    expiresAt: new Date(Date.now() + EMAIL_LINK_MINUTES * 60_000),
  });
  return token;
}

/**
 * Turns on two-step verification for a user: with an authenticator app (a
 * verified secret row, as Better Auth stores it), or with email codes only.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param method - `authenticator` (default) or `email`.
 */
export async function enableTwoFactor(
  db: Database,
  userId: string,
  method: 'authenticator' | 'email' = 'authenticator',
): Promise<void> {
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, userId));
  if (method === 'authenticator') {
    await db.insert(twoFactor).values({
      userId,
      secret: 'encrypted-secret',
      backupCodes: 'encrypted-codes',
      verified: true,
    });
  }
}

/**
 * Starts setting up an authenticator app without finishing it: the secret
 * row Better Auth stores before the app's first code is checked
 * (`verified: false`). It doesn't count as an authenticator app, and its
 * backup codes don't work, until a code finishes the setup.
 *
 * @param db - Test database.
 * @param userId - The user.
 */
export async function startAuthenticatorSetup(db: Database, userId: string): Promise<void> {
  await db.insert(twoFactor).values({
    userId,
    secret: 'encrypted-secret',
    backupCodes: 'encrypted-codes',
    verified: false,
  });
}

/**
 * Connects a GitHub or Google account to a user, as Better Auth stores it.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param options - Optional details.
 * @param options.providerId - `github` (default) or `google`.
 * @param options.mfaVerified - Whether the provider account has two-factor authentication;
 *   defaults to `true`.
 * @param options.confirmed - Whether it counts yet (see `beforeAccountCreate`); defaults to `true`.
 * @param options.accountName - Its name at the provider (`accountName`); none by default.
 * @param options.accessToken - Its access token; none by default.
 * @param options.updatedAt - When it was last used to sign in; defaults to now.
 * @param options.accountId - The provider's ID for the account; random by default.
 * @param options.accountImage - The address of its picture at the provider.
 * @param options.createdAt - When it was connected; now by default.
 * @returns The account row's ID (what Better Auth's unlink takes).
 */
export async function connectProvider(
  db: Database,
  userId: string,
  options: {
    providerId?: OAuthProvider;
    mfaVerified?: boolean;
    confirmed?: boolean;
    accountName?: string;
    accessToken?: string;
    updatedAt?: Date;
    accountId?: string;
    accountImage?: string;
    createdAt?: Date;
  } = {},
): Promise<string> {
  const providerId = options.providerId ?? 'github';
  const created = firstRow(
    await db
      .insert(account)
      .values({
        userId,
        accountId: options.accountId ?? `${providerId}-${randomUUID()}`,
        providerId,
        mfaVerified: options.mfaVerified ?? true,
        confirmed: options.confirmed ?? true,
        accountName: options.accountName,
        accessToken: options.accessToken,
        updatedAt: options.updatedAt,
        accountImage: options.accountImage,
        createdAt: options.createdAt,
      })
      .returning({ id: account.id }),
    'the new account',
  );
  return created.id;
}

/**
 * Connects a GitHub account to a user, as Better Auth stores it.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param mfaVerified - Whether the GitHub account has two-factor authentication.
 * @returns The account row's ID.
 */
export async function connectGitHub(
  db: Database,
  userId: string,
  mfaVerified = true,
): Promise<string> {
  return connectProvider(db, userId, { mfaVerified });
}

/**
 * Gives a user a passkey, as Better Auth stores it once registration is
 * verified.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @returns The passkey's ID.
 */
export async function addPasskey(db: Database, userId: string): Promise<string> {
  const created = firstRow(
    await db
      .insert(passkey)
      .values({
        userId,
        name: 'Adiutor Tests laptop',
        publicKey: 'adiutor-tests-public-key',
        credentialID: `adiutor-tests-credential-${randomUUID()}`,
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
      })
      .returning({ id: passkey.id }),
    'the new passkey',
  );
  return created.id;
}

/**
 * Gives a user a password, as a password reset does for an account without one.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param password - A password Better Auth can check, which it's hashed from; without one, a
 *   fake hash is stored (fast, for tests that never sign in with it).
 */
export async function addPassword(db: Database, userId: string, password?: string): Promise<void> {
  await db.insert(account).values({
    userId,
    accountId: userId,
    providerId: 'credential',
    password: password === undefined ? 'hashed-password' : await hashPassword(password),
  });
}

/**
 * Creates a session (signed-in device) for a user. Without `mfaMethod` it's
 * a session without a second factor, as after a password or email-link
 * sign-in.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param options - Optional details.
 * @param options.expiresAt - When it expires; defaults to a week from now.
 * @param options.userAgent - The browser.
 * @param options.mfaMethod - The second factor its sign-in or a step-up had, which marks it
 *   MFA verified.
 * @param options.mfaVerifiedAt - When that second factor was proven; defaults to `null`.
 * @returns The session ID.
 */
export async function createSession(
  db: Database,
  userId: string,
  options: {
    expiresAt?: Date;
    userAgent?: string;
    mfaMethod?: MfaMethod;
    mfaVerifiedAt?: Date | null;
  } = {},
): Promise<string> {
  const created = firstRow(
    await db
      .insert(session)
      .values({
        userId,
        token: randomUUID(),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: options.userAgent ?? null,
        mfaVerified: options.mfaMethod !== undefined,
        mfaMethod: options.mfaMethod ?? null,
        mfaVerifiedAt: options.mfaVerifiedAt ?? null,
      })
      .returning({ id: session.id }),
    'the new session',
  );
  return created.id;
}
