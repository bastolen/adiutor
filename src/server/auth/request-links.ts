/**
 * @file The links in emails about requests that sign their recipient in
 * (decision 0036). The job that sends such an email makes a link for its
 * recipient ({@link createRequestLink}); a person's click on it signs them in
 * and opens the request ({@link followRequestLink}, from Better Auth's endpoint
 * in `src/lib/sign-in/request-link-plugin.ts`), as often as they click it,
 * for 14 days. The session it starts skips the step-up page but proved no
 * second step, so every change that needs a recent confirmation asks for it
 * straight away (`SessionMfa.fromRequestLink` in `src/lib/authz/mfa/`).
 *
 * A link only signs in while its person can still read the request, and
 * ends early whenever the user's trusted devices are forgotten
 * (`forgetSecondStepSkips` in `./second-step-skips.ts`): signing out everywhere or one device, a
 * password change or reset, two-step verification turned off, an
 * authenticator set up next to email codes, an MFA reset, a deactivation.
 * Anything that isn't a person's click on a link that can still be used, or
 * that would sign someone else out in that browser, goes to the confirmation
 * page first (`/auth/request-link`), which looks the link up without using
 * it ({@link getRequestLinkView}). Its Continue signs in like a click; with
 * nobody signed in in that browser, the page sends it by itself, since some
 * browsers (Safari) never say a person clicked (decision 0038). Browsers
 * that don't say where a request came from (Safari before 16.4, and every
 * browser on an address that isn't secure) have their Continue checked by
 * its `Origin` instead (decision 0040).
 */
import { and, eq, sql } from 'drizzle-orm';

import { db as appDb, type DatabaseOrTransaction } from '@/db';
import { company, membership, request, requestSignInLink, user } from '@/db/schema';
import { getPermissions } from '@/lib/authz/permissions';
import { signInPath } from '@/lib/redirect';
import ipAddressOptions from '@/lib/request/ip-address-options';
import isOwnPagePost from '@/lib/request/own-page-post';
import isPersonsClick from '@/lib/request/persons-click';
import { requestInfoFromHeaders } from '@/lib/request/request-info';
import { formatRequestNumber, requestPathWithEntry } from '@/lib/requests';
import { REQUEST_LINK_DAYS, requestLinkPagePath } from '@/lib/sign-in/request-link';
import { generateToken, hashToken } from '@/lib/sign-in/tokens';

import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import getRequestPrefix from '../people/request-prefix';
import {
  assertRateLimit,
  hitRateLimit,
  ipRateLimitKey,
  RATE_LIMITS,
  releaseRateLimitHit,
} from '../rate-limit';
import type { LinkAccount } from './email-links';
import { type SessionCookieContext, signedSession } from './signed-session';

/**
 * Makes a link for the person an email about a request goes to. Only the
 * token's hash is stored; the token goes into the email's link and nowhere
 * else. Each email gets its own, good for {@link REQUEST_LINK_DAYS} days.
 *
 * @param db - Database client or transaction.
 * @param link - Whom it signs in, and which request it opens.
 * @param link.userId - The person the email goes to.
 * @param link.requestId - The request.
 * @returns The token.
 */
export async function createRequestLink(
  db: DatabaseOrTransaction,
  link: { userId: string; requestId: string },
): Promise<string> {
  const token = generateToken();
  await db.insert(requestSignInLink).values({
    ...link,
    tokenHash: hashToken(token),
    expiresAt: sql`now() + make_interval(days => ${REQUEST_LINK_DAYS})`,
  });
  return token;
}

/**
 * What a request link is, for its endpoint and its confirmation page:
 *
 * - `usable`: it signs in (with the account and the request it opens);
 * - `ended`: it expired or was ended early;
 * - `unavailable`: its person can't use it now (deactivated, or can no
 *   longer read the request);
 * - `unknown`: no such link.
 *
 * Only a usable link names its account. A known link names its request's
 * number, so signing in another way can still return to the request.
 */
export type RequestLinkView =
  | { state: 'unknown' }
  | { state: 'ended' | 'unavailable'; number: number }
  | {
      state: 'usable';
      /** The link's ID. */
      linkId: string;
      /** The request's number, for its address. */
      number: number;
      /** The request's number as people see it, e.g. "AD-142". */
      reference: string;
      /** Whom it signs in. */
      account: LinkAccount;
    };

/**
 * Looks a request link up without using it. Each lookup counts against a
 * limit per IP address before it's made, and is given back when the link
 * exists, so only tokens that aren't links count.
 *
 * @param ctx - Service context.
 * @param token - The token from the link (unvalidated input is fine).
 * @returns What the link is.
 * @throws {ServiceError} `rate_limited` after too many tokens from this IP
 *   address that aren't links.
 */
export async function getRequestLinkView(
  ctx: Pick<ServiceContext, 'db' | 'requestInfo'>,
  token: string,
): Promise<RequestLinkView> {
  const key = await ipRateLimitKey(ctx, 'request-link-miss');
  await assertRateLimit(ctx, key, RATE_LIMITS.requestLinkMissesPerIp);

  const [found] = await ctx.db
    .select({
      id: requestSignInLink.id,
      userId: requestSignInLink.userId,
      ended: sql<boolean>`${requestSignInLink.expiresAt} <= now()`,
      number: request.number,
      companyDeactivatedAt: company.deactivatedAt,
      name: user.name,
      email: user.email,
      deactivatedAt: user.deactivatedAt,
      platformRole: user.platformRole,
      companyRole: membership.role,
    })
    .from(requestSignInLink)
    .innerJoin(request, eq(request.id, requestSignInLink.requestId))
    .innerJoin(company, eq(company.id, request.companyId))
    .innerJoin(user, eq(user.id, requestSignInLink.userId))
    .leftJoin(
      membership,
      and(eq(membership.userId, requestSignInLink.userId), eq(membership.companyId, company.id)),
    )
    .where(eq(requestSignInLink.tokenHash, hashToken(token)));
  if (!found) {
    return { state: 'unknown' };
  }
  await releaseRateLimitHit(ctx, key);
  if (found.ended) {
    return { state: 'ended', number: found.number };
  }
  // Whether they can read the request now, by the rules its page uses (`getRequestAccess`).
  const permissions = getPermissions({
    platformRole: found.platformRole ?? null,
    companyRole: found.companyRole ?? null,
    company: { deactivated: found.companyDeactivatedAt !== null },
  });
  const mayRead = permissions.has('company:view') && permissions.has('requests:view');
  if (found.deactivatedAt || !mayRead) {
    return { state: 'unavailable', number: found.number };
  }
  return {
    state: 'usable',
    linkId: found.id,
    number: found.number,
    reference: formatRequestNumber(await getRequestPrefix(ctx.db), found.number),
    account: { userId: found.userId, name: found.name, email: found.email },
  };
}

/** What Better Auth's endpoint does with a request link ({@link followRequestLink}). */
export interface RequestLinkOutcome {
  /** Where the browser goes next: the request, the confirmation page or the sign-in page. */
  location: string;
  /** Where it goes instead when the sign-in below fails after all: the confirmation page. */
  fallback: string;
  /** Whom to sign in first, with which link; absent when nobody is signed in. */
  signIn?: { userId: string; linkId: string };
}

/** The parts of Better Auth's endpoint context {@link followRequestLink} reads. */
interface RequestLinkContext extends SessionCookieContext {
  /** The request's headers. */
  headers?: Headers;
}

/**
 * Decides what a request link does, for Better Auth's endpoint, which then
 * signs in (when `signIn` is set) and redirects:
 *
 * 1. A link (`GET`) that isn't a person's click (`isPersonsClick`), or a
 *    `POST` that isn't the confirmation page's Continue (`isOwnPagePost`:
 *    a page load a page of this site started, by its `Sec-Fetch-*` headers,
 *    or by its `Origin` where the browser sends none, decision 0040; it
 *    needn't say a person clicked, which Safari never does, decision 0038):
 *    to the confirmation page, so a
 *    mail scanner or link checker gets no session. A `POST` counts only as the
 *    Continue, never as a click: another site's form, clicked, says a
 *    person clicked too, and the browser sends it without the cookies
 *    (`SameSite=Lax`) that would show someone is signed in.
 * 2. A link that isn't usable ({@link getRequestLinkView}): to the
 *    confirmation page, which says so.
 * 3. That person signed in in this browser already: straight to the
 *    request, without a new session.
 * 4. Someone else signed in: to the confirmation page, which says that
 *    continuing switches accounts, unless this is its Continue
 *    (`isOwnPagePost`), pressed: the one the page sends by
 *    itself (`auto`) never switches, since the page may have been rendered
 *    before someone signed in in another tab. A link on one of the site's
 *    pages (one written in a reply) is a same-origin click too, but never a
 *    POST.
 * 5. Past the link's sign-ins for the hour: to the sign-in page, returning
 *    to the request.
 * 6. Otherwise: sign the person in and open the request.
 *
 * Whenever a POST ends on the page again (or the sign-in fails), the page's
 * address says so (`retry`), so the page waits for a click instead of
 * continuing by itself in a loop.
 *
 * @param ctx - The endpoint context (headers and the signed session cookie).
 * @param link - The link.
 * @param link.token - Its token (unvalidated input is fine).
 * @param link.posted - Whether the browser posted it: only the confirmation page's Continue
 *   does, never a link.
 * @param link.auto - Whether the page sent its Continue by itself (decision 0038), which never
 *   switches from someone else signed in.
 * @param link.entry - The entry the link points at, passed on wherever it goes (`?entry=`), so
 *   the request's page shows it whatever the reader's activity filter; anything that isn't an
 *   entry's ID is left out.
 * @returns Where to go, and whom to sign in first.
 */
export async function followRequestLink(
  ctx: RequestLinkContext,
  {
    token,
    posted,
    auto = false,
    entry = null,
  }: { token: string; posted: boolean; auto?: boolean; entry?: string | null },
): Promise<RequestLinkOutcome> {
  const headers = ctx.headers ?? new Headers();
  const page = requestLinkPagePath(token, { entry, retry: posted });
  const toPage = { location: page, fallback: page };
  const fromPage = isOwnPagePost(headers, posted);
  if (posted ? !fromPage : !isPersonsClick(headers)) {
    return toPage;
  }
  const service = {
    db: appDb,
    /**
     * Reads where the request came from, for the limit per IP address.
     *
     * @returns IP address and browser.
     */
    requestInfo: async () => requestInfoFromHeaders(headers, ipAddressOptions),
  };
  let view: RequestLinkView;
  try {
    view = await getRequestLinkView(service, token);
  } catch (error) {
    // Too many tokens that aren't links: the page says so.
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      return toPage;
    }
    throw error;
  }
  if (view.state !== 'usable') {
    return toPage;
  }
  const location = requestPathWithEntry(view.number, entry);
  const browser = await signedSession(ctx);
  if (browser?.userId === view.account.userId) {
    return { location, fallback: page };
  }
  if (browser && (!fromPage || auto)) {
    return toPage;
  }
  const { allowed } = await hitRateLimit(
    service,
    `request-link-sign-in:link:${view.linkId}`,
    RATE_LIMITS.requestLinkSignInsPerLink,
  );
  if (!allowed) {
    return { location: signInPath(location), fallback: page };
  }
  return { location, fallback: page, signIn: { userId: view.account.userId, linkId: view.linkId } };
}

/**
 * Notes that a request link signed someone in.
 *
 * @param linkId - The link.
 */
export async function noteRequestLinkUsed(linkId: string): Promise<void> {
  await appDb
    .update(requestSignInLink)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(requestSignInLink.id, linkId));
}
