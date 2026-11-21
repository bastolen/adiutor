/**
 * @file Runs the link in an email about a request (decision 0036) through
 * Better Auth's real endpoint (`auth.handler`, with the app's guards and
 * reactions), to check what only a whole request shows:
 * - a person's click signs the recipient in, as often as they click it, and
 *   opens the request; the session skips the step-up page but has no second
 *   step, so changes that need a confirmation ask for one straight away;
 * - anything else (no person's click, someone else signed in, a link that
 *   can't be used) goes to the confirmation page without a session, and the
 *   page's own Continue may switch accounts;
 * - a link ends with the user's trusted devices, and is capped per hour.
 */
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  auditEvent,
  membership,
  rateLimitBucket,
  requestSignInLink,
  session,
  user,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { mustStepUp, needsFreshSignIn, needsRecentConfirmation } from '@/lib/authz/mfa';
import { defined } from '@/lib/defined';
import { env } from '@/lib/env';
import { requestLinkPath } from '@/lib/sign-in/request-link';
import { hashToken } from '@/lib/sign-in/tokens';

import {
  addMember,
  addPassword,
  createCompany,
  createStaffSettings,
  createUser,
  enableTwoFactor,
  fillRateLimitBucket,
  setupTestContext,
  staffActor,
  storeAssignedRequest,
} from '../../../tests/integration/helpers';
import { getOptionalActor } from '../authz';
import { RATE_LIMITS } from '../rate-limit';
import { createRequestLink, getRequestLinkView } from './request-links';
import { revokeOtherOwnSessions, endSessionsOf } from './sessions';

/** The request a page renders for; tests set its headers (e.g. the browser's cookies). */
const pageRequest = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));
// What pages read the signed-in user with (`src/server/authz.ts`), outside Next.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => pageRequest.headers) }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }));
// Pages record activity in the background; it isn't what these tests are about.
vi.mock('../background', () => ({ default: vi.fn() }));

const { ctx, db } = setupTestContext();

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});

beforeEach(async () => {
  await createStaffSettings(db);
});

/** A click on the link in an email in a webmail tab: a navigation a person made from another site. */
const CLICK_IN_EMAIL = {
  'sec-fetch-site': 'cross-site',
  'sec-fetch-user': '?1',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

/** The confirmation page's Continue: a same-origin navigation the user made. */
const CLICK_ON_PAGE = { ...CLICK_IN_EMAIL, 'sec-fetch-site': 'same-origin' };

/** A mail scanner that opens the link to check it: no browser, so no `Sec-Fetch-*` headers. */
const SCANNER = {};

/**
 * A browser talking to Better Auth: it keeps the cookies responses set and
 * drops the ones they expire, and sends them with every request.
 *
 * @returns The browser.
 */
function newBrowser() {
  const cookies = new Map<string, string>();

  /**
   * The cookies it sends.
   *
   * @returns A `Cookie` header.
   */
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  return {
    cookie,

    /**
     * Opens a request link, keeping the cookies the response sets.
     *
     * @param token - The link's token.
     * @param headers - The `Sec-Fetch-*` headers of how it was opened.
     * @param options - Options.
     * @param options.confirmed - Whether it's the confirmation page's Continue.
     * @returns Where the response sends the browser, as a path and query.
     */
    async open(
      token: string,
      headers: Record<string, string>,
      { confirmed = false } = {},
    ): Promise<string> {
      const response = await auth.handler(
        new Request(`${env.BETTER_AUTH_URL}${requestLinkPath(token, { confirmed })}`, {
          headers: { ...headers, cookie: cookie() },
        }),
      );
      expect(response.status).toBe(302);
      response.headers.getSetCookie().forEach((set) => {
        const pair = defined(set.split(';')[0], 'the cookie name and value');
        const name = pair.slice(0, pair.indexOf('='));
        const value = pair.slice(pair.indexOf('=') + 1);
        if (value === '' || /max-age=0/i.test(set)) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      });
      const location = new URL(defined(response.headers.get('location'), 'the redirect'));
      return `${location.pathname}${location.search}`;
    },
  };
}

/**
 * Reads who a browser is signed in as, as a page does.
 *
 * @param browser - The browser.
 * @returns The actor, or `null` when signed out.
 */
async function actorIn(browser: ReturnType<typeof newBrowser>) {
  pageRequest.headers = new Headers({ cookie: browser.cookie() });
  // `getOptionalActor` is cached per request with React's `cache`, which is a no-op here.
  return getOptionalActor();
}

/**
 * A company with a request, and a Client there who gets emails about it.
 *
 * @returns The Client's ID, the request's ID and number, and the company's ID.
 */
async function clientWithRequest() {
  const company = await createCompany(db);
  const client = await createUser(db, 'casey@adiutor.test');
  await addMember(db, company.id, client, 'client');
  const requestId = await storeAssignedRequest(db, company.id, []);
  return { client, requestId, companyId: company.id };
}

/**
 * The sessions of a user.
 *
 * @param userId - The user.
 * @returns Their sessions' IDs and facts.
 */
function sessionsOf(userId: string) {
  return db
    .select({
      id: session.id,
      fromRequestLink: session.fromRequestLink,
      mfaVerified: session.mfaVerified,
    })
    .from(session)
    .where(eq(session.userId, userId));
}

/** Where every link of these tests opens: the first request's page. */
const REQUEST_PAGE = '/requests/1';

describe('the link in an email about a request', () => {
  it('stores only the hash of its token', async () => {
    const { client, requestId } = await clientWithRequest();

    const token = await createRequestLink(db, { userId: client, requestId });

    const [stored] = await db.select().from(requestSignInLink);
    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60_000);
  });

  it("signs a person's click in and opens the request, past the second step", async () => {
    const { client, requestId } = await clientWithRequest();
    await enableTwoFactor(db, client);
    const token = await createRequestLink(db, { userId: client, requestId });
    const browser = newBrowser();

    expect(await browser.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);

    expect(await sessionsOf(client)).toEqual([
      { id: expect.any(String), fromRequestLink: true, mfaVerified: false },
    ]);
    const actor = defined(await actorIn(browser), 'the signed-in user');
    expect(actor.id).toBe(client);
    expect(actor.fromRequestLink).toBe(true);
    // Not sent to the step-up page, but every change that needs a confirmation asks for one.
    expect(mustStepUp(actor)).toBe(false);
    expect(actor.mfaConfirmedUntil).toBeNull();
    expect(needsRecentConfirmation(actor)).toBe(true);
    expect(actor.strongMfaConfirmedUntil).toBeNull();
    // Recorded as a sign-in with the link.
    const events = await db
      .select({ action: auditEvent.action, details: auditEvent.details })
      .from(auditEvent)
      .where(eq(auditEvent.actorUserId, client));
    expect(events).toEqual([{ action: 'sign_in', details: { method: 'request_link' } }]);
    const [link] = await db.select().from(requestSignInLink);
    expect(link?.lastUsedAt).not.toBeNull();
  });

  it('lets a role that requires MFA in without the second step, but asks for it to change anything', async () => {
    const company = await createCompany(db);
    const manager = await staffActor(db, 'manager');
    await enableTwoFactor(db, manager.id);
    const requestId = await storeAssignedRequest(db, company.id, [manager.id]);
    const token = await createRequestLink(db, { userId: manager.id, requestId });
    const browser = newBrowser();

    expect(await browser.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);

    const actor = defined(await actorIn(browser), 'the signed-in user');
    expect(actor.mfaRequired).toBe(true);
    expect(mustStepUp(actor)).toBe(false);
    expect(needsRecentConfirmation(actor)).toBe(true);
  });

  it('never counts as a fresh sign-in for an account without a second step', async () => {
    const { client, requestId } = await clientWithRequest();
    await addPassword(db, client);
    const token = await createRequestLink(db, { userId: client, requestId });
    const browser = newBrowser();

    await browser.open(token, CLICK_IN_EMAIL);

    const actor = defined(await actorIn(browser), 'the signed-in user');
    expect(actor.signedInAt).toBeNull();
    expect(needsFreshSignIn(actor)).toBe(true);
  });

  it('signs in with every click on another browser, and starts nothing new where it signed in', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const first = newBrowser();
    const second = newBrowser();

    await first.open(token, CLICK_IN_EMAIL);
    expect(await first.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);
    expect(await sessionsOf(client)).toHaveLength(1);

    expect(await second.open(token, CLICK_IN_EMAIL)).toBe(REQUEST_PAGE);
    expect(await sessionsOf(client)).toHaveLength(2);
  });

  it("sends anything but a person's click to the confirmation page, without a session", async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    expect(await newBrowser().open(token, SCANNER)).toBe(`/auth/request-link?token=${token}`);
    expect(
      await newBrowser().open(token, { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }),
    ).toBe(`/auth/request-link?token=${token}`);

    expect(await sessionsOf(client)).toEqual([]);
  });

  it('asks before switching from someone else, and only the page itself may switch', async () => {
    const { client, requestId, companyId } = await clientWithRequest();
    const colleague = await createUser(db, 'colin@adiutor.test');
    await addMember(db, companyId, colleague, 'client');
    const browser = newBrowser();
    await browser.open(
      await createRequestLink(db, { userId: colleague, requestId }),
      CLICK_IN_EMAIL,
    );
    const token = await createRequestLink(db, { userId: client, requestId });
    const page = `/auth/request-link?token=${token}`;

    expect(await browser.open(token, CLICK_IN_EMAIL)).toBe(page);
    // Another site can't make the page's same-origin click.
    expect(await browser.open(token, CLICK_IN_EMAIL, { confirmed: true })).toBe(page);
    expect(await sessionsOf(client)).toEqual([]);
    expect(await sessionsOf(colleague)).toHaveLength(1);

    expect(await browser.open(token, CLICK_ON_PAGE, { confirmed: true })).toBe(REQUEST_PAGE);
    expect(await sessionsOf(client)).toHaveLength(1);
    // The colleague's session in this browser ended, as signing out would.
    expect(await sessionsOf(colleague)).toEqual([]);
    expect((await actorIn(browser))?.id).toBe(client);
  });

  it.each([
    [
      'expired',
      async (link: { id: string }) => {
        await db
          .update(requestSignInLink)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(requestSignInLink.id, link.id));
      },
    ],
    [
      'for a deactivated account',
      async (link: { userId: string }) => {
        await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, link.userId));
      },
    ],
    [
      'for someone no longer at the company',
      async (link: { userId: string }) => {
        await db.delete(membership).where(eq(membership.userId, link.userId));
      },
    ],
  ])('refuses a link %s, without a session', async (_case, makeUnusable) => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const [link] = await db.select().from(requestSignInLink);
    await makeUnusable(defined(link, 'the link'));

    expect(await newBrowser().open(token, CLICK_IN_EMAIL)).toBe(
      `/auth/request-link?token=${token}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
  });

  it('counts tokens that are no link against the IP address', async () => {
    const { client } = await clientWithRequest();

    expect(await newBrowser().open('not-a-link', CLICK_IN_EMAIL)).toBe(
      '/auth/request-link?token=not-a-link',
    );

    expect(
      await db
        .select({ key: rateLimitBucket.key, count: rateLimitBucket.count })
        .from(rateLimitBucket)
        .where(like(rateLimitBucket.key, 'request-link-miss:ip:%')),
    ).toEqual([{ key: expect.any(String), count: 1 }]);
    expect(await sessionsOf(client)).toEqual([]);
  });

  it('sends the browser to the sign-in page once the link signed in too often this hour', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });
    const [link] = await db.select({ id: requestSignInLink.id }).from(requestSignInLink);
    await fillRateLimitBucket(
      db,
      `request-link-sign-in:link:${defined(link, 'the link').id}`,
      RATE_LIMITS.requestLinkSignInsPerLink.limit,
    );

    expect(await newBrowser().open(token, CLICK_IN_EMAIL)).toBe(
      `/auth?${new URLSearchParams({ callbackURL: REQUEST_PAGE })}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
  });

  it('ends when the user is signed out everywhere, or signs out their other devices', async () => {
    const { client, requestId } = await clientWithRequest();
    const first = await createRequestLink(db, { userId: client, requestId });
    const browser = newBrowser();
    await browser.open(first, CLICK_IN_EMAIL);

    await revokeOtherOwnSessions(ctx, defined(await actorIn(browser), 'the signed-in user'));
    expect(await newBrowser().open(first, CLICK_IN_EMAIL)).toBe(
      `/auth/request-link?token=${first}`,
    );

    const second = await createRequestLink(db, { userId: client, requestId });
    await endSessionsOf(db, client);
    expect(await newBrowser().open(second, CLICK_IN_EMAIL)).toBe(
      `/auth/request-link?token=${second}`,
    );
    expect(await sessionsOf(client)).toEqual([]);
  });
});

describe('looking a request link up for its page', () => {
  it('names the account and the request of a link that can be used', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    expect(await getRequestLinkView(ctx, token)).toEqual({
      state: 'usable',
      linkId: expect.any(String),
      number: 1,
      reference: 'AD-1',
      account: { userId: client, name: 'casey', email: 'casey@adiutor.test' },
    });
  });

  it('names only the request of a link that ended or that its person can no longer use', async () => {
    const { client, requestId } = await clientWithRequest();
    const token = await createRequestLink(db, { userId: client, requestId });

    await db
      .delete(membership)
      .where(and(eq(membership.userId, client), eq(membership.role, 'client')));
    expect(await getRequestLinkView(ctx, token)).toEqual({ state: 'unavailable', number: 1 });

    await endSessionsOf(db, client);
    expect(await getRequestLinkView(ctx, token)).toEqual({ state: 'ended', number: 1 });
    expect(await getRequestLinkView(ctx, 'not-a-link')).toEqual({ state: 'unknown' });
  });
});
