/**
 * @file What the reactions to Better Auth activity share: the endpoint context
 * they read, running a reaction without failing the request, and recording
 * an audit event or sending a security notice.
 */
import { db } from '@/db';
import type { SecurityNoticeKind } from '@/emails/security-notice';
import type { AuditAction } from '@/lib/audit-actions';
import { sendEmail } from '@/lib/email';
import { appUrl } from '@/lib/env';
import { localeFromHeaders } from '@/lib/i18n/default-locale';
import ipAddressOptions from '@/lib/request/ip-address-options';
import { type RequestInfo, requestInfoFromHeaders } from '@/lib/request/request-info';
import { providerLabel } from '@/lib/sign-in/oauth-providers';

import { recordEvent } from '../../audit';
import { sendSecurityNotice } from '../security-notices';

/** The parts of a Better Auth endpoint context the reactions use. */
export interface AuthHookContext {
  /** The endpoint path, e.g. `/sign-in/email` or `/callback/:id`. */
  path?: string;
  /** Request headers. */
  headers?: Headers;
  /** Request body. */
  body?: Record<string, unknown> | null;
  /** Sets a cookie on the response. */
  setCookie?: (
    name: string,
    value: string,
    options: {
      maxAge?: number;
      path?: string;
      httpOnly?: boolean;
      sameSite?: 'lax';
      secure?: boolean;
    },
  ) => unknown;
  /**
   * Route parameters, e.g. `{ id: 'github' }` for provider callbacks; any of
   * them may be missing.
   */
  params?: Record<string, string | undefined>;
  /**
   * Reads a cookie of the request whose signature checks out with the
   * secret: its value, `false` for a wrong signature, `null` without one.
   */
  getSignedCookie?: (name: string, secret: string) => Promise<string | null | false>;
  /** Better Auth's request state. */
  context: {
    /** The endpoint's response, or the error it threw (in after hooks). */
    returned?: unknown;
    /** The session the request was made with, if any. */
    session?: {
      session: {
        id: string;
        mfaVerified?: boolean | null;
        mfaMethod?: string | null;
        mfaVerifiedAt?: Date | string | null;
        /** When it signed in (Better Auth may pass it as a string). */
        createdAt?: Date | string | null;
        /** When it ends. */
        expiresAt?: Date | string | null;
      };
      user: { id: string; twoFactorEnabled?: boolean | null };
    } | null;
    /**
     * The session the request created, if any. Better Auth's two-step
     * plugin sets it back to `null` when it deletes a password sign-in's
     * session to ask for a code.
     */
    newSession?: {
      session: { id: string; ipAddress?: string | null; userAgent?: string | null };
      user: { id: string; twoFactorEnabled?: boolean | null };
    } | null;
    /** Better Auth's cookie names. */
    authCookies?: { sessionToken: { name: string } };
    /** Better Auth's name for one of its cookies, e.g. `trust_device`, with its prefix. */
    createAuthCookie?: (name: string) => { name: string };
    /** The secret Better Auth signs cookies with. */
    secret?: string;
    /**
     * Runs work after the response (`backgroundTasks` in `src/lib/auth.ts`);
     * without it (tests), the work is awaited.
     */
    runInBackground?: (task: Promise<unknown>) => void;
  };
}

/**
 * Runs a reaction, logging instead of failing the sign-in when it breaks.
 *
 * @param name - What the reaction does, for the log.
 * @param work - The reaction.
 */
export async function safely(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    // eslint-disable-next-line no-console -- A failed reaction must not break sign-in, but should show up in the logs.
    console.error(`Auth reaction "${name}" failed`, error);
  }
}

/**
 * Runs work after the response when Better Auth can (`runInBackground`, the
 * `backgroundTasks` of `src/lib/auth.ts`), so it doesn't make the response
 * slower (e.g. a notice whose timing would tell whether an address has an
 * account); otherwise (tests) it's awaited.
 *
 * @param ctx - The endpoint context.
 * @param task - The work, already started.
 */
export async function runAfterResponse(
  ctx: AuthHookContext,
  task: Promise<unknown>,
): Promise<void> {
  if (ctx.context.runInBackground) {
    ctx.context.runInBackground(task);
  } else {
    await task;
  }
}

/**
 * The context `recordEvent` needs, with known request info.
 *
 * @param info - IP and browser.
 * @returns The database and request info.
 */
export function withRequestInfo(info: RequestInfo) {
  /**
   * Returns the request info.
   *
   * @returns IP and browser.
   */
  const requestInfo = async () => info;
  return { db, requestInfo };
}

/**
 * The context `recordEvent` needs, reading IP and browser from the request.
 *
 * @param headers - Request headers, if there's a request.
 * @returns The database and request info.
 */
export function auditContext(headers: Headers | undefined) {
  return withRequestInfo(requestInfoFromHeaders(headers, ipAddressOptions));
}

/**
 * Records an audit event for a request.
 *
 * @param ctx - The request's headers (for IP and browser), e.g. the endpoint context.
 * @param action - What happened.
 * @param userId - Who did it (and whose account it was about).
 * @param details - Extra facts.
 */
export async function audit(
  ctx: Pick<AuthHookContext, 'headers'> | null,
  action: AuditAction,
  userId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await recordEvent(auditContext(ctx?.headers), {
    action,
    actorUserId: userId,
    targetUserId: userId,
    details,
  });
}

/**
 * Emails the user about a security change made in this request.
 *
 * @param headers - Request headers, for the device and IP address.
 * @param userId - The user.
 * @param kind - What changed.
 * @param providerId - The provider, for connected/disconnected.
 */
export async function notify(
  headers: Headers | undefined,
  userId: string,
  kind: SecurityNoticeKind,
  providerId?: string,
): Promise<void> {
  const provider = providerId ? providerLabel(providerId) : undefined;
  await sendSecurityNotice(
    {
      db,
      sendEmail,
      baseUrl: appUrl,
      requestInfo: auditContext(headers).requestInfo,
      /**
       * The language of the request that made the change, for a user who saved none.
       *
       * @returns The locale.
       */
      requestLocale: () => localeFromHeaders(headers, db),
    },
    { userId },
    kind,
    // The user's own change, made in this request, so the email may say from which device.
    { provider, showDevice: true },
  );
}
