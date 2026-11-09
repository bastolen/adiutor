/**
 * @file The endpoint context the checks read, the groups of Better Auth endpoint
 * paths they treat alike, and the refusals more than one check uses (worded
 * in the request's language, `refusal-messages.ts`).
 */
import { APIError } from 'better-auth/api';

import {
  EMAIL_CODES_NOT_ALLOWED,
  SIGN_IN_CHANGE_IN_PROGRESS,
} from '@/lib/sign-in/sign-in-refusals';

import { refusalBody } from './refusal-messages';

/** The parts of a Better Auth endpoint context the checks use. */
export interface AuthGuardContext {
  /** The endpoint path, e.g. `/two-factor/verify-totp`. */
  path?: string;
  /** Request body. */
  body?: Record<string, unknown> | null;
  /** Query parameters, for GET endpoints such as `/magic-link/verify`. */
  query?: Record<string, unknown> | null;
  /** Request headers. */
  headers?: Headers | null;
  /** Reads a signed cookie of the request. */
  getSignedCookie: (name: string, secret: string) => Promise<string | null | false>;
  /** Better Auth's request state. */
  context: {
    /** The auth secret, for signed cookies. */
    secret: string;
    /** Better Auth's cookie names, e.g. the session cookie's. */
    authCookies?: { sessionToken: { name: string } };
    /** Builds Better Auth's cookie names. */
    createAuthCookie: (name: string) => { name: string };
    /** Better Auth's data access. */
    internalAdapter: {
      /**
       * Looks up a verification value (hashed identifiers are handled): its
       * value and when it expires (Better Auth may return an expired row).
       */
      findVerificationValue: (
        identifier: string,
      ) => Promise<{ value: string; expiresAt: Date } | null>;
    };
  };
}

/** Endpoints that add, change or remove a way to sign in or to confirm sessions. */
export const CREDENTIAL_PATHS = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/update-passkey',
  '/passkey/delete-passkey',
  '/link-social',
  '/unlink-account',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
]);

/**
 * Endpoints in {@link CREDENTIAL_PATHS} that only rename a sign-in method:
 * they need a confirmed session, but not a recent confirmation.
 */
export const RENAME_PATHS = new Set(['/passkey/update-passkey']);

/** Endpoints that check a code of the second step (shared with `auth-events/`). */
export const CODE_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
  '/two-factor/verify-backup-code',
]);

/** Endpoints of the code step: checking a code, or emailing one. */
export const STEP_PATHS = new Set([...CODE_PATHS, '/two-factor/send-otp']);

/** Endpoints that send or check an emailed code. */
export const EMAIL_CODE_PATHS = new Set(['/two-factor/send-otp', '/two-factor/verify-otp']);

/**
 * Refuses email codes where they don't count.
 *
 * @param ctx - The endpoint context, for the request's language.
 * @throws {APIError} `FORBIDDEN` with code `EMAIL_CODES_NOT_ALLOWED`.
 */
export function refuseEmailCodes(ctx: AuthGuardContext): never {
  throw new APIError('FORBIDDEN', refusalBody(ctx, EMAIL_CODES_NOT_ALLOWED.code));
}

/**
 * Refuses backup codes of an authenticator app that was never set up, with
 * Better Auth's own refusal of a wrong backup code (its English message
 * included), so it can't be told apart from one.
 *
 * @throws {APIError} Always.
 */
export function refuseUnfinishedBackupCodes(): never {
  throw new APIError('BAD_REQUEST', {
    message: 'Invalid backup code',
    code: 'INVALID_BACKUP_CODE',
  });
}

/**
 * Refuses a sign-in change while another one of the same user is still being made.
 *
 * @param ctx - The endpoint context, for the request's language.
 * @throws {APIError} `CONFLICT` with code `SIGN_IN_CHANGE_IN_PROGRESS`.
 */
export function refuseSignInChangeInProgress(ctx: AuthGuardContext): never {
  throw new APIError('CONFLICT', refusalBody(ctx, SIGN_IN_CHANGE_IN_PROGRESS.code));
}
